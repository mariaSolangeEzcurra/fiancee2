"""
Personal y capacidad para la jefa de taller (solo lectura).

GET /api/core/produccion/personal/                 lista del personal con su estado de hoy
GET /api/core/produccion/personal/<id>/?dias=30    detalle: horario, permisos e historial
GET /api/core/produccion/capacidad-areas/?semana=0 capacidad por área y quién apoya en cada una
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    AusenciaTrabajadora,
    Operacion,
    PasoVestido,
    RegistroAsistencia,
    ReservaOperacion,
    SesionVestido,
    Trabajadora,
)
from core.services.jornada import cerrar_jornadas_vencidas
from core.services.planificacion import CapacidadTaller

from .views import PermisoProduccion

CERO = Decimal("0")
DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
AREA_NOMBRE = dict(Trabajadora.Area.choices)


def h(valor):
    """Decimal → float con 2 decimales (para JSON)."""
    return round(float(valor or 0), 2)


def iniciales(nombre):
    partes = [p for p in (nombre or "").split() if p]
    return "".join(p[0] for p in partes[:2]).upper() or "?"


def horario_de(trabajadora):
    por_dia = {d.dia_semana: d.horas_disponibles for d in trabajadora.horarios.all()}
    return [
        {"day": i, "label": DIAS[i], "longLabel": DIAS_LARGOS[i], "hours": h(por_dia.get(i, CERO))}
        for i in range(7)
    ]


def ausencia_del_dia(ausencias, fecha):
    for a in ausencias:
        if a.fecha_inicio <= fecha <= a.fecha_fin:
            return a
    return None


def serializar_ausencia(a):
    return {
        "id": a.id,
        "from": a.fecha_inicio,
        "to": a.fecha_fin,
        "hours": h(a.horas_no_disponibles),
        "reason": a.motivo,
    }


def horas_jornada(registro, ahora):
    if registro.salida:
        return h(registro.horas_trabajadas)
    return h(max(0, (ahora - registro.entrada).total_seconds() / 3600))


def estado_hoy(trabajadora, registro, horas_hoy, ausencia):
    """Trabajando · Terminó · Aún no marca · Descanso · Permiso."""
    if registro and not registro.salida:
        return "TRABAJANDO"
    if registro and registro.salida:
        return "TERMINO"
    if ausencia:
        return "PERMISO"
    if horas_hoy <= 0:
        return "DESCANSO"
    return "SIN_MARCAR"


class PersonalTallerView(APIView):
    """Lista del personal de taller con su estado de hoy."""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_personal", responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        cerrar_jornadas_vencidas()
        hoy = timezone.localdate()
        ahora = timezone.now()
        lunes = hoy - timedelta(days=hoy.weekday())

        trabajadoras = (
            Trabajadora.objects.filter(activa=True)
            .prefetch_related("horarios", "habilidades")
            .order_by("nombre", "id")
        )
        hoy_por_id = {
            r.trabajadora_id: r
            for r in RegistroAsistencia.objects.filter(fecha=hoy, trabajadora__in=trabajadoras)
        }
        semana = {}
        for r in RegistroAsistencia.objects.filter(fecha__range=(lunes, hoy), trabajadora__in=trabajadoras):
            semana[r.trabajadora_id] = semana.get(r.trabajadora_id, 0) + horas_jornada(r, ahora) + h(r.horas_extra)
        ausencias = {}
        for a in AusenciaTrabajadora.objects.filter(fecha_fin__gte=hoy, trabajadora__in=trabajadoras):
            ausencias.setdefault(a.trabajadora_id, []).append(a)
        sesiones = {
            s.trabajadora_id: s
            for s in SesionVestido.objects.filter(
                estado__in=[SesionVestido.Estado.EN_CURSO, SesionVestido.Estado.PAUSADA]
            ).select_related("vestido", "paso")
        }
        asignados = {}
        for paso in PasoVestido.objects.filter(
            estado__in=[PasoVestido.Estado.PENDIENTE, PasoVestido.Estado.EN_CURSO],
            vestido__estado__in=["PENDIENTE", "EN_PROCESO"],
        ).prefetch_related("trabajadoras"):
            for t in paso.trabajadoras.all():
                asignados.setdefault(t.id, set()).add(paso.vestido_id)

        items = []
        for t in trabajadoras:
            horario = horario_de(t)
            horas_hoy = horario[hoy.weekday()]["hours"]
            registro = hoy_por_id.get(t.id)
            ausencia = ausencia_del_dia(ausencias.get(t.id, []), hoy)
            sesion = sesiones.get(t.id)
            items.append({
                "id": str(t.id),
                "name": t.nombre,
                "initials": iniciales(t.nombre),
                "area": AREA_NOMBRE.get(t.area, t.area),
                "areaCode": t.area,
                "skills": [
                    {"id": op.id, "name": op.nombre, "area": AREA_NOMBRE.get(op.area_responsable, op.area_responsable)}
                    for op in t.habilidades.all()
                ],
                "schedule": horario,
                "weekHours": round(sum(d["hours"] for d in horario), 2),
                "weekWorked": round(semana.get(t.id, 0), 2),
                "today": {
                    "status": estado_hoy(t, registro, horas_hoy, ausencia),
                    "scheduled": horas_hoy,
                    "checkIn": registro.entrada if registro else None,
                    "checkOut": registro.salida if registro else None,
                    "absence": serializar_ausencia(ausencia) if ausencia else None,
                },
                "activeSession": (
                    {
                        "dress": sesion.vestido.codigo,
                        "process": sesion.paso.nombre if sesion.paso else "",
                        "paused": sesion.estado == SesionVestido.Estado.PAUSADA,
                        "start": sesion.inicio,
                    }
                    if sesion else None
                ),
                "assignedDresses": len(asignados.get(t.id, ())),
                "upcomingAbsences": [serializar_ausencia(a) for a in ausencias.get(t.id, []) if a.fecha_inicio > hoy][:3],
            })
        return Response(items)


class PersonalDetalleView(APIView):
    """Horario, permisos e historial de días trabajados de una trabajadora."""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_personal_detalle", responses={200: OpenApiTypes.OBJECT})
    def get(self, request, pk):
        t = get_object_or_404(Trabajadora.objects.prefetch_related("horarios", "habilidades"), pk=pk)
        cerrar_jornadas_vencidas(t)
        try:
            dias = max(7, min(120, int(request.query_params.get("dias", 30))))
        except ValueError:
            dias = 30
        hoy = timezone.localdate()
        ahora = timezone.now()
        desde = hoy - timedelta(days=dias - 1)
        horario = horario_de(t)

        registros = {
            r.fecha: r
            for r in t.asistencias.filter(fecha__range=(desde, hoy)).prefetch_related(
                Prefetch(
                    "sesiones_vestidos",
                    queryset=SesionVestido.objects.select_related("vestido", "paso").prefetch_related("pausas").order_by("inicio"),
                )
            )
        }
        ausencias = list(t.ausencias.filter(fecha_fin__gte=desde).order_by("fecha_inicio"))

        historial = []
        tot = {"days": 0, "hours": 0.0, "extra": 0.0, "auto": 0, "missed": 0, "absences": 0, "dresses": set()}
        dia = hoy
        while dia >= desde:
            programadas = horario[dia.weekday()]["hours"]
            r = registros.get(dia)
            ausencia = ausencia_del_dia(ausencias, dia)
            if r:
                horas = horas_jornada(r, ahora)
                sesiones = [
                    {
                        "id": s.id,
                        "dress": s.vestido.codigo,
                        "process": s.paso.nombre if s.paso else "",
                        "start": s.inicio,
                        "end": s.fin,
                        "hours": h(s.horas_efectivas),
                        "pauses": len(s.pausas.all()),
                        "notes": s.observaciones,
                        "open": s.fin is None,
                    }
                    for s in r.sesiones_vestidos.all()
                ]
                if r.salida is None:
                    estado = "TRABAJANDO"
                elif r.cierre_automatico:
                    estado = "CIERRE_AUTOMATICO"
                elif programadas and horas + 0.25 < programadas:
                    estado = "SALIO_ANTES"
                else:
                    estado = "COMPLETO"
                historial.append({
                    "date": dia,
                    "status": estado,
                    "scheduled": programadas,
                    "checkIn": r.entrada,
                    "checkOut": r.salida,
                    "hours": horas,
                    "extra": h(r.horas_extra),
                    "extraReason": r.motivo_horas_extra,
                    "auto": r.cierre_automatico,
                    "notesIn": r.observaciones_entrada,
                    "notesOut": r.observaciones_salida,
                    "sessions": sesiones,
                    "absence": serializar_ausencia(ausencia) if ausencia else None,
                })
                tot["days"] += 1
                tot["hours"] += horas
                tot["extra"] += h(r.horas_extra)
                tot["auto"] += int(r.cierre_automatico)
                tot["dresses"].update(s["dress"] for s in sesiones)
            elif ausencia:
                historial.append({"date": dia, "status": "PERMISO", "scheduled": programadas,
                                  "absence": serializar_ausencia(ausencia), "sessions": []})
                tot["absences"] += 1
            elif programadas > 0 and dia < hoy:
                historial.append({"date": dia, "status": "NO_VINO", "scheduled": programadas, "sessions": []})
                tot["missed"] += 1
            dia -= timedelta(days=1)

        return Response({
            "id": str(t.id),
            "name": t.nombre,
            "initials": iniciales(t.nombre),
            "area": AREA_NOMBRE.get(t.area, t.area),
            "notes": t.observaciones,
            "skills": [
                {"id": op.id, "name": op.nombre, "area": AREA_NOMBRE.get(op.area_responsable, op.area_responsable)}
                for op in t.habilidades.all()
            ],
            "schedule": horario,
            "weekHours": round(sum(d["hours"] for d in horario), 2),
            "absences": [serializar_ausencia(a) for a in ausencias if a.fecha_fin >= hoy],
            "range": {"from": desde, "to": hoy, "days": dias},
            "totals": {
                "daysWorked": tot["days"],
                "hours": round(tot["hours"], 2),
                "extraHours": round(tot["extra"], 2),
                "avgHours": round(tot["hours"] / tot["days"], 2) if tot["days"] else 0,
                "autoClosed": tot["auto"],
                "missed": tot["missed"],
                "absences": tot["absences"],
                "dresses": len(tot["dresses"]),
            },
            "history": historial,
        })


class CapacidadAreasView(APIView):
    """
    Capacidad de la semana por área. En cada área cuentan las personas que
    saben hacer algún proceso de esa área (una persona puede apoyar en varias).
    """

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_capacidad_areas", responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        try:
            semana = max(0, min(8, int(request.query_params.get("semana", 0))))
        except ValueError:
            semana = 0
        hoy = timezone.localdate()
        desde = hoy + timedelta(days=7 * semana)
        hasta = desde + timedelta(days=6)
        cap = CapacidadTaller(desde, dias=6)
        dias = [desde + timedelta(days=i) for i in range(7)]

        operaciones = list(Operacion.objects.filter(activa=True).order_by("nombre"))
        trabajo_area = {}
        trabajo_op = {}
        for r in ReservaOperacion.objects.filter(fecha__range=(desde, hasta)).exclude(
            estado=ReservaOperacion.Estado.CANCELADA
        ).select_related("plantilla__operacion"):
            op = r.plantilla.operacion
            pendiente = max(CERO, r.horas_reservadas - r.horas_realizadas)
            if r.estado == ReservaOperacion.Estado.COMPLETADA:
                pendiente = CERO
            trabajo_area[op.area_responsable] = trabajo_area.get(op.area_responsable, CERO) + pendiente
            trabajo_op[op.id] = trabajo_op.get(op.id, CERO) + pendiente

        def semana_de(tid):
            base = sum((cap.base(tid, d) for d in dias), CERO)
            usadas = sum((min(cap.base(tid, d), cap.usadas.get((tid, d), CERO)) for d in dias), CERO)
            return base, usadas

        areas = []
        for codigo, nombre in Trabajadora.Area.choices:
            ops = [op for op in operaciones if op.area_responsable == codigo]
            if not ops:
                continue
            apoyo = {}
            procesos = []
            for op in ops:
                habil = cap.habilitadas_para(op)
                procesos.append({
                    "id": op.id,
                    "name": op.nombre,
                    "workers": [t.nombre for t in habil],
                    "pendingHours": h(trabajo_op.get(op.id, CERO)),
                })
                for t in habil:
                    apoyo.setdefault(t.id, {"t": t, "procesos": []})["procesos"].append(op.nombre)

            capacidad = usadas = CERO
            personas = []
            for tid, info in apoyo.items():
                base, ocup = semana_de(tid)
                capacidad += base
                usadas += ocup
                personas.append({
                    "id": str(tid),
                    "name": info["t"].nombre,
                    "initials": iniciales(info["t"].nombre),
                    "mainArea": AREA_NOMBRE.get(info["t"].area, info["t"].area),
                    "processes": info["procesos"],
                    "hours": h(base),
                    "busy": h(ocup),
                    "free": h(max(CERO, base - ocup)),
                })
            personas.sort(key=lambda p: (-p["free"], p["name"]))

            por_dia = []
            for d in dias:
                b = sum((cap.base(tid, d) for tid in apoyo), CERO)
                u = sum((min(cap.base(tid, d), cap.usadas.get((tid, d), CERO)) for tid in apoyo), CERO)
                por_dia.append({"date": d, "label": DIAS[d.weekday()], "capacity": h(b), "busy": h(u)})

            libre = max(CERO, capacidad - usadas)
            pendiente = trabajo_area.get(codigo, CERO)
            uso = float(usadas / capacidad) if capacidad else (1.0 if pendiente else 0.0)
            if capacidad == 0:
                estado = "SIN_PERSONAL" if pendiente or ops else "LIBRE"
            elif uso >= 0.95:
                estado = "LLENA"
            elif uso >= 0.8:
                estado = "CASI_LLENA"
            else:
                estado = "CON_ESPACIO"

            areas.append({
                "code": codigo,
                "name": nombre,
                "status": estado,
                "capacity": h(capacidad),
                "busy": h(usadas),
                "free": h(libre),
                "pendingHours": h(pendiente),
                "utilization": round(uso, 3),
                "people": len(personas),
                "workers": personas,
                "processes": procesos,
                "days": por_dia,
            })

        orden = {"SIN_PERSONAL": 0, "LLENA": 1, "CASI_LLENA": 2, "CON_ESPACIO": 3, "LIBRE": 4}
        areas.sort(key=lambda a: (orden[a["status"]], -a["utilization"]))
        return Response({
            "week": semana,
            "from": desde,
            "to": hasta,
            "totals": {
                "people": Trabajadora.objects.filter(activa=True).count(),
                "pendingHours": h(sum(trabajo_area.values(), CERO)),
                "capacity": h(sum((cap.base(t.id, d) for t in cap.trabajadoras for d in dias), CERO)),
                "busy": h(sum((min(cap.base(t.id, d), cap.usadas.get((t.id, d), CERO)) for t in cap.trabajadoras for d in dias), CERO)),
            },
            "areas": areas,
        })
