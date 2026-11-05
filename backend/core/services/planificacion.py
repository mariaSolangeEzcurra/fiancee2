"""
Planificación automática del taller para los vestidos de un contrato.

Para cada vestido con ruta (Taller A o C) se recorren las operaciones
de su plantilla y se reservan horas (ReservaOperacion) a las
trabajadoras habilitadas, usando la misma capacidad que muestra
/api/core/capacidad/:

    horario semanal - ausencias - horas ya comprometidas

Reglas:
- TRABAJO: consume horas de trabajadoras con la habilidad de la
  operación (si nadie la tiene, se usa el área responsable).
- ESPERA: solo hace transcurrir días (horas / 24), sin ocupar personal.
- Una operación empieza cuando terminan sus dependencias. Si la
  plantilla no define dependencias, depende de la operación anterior
  según el orden.
- Lo que no entra dentro del horizonte queda como "horas sin asignar"
  y se devuelve como advertencia (el contrato se guarda igual).
"""

import math
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q
from django.utils import timezone

from core.models import (
    AusenciaTrabajadora,
    PlantillaOperacion,
    ReservaOperacion,
    Trabajadora,
    VestidoContrato,
)

CERO = Decimal("0.00")
CENTIMO = Decimal("0.01")
HORIZONTE_DIAS = 365


def _q(valor):
    return Decimal(valor).quantize(CENTIMO, rounding=ROUND_HALF_UP)


def _horas_comprometidas(reserva):
    """Misma regla que CapacidadProduccionView."""
    if reserva.estado == ReservaOperacion.Estado.CANCELADA:
        return CERO
    if reserva.estado == ReservaOperacion.Estado.COMPLETADA:
        return max(CERO, reserva.horas_realizadas)
    return max(CERO, reserva.horas_reservadas - reserva.horas_realizadas)


class CapacidadTaller:
    """Capacidad restante por trabajadora y día, cargada en memoria."""

    def __init__(self, desde, dias=HORIZONTE_DIAS):
        self.desde = desde
        self.hasta = desde + timedelta(days=dias)

        self.trabajadoras = list(
            Trabajadora.objects.filter(activa=True)
            .prefetch_related("horarios", "habilidades")
            .order_by("nombre", "id")
        )
        self.horarios = {
            t.id: {h.dia_semana: h.horas_disponibles for h in t.horarios.all()}
            for t in self.trabajadoras
        }
        self.nombres = {t.id: t.nombre for t in self.trabajadoras}
        self.habilidades = {
            t.id: {op.id for op in t.habilidades.all()}
            for t in self.trabajadoras
        }

        self.ausencias = {}
        for ausencia in AusenciaTrabajadora.objects.filter(
            trabajadora__in=self.trabajadoras,
            fecha_inicio__lte=self.hasta,
            fecha_fin__gte=self.desde,
        ):
            dia = max(ausencia.fecha_inicio, self.desde)
            while dia <= min(ausencia.fecha_fin, self.hasta):
                clave = (ausencia.trabajadora_id, dia)
                self.ausencias[clave] = (
                    self.ausencias.get(clave, CERO)
                    + ausencia.horas_no_disponibles
                )
                dia += timedelta(days=1)

        self.usadas = {}
        for reserva in ReservaOperacion.objects.filter(
            trabajadora__in=self.trabajadoras,
            fecha__range=(self.desde, self.hasta),
        ).exclude(estado=ReservaOperacion.Estado.CANCELADA):
            clave = (reserva.trabajadora_id, reserva.fecha)
            self.usadas[clave] = (
                self.usadas.get(clave, CERO) + _horas_comprometidas(reserva)
            )

    def disponible(self, trabajadora_id, fecha):
        base = self.horarios[trabajadora_id].get(fecha.weekday(), CERO)
        ausencia = min(base, self.ausencias.get((trabajadora_id, fecha), CERO))
        usadas = self.usadas.get((trabajadora_id, fecha), CERO)
        return max(CERO, base - ausencia - usadas)

    def consumir(self, trabajadora_id, fecha, horas):
        clave = (trabajadora_id, fecha)
        self.usadas[clave] = self.usadas.get(clave, CERO) + horas

    def habilitadas_para(self, operacion):
        con_habilidad = [
            t for t in self.trabajadoras
            if operacion.id in self.habilidades[t.id]
        ]
        if con_habilidad:
            return con_habilidad
        return [
            t for t in self.trabajadoras
            if t.area == operacion.area_responsable
        ]


def asignar_horas(capacidad, habilitadas, horas, inicio):
    """
    Reparte `horas` entre las trabajadoras habilitadas desde `inicio`,
    día a día, consumiendo la capacidad. Prioriza a quien ya empezó la
    operación y luego a quien tenga más horas libres ese día.

    Devuelve (asignaciones [((trabajadora_id, dia), horas)],
    horas_pendientes, primer_dia, ultimo_dia).
    """
    asignaciones = []
    pendientes = _q(horas)
    primer_dia = None
    ultimo_dia = None
    preferida = None
    dia = inicio

    while pendientes > 0 and habilitadas and dia <= capacidad.hasta:
        orden = sorted(
            habilitadas,
            key=lambda t: (t.id != preferida, -capacidad.disponible(t.id, dia)),
        )
        for trabajadora in orden:
            libre = capacidad.disponible(trabajadora.id, dia)
            if libre < CENTIMO:
                continue
            tomar = _q(min(libre, pendientes))
            if tomar < CENTIMO:
                continue
            capacidad.consumir(trabajadora.id, dia, tomar)
            pendientes -= tomar
            preferida = preferida or trabajadora.id
            primer_dia = primer_dia or dia
            ultimo_dia = dia
            asignaciones.append(((trabajadora.id, dia), tomar))
            if pendientes <= 0:
                break
        dia += timedelta(days=1)

    return asignaciones, max(CERO, pendientes), primer_dia, ultimo_dia


def liberar_reservas_vestido(vestido):
    """
    Elimina las reservas del vestido que aún no tienen avance
    (RESERVADA, sin horas realizadas ni sesiones registradas).

    Devuelve cuántas reservas con avance se conservaron.
    """
    reservas = ReservaOperacion.objects.filter(vestido=vestido)

    sin_avance = reservas.filter(
        estado=ReservaOperacion.Estado.RESERVADA,
        horas_realizadas=0,
        sesiones__isnull=True,
    )
    sin_avance.delete()

    return reservas.exclude(estado=ReservaOperacion.Estado.CANCELADA).count()


def vestido_tiene_avance(vestido):
    if vestido.pk is None:
        return False
    if vestido.estado != VestidoContrato.Estado.PENDIENTE:
        return True
    if vestido.sesiones_trabajo.exists():
        return True
    return ReservaOperacion.objects.filter(vestido=vestido).filter(
        Q(horas_realizadas__gt=0)
        | Q(estado__in=[
            ReservaOperacion.Estado.EN_PROCESO,
            ReservaOperacion.Estado.COMPLETADA,
        ])
        | Q(sesiones__isnull=False)
    ).exists()


def _plantillas_de_ruta(ruta):
    return list(
        PlantillaOperacion.objects.filter(
            ruta=ruta,
            activa=True,
            operacion__activa=True,
        )
        .select_related("operacion")
        .prefetch_related("depende_de")
        .order_by("orden", "id")
    )


def planificar_vestido(vestido, capacidad, fecha_inicio):
    """
    Crea las reservas de producción de un vestido y devuelve el plan.
    El vestido debe estar guardado y no tener reservas activas.
    """
    contrato = vestido.contrato
    resultado = {
        "vestido_id": vestido.id,
        "codigo": vestido.codigo,
        "tipo_vestido": str(vestido.tipo_vestido) if vestido.tipo_vestido_id else None,
        "taller": vestido.taller,
        "planificado": False,
        "fecha_inicio_estimada": None,
        "fecha_fin_estimada": None,
        "fecha_limite": contrato.fecha_entrega,
        "a_tiempo": None,
        "horas_trabajo": "0.00",
        "horas_espera": "0.00",
        "horas_sin_asignar": "0.00",
        "operaciones": [],
        "advertencias": [],
    }

    if not vestido.ruta_id:
        resultado["advertencias"].append(
            "Ítem sin taller asignado: no se reserva capacidad."
        )
        return resultado

    plantillas = _plantillas_de_ruta(vestido.ruta)
    if not plantillas:
        resultado["advertencias"].append(
            "La ruta no tiene operaciones activas configuradas."
        )
        return resultado

    ids_activos = {p.id for p in plantillas}
    # Tiempos ajustados para este vestido (si los hay).
    ajustes = {a.plantilla_id: a for a in vestido.procesos.all()}
    fin_por_plantilla = {}
    anterior = None
    total_trabajo = CERO
    total_espera = CERO
    total_sin_asignar = CERO
    reservas_nuevas = {}

    for plantilla in plantillas:
        dependencias = [
            d.id for d in plantilla.depende_de.all() if d.id in ids_activos
        ]
        if not dependencias and anterior is not None:
            dependencias = [anterior.id]

        inicio = max(
            [fecha_inicio] + [fin_por_plantilla[d] for d in dependencias if d in fin_por_plantilla]
        )
        ajuste = ajustes.get(plantilla.id)

        if ajuste is not None and not ajuste.incluido:
            # Proceso omitido para este vestido: no consume tiempo y
            # las operaciones siguientes pueden empezar en la misma fecha.
            fin_por_plantilla[plantilla.id] = inicio
            resultado["operaciones"].append({
                "plantilla_id": plantilla.id,
                "operacion": plantilla.operacion.nombre,
                "tipo_tiempo": plantilla.tipo_tiempo,
                "horas": "0.00",
                "inicio": inicio,
                "fin": inicio,
                "omitido": True,
                "asignaciones": [],
            })
            anterior = plantilla
            continue

        horas = _q(ajuste.horas if ajuste is not None else plantilla.horas_estimadas)
        detalle = {
            "plantilla_id": plantilla.id,
            "operacion": plantilla.operacion.nombre,
            "tipo_tiempo": plantilla.tipo_tiempo,
            "horas": str(horas),
            "ajustado": ajuste is not None,
            "inicio": inicio,
            "fin": inicio,
            "asignaciones": [],
        }

        if plantilla.tipo_tiempo == PlantillaOperacion.TipoTiempo.ESPERA:
            total_espera += horas
            fin = inicio + timedelta(days=math.ceil(horas / 24)) if horas > 0 else inicio
            detalle["fin"] = fin
            fin_por_plantilla[plantilla.id] = fin

        else:
            total_trabajo += horas
            habilitadas = capacidad.habilitadas_para(plantilla.operacion)
            if not habilitadas:
                resultado["advertencias"].append(
                    f"{plantilla.operacion.nombre}: no hay trabajadoras "
                    "activas con esa habilidad o área."
                )

            asignadas, pendientes, primer_dia, ultimo_dia = asignar_horas(
                capacidad, habilitadas, horas, inicio
            )
            for (trabajadora_id, dia), tomar in asignadas:
                clave = (trabajadora_id, plantilla.id, dia)
                reservas_nuevas[clave] = reservas_nuevas.get(clave, CERO) + tomar
                detalle["asignaciones"].append({
                    "trabajadora_id": trabajadora_id,
                    "trabajadora": capacidad.nombres[trabajadora_id],
                    "fecha": dia,
                    "horas": str(tomar),
                })

            if pendientes > 0:
                total_sin_asignar += pendientes
                detalle["horas_sin_asignar"] = str(_q(pendientes))
                if habilitadas:
                    resultado["advertencias"].append(
                        f"{plantilla.operacion.nombre}: {_q(pendientes)} h "
                        "no entran en la capacidad disponible de los "
                        f"próximos {HORIZONTE_DIAS} días."
                    )

            detalle["inicio"] = primer_dia or inicio
            detalle["fin"] = ultimo_dia or inicio
            fin_por_plantilla[plantilla.id] = ultimo_dia or inicio

        resultado["operaciones"].append(detalle)
        anterior = plantilla

    ReservaOperacion.objects.bulk_create([
        ReservaOperacion(
            contrato=contrato,
            vestido=vestido,
            trabajadora_id=trabajadora_id,
            plantilla_id=plantilla_id,
            fecha=fecha,
            horas_reservadas=horas,
            observaciones=f"Planificación automática - {vestido.codigo}",
        )
        for (trabajadora_id, plantilla_id, fecha), horas in reservas_nuevas.items()
    ])

    fecha_fin = max(fin_por_plantilla.values()) if fin_por_plantilla else fecha_inicio
    a_tiempo = fecha_fin <= contrato.fecha_entrega and total_sin_asignar == 0

    if fecha_fin > contrato.fecha_entrega:
        resultado["advertencias"].append(
            f"La producción terminaría el {fecha_fin.isoformat()}, después "
            f"de la fecha de recojo ({contrato.fecha_entrega.isoformat()})."
        )

    vestido.fecha_fin_estimada = fecha_fin
    vestido.horas_sin_asignar = _q(total_sin_asignar)
    vestido.save(update_fields=["fecha_fin_estimada", "horas_sin_asignar"])

    resultado.update({
        "planificado": True,
        "fecha_inicio_estimada": min(
            (op["inicio"] for op in resultado["operaciones"]),
            default=fecha_inicio,
        ),
        "fecha_fin_estimada": fecha_fin,
        "a_tiempo": a_tiempo,
        "horas_trabajo": str(_q(total_trabajo)),
        "horas_espera": str(_q(total_espera)),
        "horas_sin_asignar": str(_q(total_sin_asignar)),
    })
    return resultado


def planificar_vestidos(contrato, vestidos):
    """
    Libera las reservas sin avance de los vestidos indicados y vuelve
    a planificarlos, en orden, compartiendo la misma capacidad.
    """
    hoy = timezone.localdate()
    fecha_inicio = max(hoy, contrato.fecha_firma)

    planes = []
    pendientes = []
    for vestido in vestidos:
        if vestido_tiene_avance(vestido):
            planes.append({
                "vestido_id": vestido.id,
                "codigo": vestido.codigo,
                "planificado": False,
                "advertencias": [
                    "El vestido ya tiene avance en el taller; se "
                    "conserva su planificación actual."
                ],
            })
            continue
        liberar_reservas_vestido(vestido)
        pendientes.append(vestido)

    if not pendientes:
        return planes

    # Import local para evitar dependencia circular.
    from core.services.produccion import generar_pasos

    capacidad = CapacidadTaller(fecha_inicio)
    for vestido in pendientes:
        planes.append(planificar_vestido(vestido, capacidad, fecha_inicio))
        # Línea de producción del vestido (pasos + entrega).
        generar_pasos(vestido, forzar=True)

    return planes


def cancelar_reservas_contrato(contrato):
    """Al cancelar un contrato se libera la capacidad pendiente."""
    for vestido in contrato.vestidos.all():
        liberar_reservas_vestido(vestido)

    ReservaOperacion.objects.filter(
        contrato=contrato,
        estado__in=[
            ReservaOperacion.Estado.RESERVADA,
            ReservaOperacion.Estado.EN_PROCESO,
        ],
    ).update(estado=ReservaOperacion.Estado.CANCELADA)
