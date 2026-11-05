"""
Línea de producción de cada vestido del contrato.

Al guardar un contrato, cada vestido con taller recibe sus pasos
(PasoVestido): las operaciones de su ruta, con los tiempos ajustados
del vestido, más un paso final de "entrega".

- La jefa de taller avanza los pasos, asigna trabajadoras, cambia
  horas estimadas, fecha límite y prioridad, y registra notas.
- La trabajadora, al iniciar una sesión, trabaja sobre el paso actual;
  al finalizarla, el paso se completa y el vestido pasa al siguiente.
- Al completar el último paso el vestido queda FINALIZADO.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import (
    Contrato,
    PasoVestido,
    PlantillaOperacion,
    ProcesoVestidoContrato,
    ReservaOperacion,
    Trabajadora,
    VestidoContrato,
)
from core.services.planificacion import CapacidadTaller, asignar_horas

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
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        # Vestido terminado con el flujo anterior (sin pasos).
        vestido.pasos.update(estado=PasoVestido.Estado.COMPLETADO, completado_en=timezone.now())
        vestido.paso_actual = len(pasos) - 1
    elif vestido.estado == VestidoContrato.Estado.EN_PROCESO:
        vestido.pasos.filter(orden=0).update(estado=PasoVestido.Estado.EN_CURSO)
    vestido.save(update_fields=["paso_actual"])
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


# ============================================================
# ACCIONES
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
    if not paso.plantilla_id:
        return
    hoy = timezone.localdate()
    reservas = ReservaOperacion.objects.filter(
        vestido=vestido,
        plantilla_id=paso.plantilla_id,
    ).exclude(estado__in=[
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
def iniciar_paso(vestido, trabajadora=None):
    """Marca el paso actual como en curso (al iniciar una sesión)."""
    asegurar_pasos(vestido)
    paso = paso_actual(vestido)
    if paso is None:
        raise ValidationError("El vestido no tiene línea de producción.")
    if paso.estado == PasoVestido.Estado.PENDIENTE:
        paso.estado = PasoVestido.Estado.EN_CURSO
        paso.save(update_fields=["estado"])
    if trabajadora is not None:
        paso.trabajadoras.add(trabajadora)
    if vestido.estado == VestidoContrato.Estado.PENDIENTE:
        vestido.estado = VestidoContrato.Estado.EN_PROCESO
        vestido.save(update_fields=["estado"])
    _marcar_contrato_en_produccion(vestido.contrato)
    return paso


@transaction.atomic
def completar_paso(vestido, usuario=None):
    """
    Completa el paso actual y avanza al siguiente pendiente.
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

    paso.estado = PasoVestido.Estado.COMPLETADO
    paso.completado_en = timezone.now()
    paso.completado_por = usuario
    paso.save(update_fields=["estado", "completado_en", "completado_por"])
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
def cambiar_paso_actual(vestido, indice):
    """La jefa mueve el vestido a otro proceso (p. ej. para rehacer)."""
    vestido = VestidoContrato.objects.select_for_update().get(pk=vestido.pk)
    pasos, paso = obtener_paso(vestido, indice)

    if paso.estado == PasoVestido.Estado.COMPLETADO:
        # Se reabre para volver a trabajarlo.
        paso.estado = PasoVestido.Estado.EN_CURSO
        paso.completado_en = None
        paso.completado_por = None
        paso.save(update_fields=["estado", "completado_en", "completado_por"])

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


def horas_trabajadas(paso):
    return sum((s.horas_efectivas for s in paso.sesiones.all()), CERO)


@transaction.atomic
def cambiar_horas_estimadas(vestido, indice, horas):
    """
    Cambia las horas estimadas de un paso y reprograma sus reservas
    pendientes en el taller (desde hoy).
    """
    horas = Decimal(horas).quantize(Decimal("0.01"))
    if horas < 0:
        raise ValidationError("Las horas no pueden ser negativas.")

    _, paso = obtener_paso(vestido, indice)
    if paso.es_entrega:
        raise ValidationError("La entrega no tiene horas estimadas.")

    paso.horas_estimadas = horas
    paso.save(update_fields=["horas_estimadas"])

    # Se guarda también como ajuste del vestido.
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
    reservas = ReservaOperacion.objects.filter(vestido=vestido, plantilla=paso.plantilla).exclude(
        estado=ReservaOperacion.Estado.CANCELADA
    )
    # Libera lo reservado a futuro sin avance; se vuelve a reservar.
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
    if faltan <= 0:
        return paso

    capacidad = CapacidadTaller(hoy)
    habilitadas = capacidad.habilitadas_para(paso.plantilla.operacion)
    asignadas, _, _, _ = asignar_horas(capacidad, habilitadas, faltan, hoy)

    for (trabajadora_id, dia), h in asignadas:
        reserva, creada = ReservaOperacion.objects.get_or_create(
            contrato=vestido.contrato,
            vestido=vestido,
            trabajadora_id=trabajadora_id,
            plantilla=paso.plantilla,
            fecha=dia,
            defaults={
                "horas_reservadas": h,
                "observaciones": f"Reprogramado - {vestido.codigo}",
            },
        )
        if not creada:
            reserva.horas_reservadas += h
            reserva.save()
    return paso
