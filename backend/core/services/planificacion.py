"""
Planificación automática del taller.

Un mismo cálculo (calcular_plan) sirve para:
- el simulador de factibilidad (sin guardar nada),
- la planificación de los vestidos al guardar un contrato.

Capacidad = horario semanal de cada trabajadora - ausencias - horas ya
comprometidas (ReservaOperacion). Al agregar personal o cambiar sus
horarios, la capacidad cambia automáticamente.

Reglas:
- TRABAJO: consume horas de trabajadoras con la habilidad de la
  operación (si nadie la tiene, se usa el área responsable).
- ESPERA: solo hace transcurrir días (horas / 24), sin ocupar personal.
- Una operación empieza cuando terminan sus dependencias. Si la
  plantilla no define dependencias, depende de la anterior.
- El bordado empieza FIANCEE_BORDADO_DIAS_ANTES (15) días antes de la
  fecha de entrega.
- En temporada alta se agrega una holgura a las horas de trabajo.
"""

import copy
import math
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
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


def dias_bordado():
    return getattr(settings, "FIANCEE_BORDADO_DIAS_ANTES", 15)


def es_bordado(nombre):
    return "bordado" in (nombre or "").lower()


def _horas_comprometidas(reserva):
    """Misma regla que CapacidadProduccionView."""
    if reserva.estado == ReservaOperacion.Estado.CANCELADA:
        return CERO
    if reserva.estado == ReservaOperacion.Estado.COMPLETADA:
        return max(CERO, reserva.horas_realizadas)
    return max(CERO, reserva.horas_reservadas - reserva.horas_realizadas)


# ============================================================
# CAPACIDAD
# ============================================================

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
        self.nombres = {t.id: t.nombre for t in self.trabajadoras}
        self.areas = {t.id: t.area for t in self.trabajadoras}
        self.horarios = {
            t.id: {h.dia_semana: h.horas_disponibles for h in t.horarios.all()}
            for t in self.trabajadoras
        }
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

    def clone(self):
        """Copia para simular sin alterar la original."""
        nueva = copy.copy(self)
        nueva.usadas = dict(self.usadas)
        return nueva

    def base(self, trabajadora_id, fecha):
        """Horas de horario menos ausencias (sin descontar reservas)."""
        base = self.horarios[trabajadora_id].get(fecha.weekday(), CERO)
        ausencia = min(base, self.ausencias.get((trabajadora_id, fecha), CERO))
        return base - ausencia

    def disponible(self, trabajadora_id, fecha):
        usadas = self.usadas.get((trabajadora_id, fecha), CERO)
        return max(CERO, self.base(trabajadora_id, fecha) - usadas)

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

    def resumen_por_area(self, desde, hasta):
        """
        Capacidad, horas comprometidas y libres por área de trabajadora
        entre dos fechas (incluidas).
        """
        areas = {}
        dia = max(desde, self.desde)
        fin = min(hasta, self.hasta)
        while dia <= fin:
            for t in self.trabajadoras:
                base = self.base(t.id, dia)
                usadas = min(base, self.usadas.get((t.id, dia), CERO))
                datos = areas.setdefault(t.area, {
                    "capacidad": CERO, "comprometidas": CERO, "trabajadoras": set(),
                })
                datos["capacidad"] += base
                datos["comprometidas"] += usadas
                if base > 0:
                    datos["trabajadoras"].add(t.nombre)
            dia += timedelta(days=1)
        return areas


def asignar_horas(capacidad, habilitadas, horas, inicio, hasta=None):
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
    limite = min(hasta, capacidad.hasta) if hasta else capacidad.hasta

    while pendientes > 0 and habilitadas and dia <= limite:
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


# ============================================================
# CÁLCULO DEL PLAN (sin escribir en la base de datos)
# ============================================================

def plantillas_de_ruta(ruta_id):
    return list(
        PlantillaOperacion.objects.filter(
            ruta_id=ruta_id,
            activa=True,
            operacion__activa=True,
        )
        .select_related("operacion")
        .prefetch_related("depende_de")
        .order_by("orden", "id")
    )


def calcular_plan(plantillas, ajustes, capacidad, fecha_inicio, fecha_limite, factor=Decimal("1")):
    """
    Programa las operaciones de una ruta sobre la capacidad.

    ajustes: {plantilla_id: (horas, incluido)} tiempos propios del vestido.
    factor: holgura de horas (temporada alta).

    Devuelve un dict con las operaciones, totales, reservas a crear
    {(trabajadora_id, plantilla_id, dia): horas} y advertencias.
    La capacidad recibida se consume.
    """
    ids_activos = {p.id for p in plantillas}
    fin_por_plantilla = {}
    anterior = None
    total_trabajo = CERO
    total_espera = CERO
    total_sin_asignar = CERO
    reservas = {}
    operaciones = []
    advertencias = []
    sin_asignar_por_area = {}
    # Días libres antes de la fecha en que debe empezar el bordado
    # (negativo si las operaciones previas terminan tarde).
    holgura_bordado = None
    inicio_bordado = (
        max(fecha_inicio, fecha_limite - timedelta(days=dias_bordado()))
        if fecha_limite else None
    )

    for plantilla in plantillas:
        dependencias = [d.id for d in plantilla.depende_de.all() if d.id in ids_activos]
        if not dependencias and anterior is not None:
            dependencias = [anterior.id]
        inicio = max(
            [fecha_inicio] + [fin_por_plantilla[d] for d in dependencias if d in fin_por_plantilla]
        )
        horas_ajuste, incluido = ajustes.get(plantilla.id, (None, True))
        nombre = plantilla.operacion.nombre

        if not incluido:
            fin_por_plantilla[plantilla.id] = inicio
            operaciones.append({
                "plantilla_id": plantilla.id,
                "operacion": nombre,
                "area": plantilla.operacion.area_responsable,
                "tipo_tiempo": plantilla.tipo_tiempo,
                "horas": "0.00",
                "inicio": inicio,
                "fin": inicio,
                "omitido": True,
                "asignaciones": [],
            })
            anterior = plantilla
            continue

        horas_base = _q(horas_ajuste if horas_ajuste is not None else plantilla.horas_estimadas)
        detalle = {
            "plantilla_id": plantilla.id,
            "operacion": nombre,
            "area": plantilla.operacion.area_responsable,
            "tipo_tiempo": plantilla.tipo_tiempo,
            "horas": str(horas_base),
            "ajustado": horas_ajuste is not None,
            "inicio": inicio,
            "fin": inicio,
            "asignaciones": [],
        }

        if plantilla.tipo_tiempo == PlantillaOperacion.TipoTiempo.ESPERA:
            total_espera += horas_base
            fin = inicio + timedelta(days=math.ceil(horas_base / 24)) if horas_base > 0 else inicio
            detalle["fin"] = fin
            fin_por_plantilla[plantilla.id] = fin
        else:
            # Regla del taller: el bordado empieza 15 días antes de la entrega.
            if es_bordado(nombre) and inicio_bordado and horas_base > 0:
                holgura = (inicio_bordado - inicio).days
                holgura_bordado = holgura if holgura_bordado is None else min(holgura_bordado, holgura)
                if inicio < inicio_bordado:
                    inicio = inicio_bordado
                    detalle["regla"] = (
                        f"El bordado empieza {dias_bordado()} días antes de la entrega."
                    )

            horas = _q(horas_base * factor)
            if factor != 1:
                detalle["horas_con_holgura"] = str(horas)
            total_trabajo += horas
            habilitadas = capacidad.habilitadas_para(plantilla.operacion)
            if not habilitadas:
                advertencias.append(
                    f"{nombre}: no hay trabajadoras activas con esa habilidad o área."
                )

            asignadas, pendientes, primer_dia, ultimo_dia = asignar_horas(
                capacidad, habilitadas, horas, inicio
            )
            for (trabajadora_id, dia), tomar in asignadas:
                clave = (trabajadora_id, plantilla.id, dia)
                reservas[clave] = reservas.get(clave, CERO) + tomar
                detalle["asignaciones"].append({
                    "trabajadora_id": trabajadora_id,
                    "trabajadora": capacidad.nombres[trabajadora_id],
                    "fecha": dia,
                    "horas": str(tomar),
                })

            if pendientes > 0:
                total_sin_asignar += pendientes
                area = plantilla.operacion.area_responsable
                sin_asignar_por_area[area] = sin_asignar_por_area.get(area, CERO) + pendientes
                detalle["horas_sin_asignar"] = str(_q(pendientes))
                if habilitadas:
                    advertencias.append(
                        f"{nombre}: {_q(pendientes)} h no entran en la capacidad "
                        f"disponible de los próximos {HORIZONTE_DIAS} días."
                    )

            detalle["inicio"] = primer_dia or inicio
            detalle["fin"] = ultimo_dia or inicio
            fin_por_plantilla[plantilla.id] = ultimo_dia or inicio

        operaciones.append(detalle)
        anterior = plantilla

    fecha_fin = max(fin_por_plantilla.values()) if fin_por_plantilla else fecha_inicio
    return {
        "operaciones": operaciones,
        "reservas": reservas,
        "fecha_inicio": min((o["inicio"] for o in operaciones), default=fecha_inicio),
        "fecha_fin": fecha_fin,
        "horas_trabajo": _q(total_trabajo),
        "horas_espera": _q(total_espera),
        "horas_sin_asignar": _q(total_sin_asignar),
        "sin_asignar_por_area": sin_asignar_por_area,
        "holgura_bordado": holgura_bordado,
        "inicio_bordado": inicio_bordado if holgura_bordado is not None else None,
        "advertencias": advertencias,
    }


# ============================================================
# TEMPORADA ALTA
# ============================================================

def vestidos_activos_hasta(fecha):
    """Vestidos en el taller (no terminados) con fecha límite hasta `fecha`."""
    from django.db.models import F
    from django.db.models.functions import Coalesce

    return (
        VestidoContrato.objects.filter(
            ruta__isnull=False,
            contrato__estado__in=["ACTIVO", "EN_PRODUCCION"],
        )
        .exclude(estado=VestidoContrato.Estado.FINALIZADO)
        .annotate(limite=Coalesce("fecha_limite", F("contrato__fecha_entrega")))
        .filter(limite__lte=fecha)
    )


def evaluar_temporada_alta(capacidad, desde, hasta):
    """
    Hay temporada alta si el taller ya está muy cargado entre hoy y la
    fecha pedida, o si hay muchos vestidos activos para esas fechas.
    """
    umbral_carga = Decimal(str(getattr(settings, "FIANCEE_TEMPORADA_ALTA_CARGA", 0.70)))
    umbral_vestidos = getattr(settings, "FIANCEE_TEMPORADA_ALTA_VESTIDOS", 10)
    factor = Decimal(str(getattr(settings, "FIANCEE_TEMPORADA_ALTA_FACTOR", 1.20)))

    resumen = capacidad.resumen_por_area(desde, hasta)
    capacidad_total = sum((a["capacidad"] for a in resumen.values()), CERO)
    comprometidas = sum((a["comprometidas"] for a in resumen.values()), CERO)
    carga = (comprometidas / capacidad_total) if capacidad_total > 0 else Decimal("1")

    # Vestidos activos con entrega hasta 30 días después de la fecha pedida.
    vestidos = vestidos_activos_hasta(hasta + timedelta(days=30)).count()

    motivos = []
    if carga >= umbral_carga:
        motivos.append(
            f"el taller ya tiene comprometido el {round(float(carga) * 100)} % "
            "de su capacidad hasta la fecha pedida"
        )
    if vestidos >= umbral_vestidos:
        motivos.append(f"hay {vestidos} vestidos en producción para esas fechas")

    activa = bool(motivos)
    return {
        "activa": activa,
        "carga": round(float(carga), 4),
        "vestidos_en_produccion": vestidos,
        "umbral_carga": float(umbral_carga),
        "umbral_vestidos": umbral_vestidos,
        "factor": float(factor) if activa else 1.0,
        "motivo": (
            "Temporada alta: " + " y ".join(motivos)
            + f". Se suma una holgura del {round((float(factor) - 1) * 100)} % a las horas de trabajo."
        ) if activa else "",
    }


# ============================================================
# RESERVAS DE LOS VESTIDOS DEL CONTRATO
# ============================================================

def liberar_reservas_vestido(vestido):
    """
    Elimina las reservas del vestido que aún no tienen avance
    (RESERVADA, sin horas realizadas ni sesiones registradas).
    """
    reservas = ReservaOperacion.objects.filter(vestido=vestido)
    reservas.filter(
        estado=ReservaOperacion.Estado.RESERVADA,
        horas_realizadas=0,
        sesiones__isnull=True,
    ).delete()
    return reservas.exclude(estado=ReservaOperacion.Estado.CANCELADA).count()


def vestido_tiene_avance(vestido):
    if vestido.pk is None:
        return False
    if vestido.estado != VestidoContrato.Estado.PENDIENTE:
        return True
    if vestido.sesiones_trabajo.exists():
        return True
    if vestido.pasos.exclude(estado="PENDIENTE").exists():
        return True
    return ReservaOperacion.objects.filter(vestido=vestido).filter(
        Q(horas_realizadas__gt=0)
        | Q(estado__in=[
            ReservaOperacion.Estado.EN_PROCESO,
            ReservaOperacion.Estado.COMPLETADA,
        ])
        | Q(sesiones__isnull=False)
    ).exists()


def planificar_vestido(vestido, capacidad, fecha_inicio, factor=Decimal("1")):
    """
    Crea las reservas de producción de un vestido y devuelve el plan.
    El vestido debe estar guardado y no tener reservas activas.
    """
    fecha_limite = vestido.fecha_limite_efectiva
    resultado = {
        "vestido_id": vestido.id,
        "codigo": vestido.codigo,
        "tipo_vestido": str(vestido.tipo_vestido) if vestido.tipo_vestido_id else None,
        "taller": vestido.taller,
        "planificado": False,
        "fecha_inicio_estimada": None,
        "fecha_fin_estimada": None,
        "fecha_limite": fecha_limite,
        "a_tiempo": None,
        "horas_trabajo": "0.00",
        "horas_espera": "0.00",
        "horas_sin_asignar": "0.00",
        "operaciones": [],
        "advertencias": [],
    }

    if not vestido.ruta_id:
        resultado["advertencias"].append("Ítem sin taller asignado: no se reserva capacidad.")
        return resultado

    plantillas = plantillas_de_ruta(vestido.ruta_id)
    if not plantillas:
        resultado["advertencias"].append("La ruta no tiene operaciones activas configuradas.")
        return resultado

    ajustes = {a.plantilla_id: (a.horas, a.incluido) for a in vestido.procesos.all()}
    plan = calcular_plan(plantillas, ajustes, capacidad, fecha_inicio, fecha_limite, factor)

    ReservaOperacion.objects.bulk_create([
        ReservaOperacion(
            contrato=vestido.contrato,
            vestido=vestido,
            trabajadora_id=trabajadora_id,
            plantilla_id=plantilla_id,
            fecha=fecha,
            horas_reservadas=horas,
            observaciones=f"Planificación automática - {vestido.codigo}",
        )
        for (trabajadora_id, plantilla_id, fecha), horas in plan["reservas"].items()
    ])

    fecha_fin = plan["fecha_fin"]
    advertencias = list(plan["advertencias"])
    if fecha_fin > fecha_limite:
        advertencias.append(
            f"La producción terminaría el {fecha_fin.isoformat()}, después "
            f"de la fecha de recojo ({fecha_limite.isoformat()})."
        )

    vestido.fecha_fin_estimada = fecha_fin
    vestido.horas_sin_asignar = plan["horas_sin_asignar"]
    vestido.save(update_fields=["fecha_fin_estimada", "horas_sin_asignar"])

    resultado.update({
        "planificado": True,
        "fecha_inicio_estimada": plan["fecha_inicio"],
        "fecha_fin_estimada": fecha_fin,
        "a_tiempo": fecha_fin <= fecha_limite and plan["horas_sin_asignar"] == 0,
        "horas_trabajo": str(plan["horas_trabajo"]),
        "horas_espera": str(plan["horas_espera"]),
        "horas_sin_asignar": str(plan["horas_sin_asignar"]),
        "operaciones": plan["operaciones"],
        "advertencias": advertencias,
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
