"""
Área comercial (solo lectura).

GET /api/core/comercial/inicio/                            resumen del día para comercial
GET /api/core/comercial/ingresos/?mes=AAAA-MM&metodo=&origen=contrato|taller&q=
                                                           ingresos (pagos cobrados) del mes
"""

from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Prefetch, Q, Sum
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Contrato, Pago, PasoVestido, SimulacionContrato, VestidoContrato
from core.services.produccion import recordatorios_vestido

CERO = Decimal("0")
ACTIVOS = ["ACTIVO", "EN_PRODUCCION"]
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"]
MESES_LARGOS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
]
METODOS = dict(Pago.Metodo.choices)
TALLER = {"A": "Taller A", "C": "Taller C", "T": "Tienda"}


class PermisoComercial(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser or getattr(request.user, "rol", None) in ("comercial", "gerencia")


def f(valor):
    return round(float(valor or 0), 2)


def inicio_mes(d):
    return d.replace(day=1)


def mes_siguiente(d):
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def mes_anterior(d):
    return (d.replace(day=1) - timedelta(days=1)).replace(day=1)


def etiqueta_mes(d, larga=False):
    return f"{(MESES_LARGOS if larga else MESES)[d.month - 1]} {d.year}"


def cobrado(desde, hasta, extra=None):
    qs = Pago.objects.filter(confirmado=True, fecha__gte=desde, fecha__lt=hasta)
    if extra is not None:
        qs = qs.filter(extra)
    return qs.aggregate(t=Sum("importe"))["t"] or CERO


def vendido(desde, hasta):
    qs = Contrato.objects.filter(fecha_firma__gte=desde, fecha_firma__lt=hasta).exclude(estado="CANCELADO")
    return qs.count(), qs.aggregate(t=Sum("precio_total"))["t"] or CERO


def saldos_activos():
    """{contrato_id: saldo} de contratos activos (con lo cobrado)."""
    pagado = {
        r["contrato_id"]: r["t"]
        for r in Pago.objects.filter(confirmado=True, contrato__estado__in=ACTIVOS)
        .values("contrato_id").annotate(t=Sum("importe"))
    }
    return {
        c.id: c.precio_total - pagado.get(c.id, CERO)
        for c in Contrato.objects.filter(estado__in=ACTIVOS).only("id", "precio_total")
    }


def estado_vestido(vestido, pasos):
    """Estado sencillo para comercial."""
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        return "LISTO", "Listo para recoger"
    if not vestido.ruta_id:
        return "SIN_TALLER", "Sin taller"
    if not pasos or all(p.estado == PasoVestido.Estado.PENDIENTE for p in pasos):
        return "SIN_INICIAR", "Sin iniciar"
    return "EN_PROCESO", "En proceso"


class InicioComercialView(APIView):
    permission_classes = [PermisoComercial]

    @extend_schema(operation_id="comercial_inicio", tags=["comercial"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        hoy = timezone.localdate()
        mes = inicio_mes(hoy)
        sig = mes_siguiente(mes)
        ant = mes_anterior(mes)

        cobrado_mes = cobrado(mes, sig)
        # Comparación justa: el mes pasado hasta el mismo día.
        dia_equivalente = min(hoy.day, (mes - timedelta(days=1)).day)
        cobrado_ant = cobrado(ant, ant.replace(day=dia_equivalente) + timedelta(days=1))
        n_mes, vendido_mes = vendido(mes, sig)
        saldos = saldos_activos()
        por_cobrar = sum((s for s in saldos.values() if s > 0), CERO)

        # Vestidos de contratos activos.
        vestidos = list(
            VestidoContrato.objects.filter(contrato__estado__in=ACTIVOS)
            .select_related("contrato", "contrato__cliente", "tipo_vestido", "ruta")
            .prefetch_related(Prefetch("pasos", queryset=PasoVestido.objects.order_by("orden")))
        )
        entregas, recordatorios = [], []
        en_taller = atrasados = listos = 0
        for v in vestidos:
            pasos = list(v.pasos.all())
            codigo, etiqueta = estado_vestido(v, pasos)
            limite = v.fecha_limite_efectiva
            dias = (limite - hoy).days
            if codigo in ("SIN_INICIAR", "EN_PROCESO"):
                en_taller += 1
                if dias < 0:
                    atrasados += 1
            if codigo == "LISTO":
                listos += 1
            trabajo = [p for p in pasos if not p.es_entrega]
            hechos = sum(1 for p in trabajo if p.estado == PasoVestido.Estado.COMPLETADO)
            actual = next((p for p in pasos if p.estado != PasoVestido.Estado.COMPLETADO), None)
            if dias <= 30:
                c = v.contrato
                if codigo == "LISTO":
                    tono = "ok"
                elif dias < 0:
                    tono = "late"
                elif v.fecha_fin_estimada and v.fecha_fin_estimada > limite:
                    tono = "late"
                elif dias <= 7:
                    tono = "risk"
                else:
                    tono = "progress" if codigo == "EN_PROCESO" else "idle"
                entregas.append({
                    "dressId": str(v.id) if v.ruta_id else None,
                    "code": v.codigo,
                    "dressType": v.tipo_vestido.nombre if v.tipo_vestido_id else (v.descripcion or "Ítem"),
                    "workshop": TALLER.get(v.ruta.taller, "") if v.ruta_id else "",
                    "contractId": c.id,
                    "contract": c.numero,
                    "client": c.cliente.nombre if c.cliente_id else "",
                    "phone": c.cliente.telefono if c.cliente_id else "",
                    "date": limite,
                    "eventDate": c.fecha_evento,
                    "daysLeft": dias,
                    "status": codigo,
                    "statusLabel": etiqueta,
                    "tone": tono,
                    "progress": round(hechos / len(trabajo), 2) if trabajo else (1 if codigo == "LISTO" else 0),
                    "currentProcess": actual.nombre if actual and codigo == "EN_PROCESO" else "",
                    "balance": f(max(CERO, saldos.get(c.id, CERO))),
                })
            for aviso in recordatorios_vestido(v, pasos, hoy):
                if aviso["type"] == "PRIMERA_PRUEBA":
                    recordatorios.append({
                        **aviso,
                        "code": v.codigo,
                        "client": v.contrato.cliente.nombre if v.contrato.cliente_id else "",
                        "phone": v.contrato.cliente.telefono if v.contrato.cliente_id else "",
                        "contractId": v.contrato_id,
                    })
        entregas.sort(key=lambda e: (e["date"], e["code"]))
        recordatorios.sort(key=lambda r: r["date"])

        # Cobrar antes del recojo (próximos 15 días o ya vencidos).
        cobrar = []
        for c in Contrato.objects.filter(estado__in=ACTIVOS, fecha_entrega__lte=hoy + timedelta(days=15)).select_related("cliente"):
            saldo = saldos.get(c.id, CERO)
            if saldo > 0:
                cobrar.append({
                    "contractId": c.id,
                    "contract": c.numero,
                    "client": c.cliente.nombre if c.cliente_id else "",
                    "phone": c.cliente.telefono if c.cliente_id else "",
                    "date": c.fecha_entrega,
                    "daysLeft": (c.fecha_entrega - hoy).days,
                    "balance": f(saldo),
                    "total": f(c.precio_total),
                })
        cobrar.sort(key=lambda x: x["date"])

        eventos = [
            {
                "contractId": c.id,
                "contract": c.numero,
                "client": c.cliente.nombre if c.cliente_id else "",
                "date": c.fecha_evento,
                "daysLeft": (c.fecha_evento - hoy).days,
                "type": c.get_tipo_evento_display() if c.tipo_evento != "OTRO" else (c.tipo_evento_detalle or "Evento"),
            }
            for c in Contrato.objects.filter(
                estado__in=ACTIVOS + ["ENTREGADO"], fecha_evento__range=(hoy, hoy + timedelta(days=21))
            ).select_related("cliente").order_by("fecha_evento")
        ]

        sims = SimulacionContrato.objects.filter(fecha_simulacion__date__gte=mes, fecha_simulacion__date__lt=sig)
        n_sims = sims.count()
        n_aceptadas = sims.filter(estado=SimulacionContrato.Estado.ACEPTADA).count()

        # Últimos 6 meses: vendido y cobrado.
        meses = []
        m = mes
        for _ in range(6):
            s = mes_siguiente(m)
            n, total = vendido(m, s)
            meses.append({"month": m.strftime("%Y-%m"), "label": etiqueta_mes(m), "sold": f(total), "contracts": n, "collected": f(cobrado(m, s))})
            m = mes_anterior(m)
        meses.reverse()

        return Response({
            "today": hoy,
            "monthLabel": etiqueta_mes(mes, larga=True),
            "kpis": {
                "collectedMonth": f(cobrado_mes),
                "collectedPrev": f(cobrado_ant),
                "soldMonth": f(vendido_mes),
                "contractsMonth": n_mes,
                "toCollect": f(por_cobrar),
                "contractsWithBalance": sum(1 for s in saldos.values() if s > 0),
                "inWorkshop": en_taller,
                "late": atrasados,
                "ready": listos,
                "simulations": n_sims,
                "simulationsAccepted": n_aceptadas,
            },
            "deliveries": entregas[:40],
            "collect": cobrar[:20],
            "events": eventos[:10],
            "reminders": recordatorios[:10],
            "months": meses,
        })


class IngresosComercialView(APIView):
    permission_classes = [PermisoComercial]

    @extend_schema(operation_id="comercial_ingresos", tags=["comercial"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        hoy = timezone.localdate()
        texto = request.query_params.get("mes") or hoy.strftime("%Y-%m")
        try:
            anio, numero = (int(x) for x in texto.split("-"))
            mes = date(anio, numero, 1)
        except (ValueError, TypeError):
            mes = inicio_mes(hoy)
        sig = mes_siguiente(mes)
        ant = mes_anterior(mes)

        base = Pago.objects.filter(confirmado=True, fecha__gte=mes, fecha__lt=sig).select_related(
            "contrato", "contrato__cliente", "vestido", "registrado_por"
        )
        metodo = request.query_params.get("metodo") or ""
        origen = request.query_params.get("origen") or ""
        q = (request.query_params.get("q") or "").strip()
        filtrados = base
        if metodo:
            filtrados = filtrados.filter(metodo=metodo)
        if origen == "taller":
            filtrados = filtrados.filter(vestido__isnull=False)
        elif origen == "contrato":
            filtrados = filtrados.filter(vestido__isnull=True)
        if q:
            filtrados = filtrados.filter(
                Q(contrato__numero__icontains=q) | Q(contrato__cliente__nombre__icontains=q)
                | Q(concepto__icontains=q) | Q(referencia__icontains=q)
            )
        pagos = list(filtrados.order_by("-fecha", "-id"))

        total = sum((p.importe for p in pagos), CERO)
        total_mes = base.aggregate(t=Sum("importe"))["t"] or CERO
        total_ant = cobrado(ant, mes)

        por_metodo = []
        for codigo, nombre in Pago.Metodo.choices:
            t = sum((p.importe for p in pagos if p.metodo == codigo), CERO)
            n = sum(1 for p in pagos if p.metodo == codigo)
            if n:
                por_metodo.append({"code": codigo, "label": nombre, "total": f(t), "count": n})
        por_metodo.sort(key=lambda x: -x["total"])

        def tipo(p):
            if p.orden_adelanto == 1:
                return "Primer pago"
            if p.orden_adelanto == 2:
                return "Segundo pago"
            if p.orden_adelanto == 3:
                return "Tercer pago"
            return "Otros pagos"

        tipos = {}
        for p in pagos:
            t = tipos.setdefault(tipo(p), {"label": tipo(p), "total": CERO, "count": 0})
            t["total"] += p.importe
            t["count"] += 1
        orden_tipos = ["Primer pago", "Segundo pago", "Tercer pago", "Otros pagos"]
        por_tipo = [
            {"label": t["label"], "total": f(t["total"]), "count": t["count"]}
            for t in sorted(tipos.values(), key=lambda x: orden_tipos.index(x["label"]))
        ]

        dias = []
        d = mes
        while d < sig:
            dias.append({"date": d, "day": d.day, "total": f(sum((p.importe for p in pagos if p.fecha == d), CERO))})
            d += timedelta(days=1)
        mejor = max(dias, key=lambda x: x["total"]) if pagos else None

        n_vendidos, monto_vendido = vendido(mes, sig)
        saldos = saldos_activos()
        recojo_mes = Contrato.objects.filter(estado__in=ACTIVOS, fecha_entrega__gte=mes, fecha_entrega__lt=sig)
        por_cobrar_mes = sum((max(CERO, saldos.get(c.id, CERO)) for c in recojo_mes), CERO)

        historial = []
        m = mes
        for _ in range(12):
            s = mes_siguiente(m)
            historial.append({"month": m.strftime("%Y-%m"), "label": etiqueta_mes(m), "total": f(cobrado(m, s))})
            m = mes_anterior(m)
        historial.reverse()

        return Response({
            "month": mes.strftime("%Y-%m"),
            "monthLabel": etiqueta_mes(mes, larga=True),
            "isCurrent": mes == inicio_mes(hoy),
            "filters": {"metodo": metodo, "origen": origen, "q": q},
            "totals": {
                "total": f(total),
                "monthTotal": f(total_mes),
                "prevMonth": f(total_ant),
                "count": len(pagos),
                "average": f(total / len(pagos)) if pagos else 0,
                "contracts": len({p.contrato_id for p in pagos}),
                "fromWorkshop": f(sum((p.importe for p in pagos if p.vestido_id), CERO)),
                "soldMonth": f(monto_vendido),
                "contractsSold": n_vendidos,
                "toCollectMonth": f(por_cobrar_mes),
                "toCollectAll": f(sum((s for s in saldos.values() if s > 0), CERO)),
                "bestDay": mejor if mejor and mejor["total"] > 0 else None,
            },
            "byMethod": por_metodo,
            "byType": por_tipo,
            "days": dias,
            "months": historial,
            "payments": [
                {
                    "id": p.id,
                    "date": p.fecha,
                    "amount": f(p.importe),
                    "concept": p.concepto,
                    "number": p.orden_adelanto,
                    "method": p.metodo,
                    "methodLabel": METODOS.get(p.metodo, p.metodo),
                    "reference": p.referencia,
                    "notes": p.observaciones,
                    "contractId": p.contrato_id,
                    "contract": p.contrato.numero,
                    "client": p.contrato.cliente.nombre if p.contrato.cliente_id else "",
                    "fromWorkshop": bool(p.vestido_id),
                    "dressCode": p.vestido.codigo if p.vestido_id else None,
                    "by": (p.registrado_por.get_full_name() or p.registrado_por.username) if p.registrado_por_id else "",
                }
                for p in pagos
            ],
        })
