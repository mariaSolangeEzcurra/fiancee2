"""
Servicios de contratos.

Un contrato se puede generar de dos formas, con la misma lógica:
1. Aceptando una simulación viable (aceptar_simulacion).
2. Directamente desde el módulo de contratos (crear_contrato).

En ambos casos:
- Si la clienta (novia) no existe, se crea; si existe (mismo DNI),
  se reutiliza y se actualizan sus datos de contacto.
- Se crean los vestidos/ítems con su tipo, taller y precio.
- Se planifica automáticamente el taller (reservas de capacidad).
- Se registran los adelantos como pagos confirmados.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import (
    Cliente,
    Contrato,
    Pago,
    PlantillaOperacion,
    ProcesoVestidoContrato,
    RutaProduccion,
    SimulacionContrato,
    VestidoContrato,
)
from core.services.planificacion import (
    cancelar_reservas_contrato,
    liberar_reservas_vestido,
    planificar_vestidos,
    vestido_tiene_avance,
)

CERO = Decimal("0.00")

CONCEPTOS_ADELANTO = {
    1: "Primer adelanto",
    2: "Segundo adelanto",
    3: "Tercer adelanto",
}

CAMPOS_CONTRATO = [
    "fecha_firma",
    "fecha_entrega",
    "servicio_alquiler",
    "servicio_venta",
    "servicio_confeccion",
    "fecha_evento",
    "tipo_evento",
    "tipo_evento_detalle",
    "fecha_devolucion",
    "fecha_recojo_fotos",
    "fecha_devolucion_fotos",
    "servicio_lavanderia",
    "garantia",
    "garantia_detalle",
    "condiciones_pago",
    "observaciones",
    "asesora",
]

CAMPOS_CLIENTE = ["nombre", "documento", "telefono", "correo", "direccion"]


# ============================================================
# CLIENTA
# ============================================================

def obtener_o_crear_cliente(datos):
    """
    Busca a la clienta por DNI/documento. Si no existe, la crea.
    Si existe, actualiza los datos enviados que no estén vacíos.
    Sin documento, siempre crea una nueva.
    """
    datos = {k: (datos.get(k) or "").strip() for k in CAMPOS_CLIENTE}

    if not datos["nombre"]:
        raise ValidationError({"cliente": "El nombre de la clienta es obligatorio."})

    cliente = None
    if datos["documento"]:
        cliente = (
            Cliente.objects.select_for_update()
            .filter(documento__iexact=datos["documento"])
            .order_by("id")
            .first()
        )

    if cliente is None:
        return Cliente.objects.create(**datos), True

    cambios = []
    for campo, valor in datos.items():
        if valor and getattr(cliente, campo) != valor:
            setattr(cliente, campo, valor)
            cambios.append(campo)
    if not cliente.activo:
        cliente.activo = True
        cambios.append("activo")
    if cambios:
        cliente.save(update_fields=cambios)

    return cliente, False


def _resolver_cliente(cliente=None, datos_cliente=None):
    if cliente is not None:
        # Clienta seleccionada; si llegan datos, se actualizan.
        cambios = []
        for campo in CAMPOS_CLIENTE:
            valor = ((datos_cliente or {}).get(campo) or "").strip()
            if valor and getattr(cliente, campo) != valor:
                setattr(cliente, campo, valor)
                cambios.append(campo)
        if cambios:
            cliente.save(update_fields=cambios)
        return cliente, False
    if datos_cliente:
        return obtener_o_crear_cliente(datos_cliente)
    raise ValidationError({"cliente": "Selecciona una clienta o registra sus datos."})


# ============================================================
# NUMERACIÓN
# ============================================================

def generar_numero_contrato(fecha=None):
    anio = (fecha or timezone.localdate()).year
    prefijo = f"CT-{anio}-"
    secuencia = Contrato.objects.filter(numero__startswith=prefijo).count() + 1
    while True:
        numero = f"{prefijo}{secuencia:04d}"
        if not Contrato.objects.filter(numero=numero).exists():
            return numero
        secuencia += 1


def _codigo_vestido(numero_contrato, numero_vestido):
    return f"{numero_contrato}-V{numero_vestido:03d}"


# ============================================================
# VESTIDOS / ÍTEMS
# ============================================================

def resolver_ruta(tipo_vestido, taller):
    """Devuelve la ruta activa del tipo de vestido en el taller."""
    if not taller:
        return None
    if tipo_vestido is None:
        raise ValidationError(
            {"vestidos": "Para enviar un ítem al taller debes indicar el tipo de vestido."}
        )
    ruta = RutaProduccion.objects.filter(
        tipo_vestido=tipo_vestido,
        taller=taller,
        activa=True,
    ).first()
    if ruta is None:
        raise ValidationError({
            "vestidos": (
                f"El vestido '{tipo_vestido}' no tiene una ruta activa "
                f"en el Taller {taller}."
            )
        })
    return ruta


def _aplicar_procesos(vestido, procesos):
    """
    Guarda los tiempos ajustados de cada proceso para un vestido.

    procesos: lista [{plantilla, horas, incluido}] de la ruta del vestido.
    Solo se guardan los que difieren de la plantilla. Devuelve True si
    hubo cambios (y por lo tanto hay que replanificar).
    """
    actuales = {
        a.plantilla_id: (a.horas, a.incluido)
        for a in vestido.procesos.all()
    }

    if not vestido.ruta_id:
        if actuales:
            vestido.procesos.all().delete()
            return True
        return False

    plantillas = {
        p.id: p
        for p in PlantillaOperacion.objects.filter(ruta_id=vestido.ruta_id, activa=True)
    }

    deseados = {}
    for proceso in procesos or []:
        plantilla_id = proceso.get("plantilla")
        plantilla = plantillas.get(plantilla_id)
        if plantilla is None:
            raise ValidationError({
                "vestidos": (
                    f"{vestido.codigo}: el proceso {plantilla_id} no "
                    "pertenece a la ruta del vestido."
                )
            })
        horas = Decimal(proceso.get("horas", plantilla.horas_estimadas)).quantize(Decimal("0.01"))
        incluido = proceso.get("incluido", True)
        if incluido and horas == plantilla.horas_estimadas:
            continue  # igual a la plantilla: no hace falta guardarlo
        deseados[plantilla_id] = (horas, incluido)

    if deseados == actuales:
        return False

    vestido.procesos.all().delete()
    ProcesoVestidoContrato.objects.bulk_create([
        ProcesoVestidoContrato(
            vestido=vestido, plantilla_id=pid, horas=horas, incluido=incluido
        )
        for pid, (horas, incluido) in deseados.items()
    ])
    return True


def _aplicar_items(contrato, items, permitir_borrar):
    """
    Crea, actualiza y (opcionalmente) elimina ítems.
    Devuelve la lista de vestidos que deben planificarse de nuevo.
    """
    existentes = {v.id: v for v in contrato.vestidos.select_for_update()}
    siguiente = max((v.numero for v in existentes.values()), default=0) + 1
    vistos = set()
    a_planificar = []

    for item in items:
        vestido_id = item.get("id")
        tipo_vestido = item.get("tipo_vestido")
        ruta = resolver_ruta(tipo_vestido, item.get("taller"))

        if vestido_id:
            vestido = existentes.get(vestido_id)
            if vestido is None:
                raise ValidationError(
                    {"vestidos": f"El vestido {vestido_id} no pertenece a este contrato."}
                )
            vistos.add(vestido_id)

            cambia_produccion = (
                vestido.tipo_vestido_id != (tipo_vestido.id if tipo_vestido else None)
                or vestido.ruta_id != (ruta.id if ruta else None)
            )
            if cambia_produccion and vestido_tiene_avance(vestido):
                raise ValidationError({
                    "vestidos": (
                        f"{vestido.codigo} ya tiene avance en el taller: "
                        "no se puede cambiar su tipo ni su taller."
                    )
                })
        else:
            vestido = VestidoContrato(
                contrato=contrato,
                numero=siguiente,
                codigo=_codigo_vestido(contrato.numero, siguiente),
            )
            siguiente += 1
            cambia_produccion = True

        vestido.tipo_vestido = tipo_vestido
        vestido.ruta = ruta
        vestido.descripcion = item.get("descripcion") or (str(tipo_vestido) if tipo_vestido else "")
        vestido.modalidad = item.get("modalidad") or VestidoContrato.Modalidad.VENTA
        vestido.precio = item.get("precio") or CERO
        vestido.precio_otros = item.get("precio_otros") or CERO
        vestido.observaciones = item.get("observaciones", vestido.observaciones) or ""
        if cambia_produccion and not ruta:
            vestido.fecha_fin_estimada = None
            vestido.horas_sin_asignar = CERO
        vestido.save()

        # Tiempos por proceso: si cambia la ruta se descartan los ajustes
        # anteriores; si se envían procesos, se aplican.
        procesos = item.get("procesos")
        if cambia_produccion and vestido_id and procesos is None:
            _aplicar_procesos(vestido, [])
        if procesos is not None and _aplicar_procesos(vestido, procesos):
            if not cambia_produccion and vestido_tiene_avance(vestido):
                raise ValidationError({
                    "vestidos": (
                        f"{vestido.codigo} ya tiene avance en el taller: "
                        "no se pueden cambiar los tiempos de sus procesos."
                    )
                })
            cambia_produccion = True

        if cambia_produccion:
            if ruta:
                a_planificar.append(vestido)
            else:
                liberar_reservas_vestido(vestido)

    if permitir_borrar:
        for vestido_id, vestido in existentes.items():
            if vestido_id in vistos:
                continue
            if vestido_tiene_avance(vestido):
                raise ValidationError({
                    "vestidos": (
                        f"{vestido.codigo} ya tiene avance en el taller "
                        "y no se puede quitar del contrato."
                    )
                })
            liberar_reservas_vestido(vestido)
            vestido.delete()

    if not contrato.vestidos.exists():
        raise ValidationError({"vestidos": "El contrato debe tener al menos un ítem."})

    return a_planificar


def _recalcular_total(contrato):
    contrato.precio_total = sum(
        (v.precio_total for v in contrato.vestidos.all()), CERO
    )
    contrato.save(update_fields=["precio_total"])


def _renumerar_codigos(contrato):
    for vestido in contrato.vestidos.all():
        codigo = _codigo_vestido(contrato.numero, vestido.numero)
        if vestido.codigo != codigo:
            vestido.codigo = codigo
            vestido.save(update_fields=["codigo"])


def _derivar_servicios(contrato, datos):
    """Si no se marcan los servicios, se deducen de los ítems."""
    if any(k in datos for k in ("servicio_alquiler", "servicio_venta", "servicio_confeccion")):
        return
    vestidos = list(contrato.vestidos.all())
    contrato.servicio_alquiler = any(v.modalidad == "ALQUILER" for v in vestidos)
    contrato.servicio_venta = any(v.modalidad == "VENTA" for v in vestidos)
    contrato.servicio_confeccion = any(v.ruta_id for v in vestidos)
    contrato.save(update_fields=["servicio_alquiler", "servicio_venta", "servicio_confeccion"])


# ============================================================
# ADELANTOS
# ============================================================

def _aplicar_adelantos(contrato, adelantos, usuario):
    """
    adelantos: lista de hasta 3 elementos {importe, fecha, metodo,
    referencia}. La posición indica 1.er, 2.º y 3.er adelanto.
    Un importe vacío o cero elimina ese adelanto.
    """
    for orden, datos in enumerate(adelantos[:3], start=1):
        importe = (datos or {}).get("importe") or CERO
        pago = Pago.objects.filter(contrato=contrato, orden_adelanto=orden).first()

        if importe <= 0:
            if pago:
                pago.confirmado = False
                pago.save()  # elimina su movimiento financiero
                pago.delete()
            continue

        if pago is None:
            pago = Pago(contrato=contrato, orden_adelanto=orden, registrado_por=usuario)

        pago.importe = importe
        pago.fecha = datos.get("fecha") or pago.fecha or timezone.localdate()
        pago.metodo = datos.get("metodo") or pago.metodo or Pago.Metodo.EFECTIVO
        pago.referencia = datos.get("referencia", pago.referencia) or ""
        pago.concepto = CONCEPTOS_ADELANTO[orden]
        pago.confirmado = True
        pago.save()

    total_adelantos = sum(
        (p.importe for p in Pago.objects.filter(contrato=contrato, confirmado=True)),
        CERO,
    )
    if total_adelantos > contrato.precio_total:
        raise ValidationError(
            {"adelantos": "Los pagos registrados superan el monto total del contrato."}
        )


# ============================================================
# VALIDACIONES
# ============================================================

def _validar_fechas(contrato):
    errores = {}
    if contrato.fecha_entrega < contrato.fecha_firma:
        errores["fecha_entrega"] = (
            "La fecha de recojo no puede ser anterior a la fecha del contrato."
        )
    if contrato.fecha_evento and contrato.fecha_entrega > contrato.fecha_evento:
        errores["fecha_evento"] = (
            "La fecha del evento no puede ser anterior a la fecha de recojo del vestido."
        )
    if contrato.fecha_devolucion and contrato.fecha_devolucion < contrato.fecha_entrega:
        errores["fecha_devolucion"] = (
            "La fecha de devolución no puede ser anterior a la fecha de recojo."
        )
    if (
        contrato.fecha_recojo_fotos
        and contrato.fecha_devolucion_fotos
        and contrato.fecha_devolucion_fotos < contrato.fecha_recojo_fotos
    ):
        errores["fecha_devolucion_fotos"] = (
            "La devolución de la sesión de fotos no puede ser anterior a su recojo."
        )
    if contrato.tipo_evento == Contrato.TipoEvento.OTRO and not contrato.tipo_evento_detalle.strip():
        errores["tipo_evento_detalle"] = "Indica el tipo de evento."
    if errores:
        raise ValidationError(errores)


# ============================================================
# CREAR / EDITAR
# ============================================================

@transaction.atomic
def crear_contrato(
    *,
    vestidos,
    fecha_entrega,
    cliente=None,
    datos_cliente=None,
    numero=None,
    adelantos=None,
    usuario=None,
    simulacion=None,
    **campos,
):
    """
    Crea un contrato manual y devuelve (contrato, resultado).

    resultado = {"cliente_creado": bool, "planificacion": [...]}
    """
    if not vestidos:
        raise ValidationError({"vestidos": "El contrato debe tener al menos un ítem."})

    cliente, cliente_creado = _resolver_cliente(cliente, datos_cliente)

    numero = (numero or "").strip()
    if numero and Contrato.objects.filter(numero=numero).exists():
        raise ValidationError({"numero": "Ya existe un contrato con ese número."})

    contrato = Contrato(
        simulacion=simulacion,
        cliente=cliente,
        numero=numero or generar_numero_contrato(campos.get("fecha_firma")),
        fecha_entrega=fecha_entrega,
        precio_total=CERO,
        creado_por=usuario,
    )
    for campo in CAMPOS_CONTRATO:
        if campo in campos and campos[campo] is not None:
            setattr(contrato, campo, campos[campo])
    if contrato.asesora_id is None and usuario is not None:
        contrato.asesora = usuario

    _validar_fechas(contrato)
    contrato.save()

    a_planificar = _aplicar_items(contrato, vestidos, permitir_borrar=False)
    _recalcular_total(contrato)
    _derivar_servicios(contrato, campos)
    _aplicar_adelantos(contrato, adelantos or [], usuario)

    planificacion = planificar_vestidos(contrato, a_planificar)

    return contrato, {
        "cliente_creado": cliente_creado,
        "planificacion": planificacion,
    }


@transaction.atomic
def actualizar_contrato(
    contrato,
    *,
    usuario=None,
    vestidos=None,
    cliente=None,
    datos_cliente=None,
    adelantos=None,
    replanificar=False,
    **campos,
):
    """
    Edita un contrato. Solo se modifican los datos enviados.

    - vestidos: si se envía, es la lista completa de ítems. Los que
      traen "id" se actualizan, los nuevos se crean y los que faltan
      se eliminan (si todavía no tienen avance en el taller).
    - Los vestidos nuevos o con cambio de tipo/taller se vuelven a
      planificar. Con replanificar=True se replanifican todos los
      pendientes (útil si cambió la fecha o la capacidad).
    """
    contrato = Contrato.objects.select_for_update().get(pk=contrato.pk)

    if contrato.estado in (Contrato.Estado.CANCELADO, Contrato.Estado.ENTREGADO):
        nuevo_estado = campos.get("estado")
        if not nuevo_estado or nuevo_estado == contrato.estado:
            raise ValidationError(
                f"El contrato está {contrato.get_estado_display().lower()} y no se puede editar."
            )

    cliente_creado = False
    if cliente is not None or datos_cliente:
        nuevo_cliente, cliente_creado = _resolver_cliente(cliente, datos_cliente)
        contrato.cliente = nuevo_cliente

    numero = (campos.pop("numero", None) or "").strip()
    cambia_numero = bool(numero) and numero != contrato.numero
    if cambia_numero:
        if Contrato.objects.filter(numero=numero).exclude(pk=contrato.pk).exists():
            raise ValidationError({"numero": "Ya existe un contrato con ese número."})
        contrato.numero = numero

    for campo in CAMPOS_CONTRATO + ["fecha_entrega"]:
        if campo in campos:
            setattr(contrato, campo, campos[campo])

    estado_anterior = contrato.estado
    nuevo_estado = campos.get("estado")
    if nuevo_estado:
        contrato.estado = nuevo_estado

    _validar_fechas(contrato)
    contrato.save()

    if cambia_numero:
        _renumerar_codigos(contrato)

    a_planificar = []
    if vestidos is not None:
        a_planificar = _aplicar_items(contrato, vestidos, permitir_borrar=True)
        _recalcular_total(contrato)
        _derivar_servicios(contrato, campos)

    if adelantos is not None:
        _aplicar_adelantos(contrato, adelantos, usuario)

    planificacion = []
    if contrato.estado == Contrato.Estado.CANCELADO:
        if estado_anterior != Contrato.Estado.CANCELADO:
            cancelar_reservas_contrato(contrato)
    else:
        if replanificar:
            ids = {v.id for v in a_planificar}
            a_planificar += [
                v for v in contrato.vestidos.filter(ruta__isnull=False)
                if v.id not in ids
            ]
        planificacion = planificar_vestidos(contrato, a_planificar)

    return contrato, {
        "cliente_creado": cliente_creado,
        "planificacion": planificacion,
    }


# ============================================================
# DESDE EL SIMULADOR
# ============================================================

@transaction.atomic
def aceptar_simulacion(
    simulacion_id,
    numero=None,
    fecha_entrega=None,
    condiciones_pago="",
    observaciones="",
    usuario=None,
    modalidad=VestidoContrato.Modalidad.VENTA,
    **campos,
):
    """
    Convierte una simulación viable en contrato usando el mismo flujo
    que la creación manual: un ítem por cada unidad simulada, con el
    tipo de vestido, la ruta y el precio unitario de la simulación.
    """
    simulacion = SimulacionContrato.objects.select_for_update().select_related(
        "cliente", "tipo_vestido", "ruta"
    ).get(pk=simulacion_id)

    if Contrato.objects.filter(simulacion=simulacion).exists():
        raise ValidationError("Esta simulación ya fue convertida en contrato.")

    if simulacion.estado != SimulacionContrato.Estado.VIABLE:
        raise ValidationError("Solo se pueden aceptar simulaciones viables.")

    fecha_entrega = fecha_entrega or simulacion.fecha_entrega_solicitada
    if fecha_entrega < timezone.localdate():
        raise ValidationError("La fecha de entrega no puede estar en el pasado.")

    items = [
        {
            "tipo_vestido": simulacion.tipo_vestido,
            "taller": simulacion.ruta.taller,
            "modalidad": modalidad,
            "precio": simulacion.precio_unitario,
            "descripcion": str(simulacion.tipo_vestido),
        }
        for _ in range(simulacion.cantidad)
    ]

    contrato, resultado = crear_contrato(
        vestidos=items,
        fecha_entrega=fecha_entrega,
        cliente=simulacion.cliente,
        numero=numero,
        usuario=usuario,
        simulacion=simulacion,
        condiciones_pago=condiciones_pago,
        observaciones=observaciones,
        **campos,
    )

    simulacion.estado = SimulacionContrato.Estado.ACEPTADA
    simulacion.save(update_fields=["estado"])

    return contrato, resultado
