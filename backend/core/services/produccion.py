"""
Línea de producción de cada vestido del contrato.

Al guardar un contrato, cada vestido con taller recibe sus pasos
(PasoVestido): las operaciones de su ruta, con los tiempos ajustados
del vestido, más un paso final de "entrega".

Flujo:
- La JEFA DE TALLER inicia cada proceso (desde ahí corre el tiempo) y
  lo da por terminado; así se ve cuánto demoró realmente.
- Las TRABAJADORAS solo registran sesiones sobre el proceso iniciado.
  Terminar su sesión no termina el proceso.
- La jefa puede agregar procesos (pruebas extra, ajustes), cambiar
  horas, registrar pagos, cobros extra y notas con fotos.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone

from core.models import (
    CargoAdicional,
    Contrato,
    ImagenNotaVestido,
    NotaVestido,
    Operacion,
    Pago,
    PasoVestido,
    PlantillaOperacion,
    ProcesoVestidoContrato,
    ReservaOperacion,
    Trabajadora,
    VestidoContrato,
)
from core.services.planificacion import CapacidadTaller, asignar_horas, dias_bordado, es_bordado

CERO = Decimal("0.00")
NOMBRE_ENTREGA = "entrega"


# ============================================================
# GENERACIÓN DE PASOS
# ============================================================

def _tiene_avance_en_pasos(vestido):
    return (
        vestido.pasos.exclude(estado=PasoVestido.Estado.PENDIENTE).exists()
        or vestido.sesiones_trabajo.exists()
    )


def _enlazar_reservas(vestido):
    """Liga las reservas del vestido con el paso de su misma plantilla."""
    for paso in vestido.pasos.filter(plantilla__isnull=False, es_adicional=False):
        ReservaOperacion.objects.filter(
            vestido=vestido, plantilla_id=paso.plantilla_id, paso__isnull=True
        ).update(paso=paso)


def generar_pasos(vestido, forzar=False):
    """
    Crea los pasos del vestido a partir de su ruta. Si ya tiene pasos
    con avance, no se tocan. Con forzar=False solo se crean si no hay.
    """
    if vestido.pasos.exists():
        if not forzar or _tiene_avance_en_pasos(vestido):
            return False
        vestido.pasos.all().delete()

    if not vestido.ruta_id:
        return False

    ajustes = {a.plantilla_id: a for a in vestido.procesos.all()}
    plantillas = (
        PlantillaOperacion.objects.filter(
            ruta_id=vestido.ruta_id, activa=True, operacion__activa=True
        )
        .select_related("operacion")
        .order_by("orden", "id")
    )

    orden = 0
    pasos = []
    for plantilla in plantillas:
        ajuste = ajustes.get(plantilla.id)
        if ajuste is not None and not ajuste.incluido:
            continue
        pasos.append(PasoVestido(
            vestido=vestido,
            orden=orden,
            plantilla=plantilla,
            operacion=plantilla.operacion,
            nombre=plantilla.operacion.nombre,
            tipo_tiempo=plantilla.tipo_tiempo,
            area=plantilla.operacion.area_responsable,
            horas_estimadas=ajuste.horas if ajuste else plantilla.horas_estimadas,
        ))
        orden += 1

    pasos.append(PasoVestido(
        vestido=vestido,
        orden=orden,
        nombre=NOMBRE_ENTREGA,
        es_entrega=True,
        horas_estimadas=CERO,
    ))
    PasoVestido.objects.bulk_create(pasos)

    vestido.paso_actual = 0
    ahora = timezone.now()
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        # Vestido terminado con el flujo anterior (sin pasos).
        vestido.pasos.update(
            estado=PasoVestido.Estado.COMPLETADO, iniciado_en=ahora, completado_en=ahora
        )
        vestido.paso_actual = len(pasos) - 1
    elif vestido.estado == VestidoContrato.Estado.EN_PROCESO:
        vestido.pasos.filter(orden=0).update(estado=PasoVestido.Estado.EN_CURSO, iniciado_en=ahora)
    vestido.save(update_fields=["paso_actual"])
    _enlazar_reservas(vestido)
    return True


def asegurar_pasos(vestido):
    """Para vestidos creados antes de este módulo."""
    if vestido.ruta_id and not vestido.pasos.exists():
        generar_pasos(vestido)


# ============================================================
# CONSULTAS
# ============================================================

def pasos_ordenados(vestido):
    return list(vestido.pasos.all().order_by("orden"))


def obtener_paso(vestido, indice):
    pasos = pasos_ordenados(vestido)
    if indice is None or indice < 0 or indice >= len(pasos):
        raise ValidationError("El proceso indicado no existe.")
    return pasos, pasos[indice]


def paso_actual(vestido):
    pasos = pasos_ordenados(vestido)
    if not pasos:
        return None
    return pasos[min(vestido.paso_actual, len(pasos) - 1)]


def horas_trabajadas(paso):
    return sum((s.horas_efectivas for s in paso.sesiones.all()), CERO)


def _reservas_del_paso(vestido, paso):
    """Reservas del paso (o, en datos antiguos, de su plantilla)."""
    from django.db.models import Q

    filtro = Q(paso=paso)
    if paso.plantilla_id and not paso.es_adicional:
        filtro |= Q(paso__isnull=True, plantilla_id=paso.plantilla_id)
    return ReservaOperacion.objects.filter(vestido=vestido).filter(filtro)


# ============================================================
# INICIO Y CIERRE DE PROCESOS
# ============================================================

def _marcar_contrato_en_produccion(contrato):
    if contrato.estado == Contrato.Estado.ACTIVO:
        contrato.estado = Contrato.Estado.EN_PRODUCCION
        contrato.save(update_fields=["estado"])


def _cerrar_reservas_del_paso(vestido, paso):
    """
    Al completar un paso, sus reservas quedan completadas. Las horas
    reservadas a futuro se liberan para otros vestidos.
    """
    hoy = timezone.localdate()
    reservas = _reservas_del_paso(vestido, paso).exclude(estado__in=[
        ReservaOperacion.Estado.CANCELADA,
        ReservaOperacion.Estado.COMPLETADA,
    ])
    for reserva in reservas:
        if reserva.fecha > hoy and reserva.horas_realizadas == 0 and not reserva.sesiones.exists():
            reserva.estado = ReservaOperacion.Estado.CANCELADA
        else:
            reserva.estado = ReservaOperacion.Estado.COMPLETADA
            if reserva.horas_realizadas == 0:
                reserva.horas_realizadas = reserva.horas_reservadas
        reserva.save()


@transaction.atomic
def iniciar_proceso(vestido, usuario=None):
    """
    La jefa de taller inicia el proceso actual. Desde este momento se
    cuenta el tiempo y las trabajadoras pueden registrar sesiones.
    """
    vestido = VestidoContrato.objects.select_for_update().get(pk=vestido.pk)
    asegurar_pasos(vestido)
    paso = paso_actual(vestido)
    if paso is None:
        raise ValidationError("El vestido no tiene línea de producción.")
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        raise ValidationError("El vestido ya está terminado.")
    if paso.estado == PasoVestido.Estado.EN_CURSO:
        raise ValidationError(f"El proceso «{paso.nombre}» ya está en curso.")
    if paso.estado == PasoVestido.Estado.COMPLETADO:
        raise ValidationError(f"El proceso «{paso.nombre}» ya está terminado.")

    paso.estado = PasoVestido.Estado.EN_CURSO
    paso.iniciado_en = timezone.now()
    paso.iniciado_por = usuario
    paso.save(update_fields=["estado", "iniciado_en", "iniciado_por"])

    if vestido.estado == VestidoContrato.Estado.PENDIENTE:
        vestido.estado = VestidoContrato.Estado.EN_PROCESO
        vestido.save(update_fields=["estado"])
    _marcar_contrato_en_produccion(vestido.contrato)
    return paso


@transaction.atomic
def iniciar_paso(vestido, trabajadora=None):
    """
    Una trabajadora empieza una sesión: solo sobre un proceso que la
    jefa de taller ya inició.
    """
    asegurar_pasos(vestido)
    paso = paso_actual(vestido)
    if paso is None:
        raise ValidationError("El vestido no tiene línea de producción.")
    if paso.estado != PasoVestido.Estado.EN_CURSO:
        raise ValidationError(
            f"La jefa de taller aún no inició el proceso «{paso.nombre}»."
        )
    if trabajadora is not None:
        paso.trabajadoras.add(trabajadora)
    return paso


@transaction.atomic
def completar_paso(vestido, usuario=None):
    """
    La jefa da por terminado el paso actual y el vestido pasa al
    siguiente (que queda pendiente hasta que ella lo inicie).
    Devuelve (paso_completado, vestido_finalizado).
    """
    vestido = VestidoContrato.objects.select_for_update().get(pk=vestido.pk)
    asegurar_pasos(vestido)
    pasos = pasos_ordenados(vestido)
    if not pasos:
        raise ValidationError("El vestido no tiene línea de producción.")
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        raise ValidationError("El vestido ya está terminado.")

    indice = min(vestido.paso_actual, len(pasos) - 1)
    paso = pasos[indice]
    ahora = timezone.now()

    paso.estado = PasoVestido.Estado.COMPLETADO
    paso.iniciado_en = paso.iniciado_en or ahora
    paso.completado_en = ahora
    paso.completado_por = usuario
    paso.save(update_fields=["estado", "iniciado_en", "completado_en", "completado_por"])
    _cerrar_reservas_del_paso(vestido, paso)

    siguiente = next(
        (i for i in range(indice + 1, len(pasos)) if pasos[i].estado != PasoVestido.Estado.COMPLETADO),
        None,
    )
    if siguiente is None:
        siguiente = next(
            (i for i in range(len(pasos)) if pasos[i].estado != PasoVestido.Estado.COMPLETADO),
            None,
        )

    if siguiente is None:
        vestido.estado = VestidoContrato.Estado.FINALIZADO
        vestido.paso_actual = len(pasos) - 1
    else:
        vestido.estado = VestidoContrato.Estado.EN_PROCESO
        vestido.paso_actual = siguiente

    vestido.save(update_fields=["estado", "paso_actual"])
    _marcar_contrato_en_produccion(vestido.contrato)
    return paso, vestido.estado == VestidoContrato.Estado.FINALIZADO


@transaction.atomic
def cambiar_paso_actual(vestido, indice, usuario=None):
    """
    La jefa mueve el vestido a otro proceso. Un proceso terminado se
    reabre (en curso) para volver a trabajarlo; uno pendiente queda
    esperando que ella lo inicie.
    """
    vestido = VestidoContrato.objects.select_for_update().get(pk=vestido.pk)
    pasos, paso = obtener_paso(vestido, indice)

    if paso.estado == PasoVestido.Estado.COMPLETADO:
        paso.estado = PasoVestido.Estado.EN_CURSO
        paso.iniciado_en = timezone.now()
        paso.iniciado_por = usuario
        paso.completado_en = None
        paso.completado_por = None
        paso.save(update_fields=["estado", "iniciado_en", "iniciado_por", "completado_en", "completado_por"])

    vestido.paso_actual = indice
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        vestido.estado = VestidoContrato.Estado.EN_PROCESO
    vestido.save(update_fields=["paso_actual", "estado"])
    return paso


@transaction.atomic
def alternar_trabajadora(vestido, indice, trabajadora_id):
    _, paso = obtener_paso(vestido, indice)
    trabajadora = Trabajadora.objects.filter(pk=trabajadora_id, activa=True).first()
    if trabajadora is None:
        raise ValidationError("La trabajadora no existe o está inactiva.")
    if paso.trabajadoras.filter(pk=trabajadora.pk).exists():
        paso.trabajadoras.remove(trabajadora)
        return paso, False
    paso.trabajadoras.add(trabajadora)
    return paso, True


# ============================================================
# HORAS Y PROCESOS ADICIONALES
# ============================================================

def _reservar_paso(vestido, paso, horas, desde=None):
    """Reserva horas de trabajo para un paso desde `desde` (hoy)."""
    if horas <= 0 or paso.tipo_tiempo != PlantillaOperacion.TipoTiempo.TRABAJO or paso.es_entrega:
        return
    operacion = paso.operacion or (paso.plantilla.operacion if paso.plantilla_id else None)
    if operacion is None or paso.plantilla_id is None:
        return
    hoy = desde or timezone.localdate()
    capacidad = CapacidadTaller(hoy)
    habilitadas = capacidad.habilitadas_para(operacion)
    asignadas, _, _, _ = asignar_horas(capacidad, habilitadas, horas, hoy)
    for (trabajadora_id, dia), h in asignadas:
        reserva, creada = ReservaOperacion.objects.get_or_create(
            contrato=vestido.contrato,
            vestido=vestido,
            paso=paso,
            trabajadora_id=trabajadora_id,
            plantilla_id=paso.plantilla_id,
            fecha=dia,
            defaults={
                "horas_reservadas": h,
                "observaciones": f"Reprogramado - {vestido.codigo}",
            },
        )
        if not creada:
            reserva.horas_reservadas += h
            reserva.save()


@transaction.atomic
def cambiar_horas_estimadas(vestido, indice, horas):
    """
    Cambia las horas estimadas de un paso (cualquier paso pendiente o en
    curso) y reprograma sus reservas pendientes en el taller desde hoy.
    """
    horas = Decimal(horas).quantize(Decimal("0.01"))
    if horas < 0:
        raise ValidationError("Las horas no pueden ser negativas.")

    _, paso = obtener_paso(vestido, indice)
    if paso.es_entrega:
        raise ValidationError("La entrega no tiene horas estimadas.")

    paso.horas_estimadas = horas
    paso.save(update_fields=["horas_estimadas"])

    if paso.plantilla_id and not paso.es_adicional:
        ProcesoVestidoContrato.objects.update_or_create(
            vestido=vestido,
            plantilla=paso.plantilla,
            defaults={"horas": horas, "incluido": True},
        )

    if (
        paso.estado == PasoVestido.Estado.COMPLETADO
        or paso.tipo_tiempo == PlantillaOperacion.TipoTiempo.ESPERA
    ):
        return paso

    hoy = timezone.localdate()
    reservas = _reservas_del_paso(vestido, paso).exclude(estado=ReservaOperacion.Estado.CANCELADA)
    reservas.filter(
        fecha__gte=hoy,
        estado=ReservaOperacion.Estado.RESERVADA,
        horas_realizadas=0,
        sesiones__isnull=True,
    ).delete()

    ya_cubiertas = sum(
        (
            r.horas_realizadas if r.fecha < hoy or r.estado == ReservaOperacion.Estado.COMPLETADA
            else max(r.horas_reservadas, r.horas_realizadas)
            for r in reservas.all()
        ),
        CERO,
    )
    faltan = max(CERO, horas - max(ya_cubiertas, horas_trabajadas(paso)))
    _reservar_paso(vestido, paso, faltan, hoy)
    return paso


def _plantilla_para(vestido, operacion):
    """
    Plantilla de la ruta del vestido para la operación. Si la ruta no la
    tiene, se crea una inactiva (no afecta a otros vestidos) para poder
    reservar capacidad.
    """
    plantilla = PlantillaOperacion.objects.filter(ruta_id=vestido.ruta_id, operacion=operacion).first()
    if plantilla:
        return plantilla
    orden = (PlantillaOperacion.objects.filter(ruta_id=vestido.ruta_id).aggregate(m=Max("orden"))["m"] or 0) + 100
    return PlantillaOperacion.objects.create(
        ruta_id=vestido.ruta_id,
        operacion=operacion,
        orden=orden,
        horas_estimadas=CERO,
        tipo_tiempo=PlantillaOperacion.TipoTiempo.TRABAJO,
        obligatoria=False,
        activa=False,
    )


@transaction.atomic
def agregar_paso(vestido, operacion_id, horas, despues_de=None, nombre="", usuario=None):
    """
    Agrega un proceso a la cola del vestido (p. ej. una prueba extra).
    Se inserta después del índice indicado (por defecto, después del
    proceso actual) y nunca después de la entrega. Reserva capacidad.
    """
    vestido = VestidoContrato.objects.select_for_update().get(pk=vestido.pk)
    asegurar_pasos(vestido)
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        raise ValidationError("El vestido ya está terminado; reábrelo para agregar procesos.")

    operacion = Operacion.objects.filter(pk=operacion_id, activa=True).first()
    if operacion is None:
        raise ValidationError("Selecciona un proceso válido del catálogo.")
    horas = Decimal(horas).quantize(Decimal("0.01"))
    if horas < 0:
        raise ValidationError("Las horas no pueden ser negativas.")

    pasos = pasos_ordenados(vestido)
    ultimo = len(pasos) - 1  # entrega
    actual = min(vestido.paso_actual, ultimo)
    despues_de = actual if despues_de is None else despues_de
    # No se puede insertar antes del proceso actual ni después de la entrega.
    posicion = min(max(despues_de + 1, actual + 1 if pasos[actual].estado != PasoVestido.Estado.PENDIENTE else actual), ultimo)

    # Desplaza los siguientes (de atrás hacia adelante por la restricción única).
    for paso in sorted((p for p in pasos if p.orden >= posicion), key=lambda p: -p.orden):
        paso.orden += 1
        paso.save(update_fields=["orden"])

    nuevo = PasoVestido.objects.create(
        vestido=vestido,
        orden=posicion,
        plantilla=_plantilla_para(vestido, operacion),
        operacion=operacion,
        nombre=(nombre or operacion.nombre).strip(),
        es_adicional=True,
        tipo_tiempo=PlantillaOperacion.TipoTiempo.TRABAJO,
        area=operacion.area_responsable,
        horas_estimadas=horas,
    )
    if posicion <= vestido.paso_actual and pasos[actual].estado != PasoVestido.Estado.PENDIENTE:
        vestido.paso_actual += 1
        vestido.save(update_fields=["paso_actual"])

    _reservar_paso(vestido, nuevo, horas)
    return nuevo


@transaction.atomic
def eliminar_paso(vestido, indice):
    """Quita un proceso agregado por la jefa que aún no empezó."""
    vestido = VestidoContrato.objects.select_for_update().get(pk=vestido.pk)
    pasos, paso = obtener_paso(vestido, indice)
    if not paso.es_adicional:
        raise ValidationError("Solo se pueden quitar los procesos agregados por la jefa de taller.")
    if paso.estado != PasoVestido.Estado.PENDIENTE or paso.sesiones.exists():
        raise ValidationError("El proceso ya empezó; no se puede quitar.")

    paso.delete()  # sus reservas se borran en cascada
    for siguiente in sorted((p for p in pasos if p.orden > paso.orden), key=lambda p: p.orden):
        siguiente.orden -= 1
        siguiente.save(update_fields=["orden"])
    if vestido.paso_actual > indice:
        vestido.paso_actual -= 1
        vestido.save(update_fields=["paso_actual"])


# ============================================================
# DINERO: PAGOS Y COBROS EXTRA
# ============================================================

def total_cargos(contrato):
    return contrato.cargos_adicionales.aggregate(s=Sum("monto"))["s"] or CERO


def recalcular_total_contrato(contrato):
    """Monto total = ítems del contrato + cobros adicionales."""
    items = sum((v.precio_total for v in contrato.vestidos.all()), CERO)
    contrato.precio_total = items + total_cargos(contrato)
    contrato.save(update_fields=["precio_total"])
    return contrato.precio_total


@transaction.atomic
def registrar_pago(vestido, importe, usuario=None, metodo=None, fecha=None, referencia="", concepto=""):
    importe = Decimal(importe).quantize(Decimal("0.01"))
    if importe <= 0:
        raise ValidationError("El monto debe ser mayor que cero.")
    contrato = Contrato.objects.select_for_update().get(pk=vestido.contrato_id)
    saldo = contrato.saldo_pendiente
    if importe > saldo:
        raise ValidationError(f"El pago supera el saldo pendiente del contrato (S/ {saldo}).")
    return Pago.objects.create(
        contrato=contrato,
        vestido=vestido,
        importe=importe,
        fecha=fecha or timezone.localdate(),
        metodo=metodo or Pago.Metodo.EFECTIVO,
        referencia=referencia or "",
        concepto=concepto or f"Pago recibido en taller - {vestido.codigo}",
        confirmado=True,
        registrado_por=usuario,
    )


@transaction.atomic
def agregar_cargo(vestido, concepto, monto, usuario=None, descripcion="", nota=None):
    monto = Decimal(monto).quantize(Decimal("0.01"))
    if monto <= 0:
        raise ValidationError("El cobro extra debe ser mayor que cero.")
    if not (concepto or "").strip():
        raise ValidationError("Indica el concepto del cobro extra.")
    cargo = CargoAdicional.objects.create(
        contrato=vestido.contrato,
        vestido=vestido,
        nota=nota,
        concepto=concepto.strip(),
        descripcion=descripcion or "",
        monto=monto,
        registrado_por=usuario,
    )
    recalcular_total_contrato(vestido.contrato)
    return cargo


@transaction.atomic
def eliminar_cargo(vestido, cargo_id):
    cargo = CargoAdicional.objects.filter(pk=cargo_id, vestido=vestido).first()
    if cargo is None:
        raise ValidationError("El cobro no existe.")
    contrato = cargo.contrato
    cargo.delete()
    total = recalcular_total_contrato(contrato)
    if contrato.total_pagado > total:
        raise ValidationError("No se puede quitar: los pagos registrados superarían el nuevo total.")


# ============================================================
# NOTAS CON FOTOS
# ============================================================

TIPOS_IMAGEN = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
MAX_IMAGEN_MB = 8


@transaction.atomic
def agregar_nota(vestido, tipo, texto, usuario=None, imagenes=(), monto_extra=None, concepto_extra=""):
    texto = (texto or "").strip()
    if not texto and not imagenes:
        raise ValidationError("Escribe una observación o adjunta una foto.")
    for archivo in imagenes:
        if getattr(archivo, "content_type", "") not in TIPOS_IMAGEN:
            raise ValidationError(f"«{archivo.name}» no es una imagen válida.")
        if archivo.size > MAX_IMAGEN_MB * 1024 * 1024:
            raise ValidationError(f"«{archivo.name}» pesa más de {MAX_IMAGEN_MB} MB.")

    nombre = ""
    if usuario is not None:
        nombre = usuario.get_full_name() or usuario.username
    nota = NotaVestido.objects.create(
        vestido=vestido,
        tipo=tipo,
        texto=texto or "(foto)",
        autor=usuario,
        autor_nombre=nombre,
    )
    for archivo in imagenes:
        ImagenNotaVestido.objects.create(nota=nota, archivo=archivo)

    if monto_extra:
        agregar_cargo(
            vestido,
            concepto_extra or (texto[:180] if texto else "Modificación del vestido"),
            monto_extra,
            usuario=usuario,
            descripcion=texto,
            nota=nota,
        )
    return nota


# ============================================================
# RECORDATORIOS
# ============================================================

def dias_recordatorio_prueba():
    return getattr(settings, "FIANCEE_RECORDATORIO_PRIMERA_PRUEBA_DIAS", 45)


def recordatorios_vestido(vestido, pasos=None, hoy=None):
    """
    - Primera prueba: al mes y medio del contrato, si aún no se hizo.
    - Bordado: debe empezar 15 días antes de la entrega.
    """
    hoy = hoy or timezone.localdate()
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        return []
    pasos = pasos if pasos is not None else pasos_ordenados(vestido)
    contrato = vestido.contrato
    avisos = []

    prueba = next((p for p in pasos if p.nombre.lower().startswith("prueba")), None)
    if prueba and prueba.estado != PasoVestido.Estado.COMPLETADO:
        fecha = contrato.fecha_firma + timedelta(days=dias_recordatorio_prueba())
        dias = (fecha - hoy).days
        if dias <= 7:
            avisos.append({
                "type": "PRIMERA_PRUEBA",
                "date": fecha,
                "due": dias <= 0,
                "daysLeft": dias,
                "title": "Seguimiento de la primera prueba",
                "message": (
                    f"Ya pasó mes y medio desde el contrato ({contrato.fecha_firma:%d/%m/%Y}). "
                    "Coordina con la clienta la primera prueba."
                    if dias <= 0 else
                    f"En {dias} día(s) se cumple mes y medio del contrato: "
                    "prepara el seguimiento de la primera prueba."
                ),
            })

    bordado = next((p for p in pasos if es_bordado(p.nombre)), None)
    if bordado and bordado.estado == PasoVestido.Estado.PENDIENTE:
        fecha = vestido.fecha_limite_efectiva - timedelta(days=dias_bordado())
        dias = (fecha - hoy).days
        if dias <= 3:
            avisos.append({
                "type": "BORDADO",
                "date": fecha,
                "due": dias <= 0,
                "daysLeft": dias,
                "title": "Inicio del bordado",
                "message": (
                    f"El bordado debía empezar el {fecha:%d/%m/%Y} "
                    f"({dias_bordado()} días antes de la entrega)."
                    if dias <= 0 else
                    f"El bordado empieza el {fecha:%d/%m/%Y} "
                    f"({dias_bordado()} días antes de la entrega)."
                ),
            })
    return avisos


# ============================================================
# REPROGRAMAR TRABAJO PENDIENTE (vestidos existentes)
# ============================================================

def reprogramar_pendientes(vestido, capacidad, desde=None):
    """
    Vuelve a reservar las horas que le faltan a cada proceso no
    terminado del vestido, en orden, desde hoy. Sirve para vestidos que
    se crearon antes de la planificación o cuando se perdieron reservas.
    Devuelve las horas reservadas.
    """
    from core.services.planificacion import asignar_horas as _asignar

    asegurar_pasos(vestido)
    hoy = desde or timezone.localdate()
    cursor = hoy
    total = CERO

    for paso in pasos_ordenados(vestido):
        if paso.estado == PasoVestido.Estado.COMPLETADO or paso.es_entrega:
            continue
        if paso.tipo_tiempo == PlantillaOperacion.TipoTiempo.ESPERA:
            if paso.estado == PasoVestido.Estado.PENDIENTE:
                cursor = cursor + timedelta(days=int((paso.horas_estimadas + 23) // 24))
            continue

        reservas = _reservas_del_paso(vestido, paso).exclude(estado=ReservaOperacion.Estado.CANCELADA)
        # Lo reservado a futuro sin avance se rehace en orden.
        reservas.filter(
            fecha__gte=hoy, estado=ReservaOperacion.Estado.RESERVADA,
            horas_realizadas=0, sesiones__isnull=True,
        ).delete()
        cubiertas = sum(
            (max(r.horas_reservadas, r.horas_realizadas) if r.fecha >= hoy else r.horas_realizadas
             for r in reservas.all()),
            CERO,
        )
        faltan = max(CERO, paso.horas_estimadas - max(cubiertas, horas_trabajadas(paso)))
        if faltan <= 0 or paso.plantilla_id is None:
            continue

        operacion = paso.operacion or paso.plantilla.operacion
        asignadas, _, _, ultimo = _asignar(capacidad, capacidad.habilitadas_para(operacion), faltan, cursor)
        for (trabajadora_id, dia), h in asignadas:
            reserva, creada = ReservaOperacion.objects.get_or_create(
                contrato=vestido.contrato, vestido=vestido, paso=paso,
                trabajadora_id=trabajadora_id, plantilla_id=paso.plantilla_id, fecha=dia,
                defaults={"horas_reservadas": h, "observaciones": f"Reprogramado - {vestido.codigo}"},
            )
            if not creada:
                reserva.horas_reservadas += h
                reserva.save()
            total += h
        cursor = ultimo or cursor

    return total
