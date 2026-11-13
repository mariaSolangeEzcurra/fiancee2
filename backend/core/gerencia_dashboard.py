"""
Dashboard gerencial de FIANCÉE.

Tres niveles de medición:
  - Financiero:  ¿La empresa gana dinero?
  - Operativo:   ¿El taller produce eficientemente?
  - Estratégico: ¿Los recursos que tenemos están generando rentabilidad?

GET /api/core/gerencia/dashboard/?meses=6            indicadores del periodo, del periodo anterior y mes a mes
GET /api/core/gerencia/dashboard/capacidad/          horas disponibles vs. asignadas por semana y área
GET /api/core/gerencia/dashboard/finanzas/           pagos atrasados, cobros, saldos y trazabilidad
GET /api/core/gerencia/dashboard/reporte/?meses=6    Excel con la comparación mensual

Definiciones (las mismas que se muestran al pasar el mouse en la pantalla):
  Eficiencia de mano de obra   = horas estándar / horas reales × 100
  Desviación de horas          = horas reales − horas estándar
  Costo de mano de obra/vestido = costo total de mano de obra / vestidos terminados
  Utilidad bruta               = ingresos atribuibles − costos de producción
  Margen bruto                 = utilidad bruta / ingresos atribuibles × 100
  Cumplimiento de entregas     = vestidos entregados a tiempo / vestidos entregados × 100
  Capacidad utilizada          = horas asignadas / horas disponibles × 100
  Índice de retrabajo          = horas de retrabajo / horas reales × 100
"""

import unicodedata
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from rest_framework.response import Response
from rest_framework.views import APIView

from core.comercial_views import ACTIVOS, etiqueta_mes, mes_anterior, mes_siguiente
from core.gerencia_analisis import es_planilla, horas_programadas, margen, sueldo_en_mes
from core.gerencia_views import CERO, METODOS, PermisoGerencia, f, ingresos
from core.models import (
    Contrato,
    CostoOperativo,
    Gasto,
    Pago,
    PasoVestido,
    PlantillaOperacion,
    SesionVestido,
    Trabajadora,
    VestidoContrato,
)
from core.services.planificacion import CapacidadTaller

# Gastos que forman parte del costo de producción (materiales directos).
PALABRAS_PRODUCCION = ("tela", "encaje", "pedrer", "avio", "material", "insumo", "lavander", "hilo", "bordad", "confecc", "tinte")


def _norm(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def es_produccion(nombre_categoria):
    n = _norm(nombre_categoria)
    return any(p in n for p in PALABRAS_PRODUCCION)


def _pct(a, b):
    return round(float(a) / float(b) * 100, 1) if b else None


def _r(x, n=1):
    return round(float(x), n) if x is not None else None


def _div(a, b):
    return (a / b) if b else None


def _periodo(request):
    try:
        meses = max(1, min(12, int(request.query_params.get("meses", 6))))
    except ValueError:
        meses = 6
    hoy = timezone.localdate()
    ini = hoy.replace(day=1)
    fin = mes_siguiente(ini)
    for _ in range(meses - 1):
        ini = mes_anterior(ini)
    return ini, fin, meses, hoy


def _rango_meses(ini, fin):
    m = ini
    while m < fin:
        yield m, mes_siguiente(m)
        m = mes_siguiente(m)


class Calculo:
    """Calcula todos los indicadores para un rango [ini, fin)."""

    def __init__(self):
        self.personal = list(Trabajadora.objects.filter(activa=True))
        self.hay_sueldos = any(t.sueldo_mensual > 0 for t in self.personal)
        fijos = list(CostoOperativo.objects.filter(activo=True).select_related("categoria"))
        if self.hay_sueldos:
            fijos = [c for c in fijos if not es_planilla(c.categoria.nombre)]
        self.fijos = fijos
        self.categorias_fijas = {c.categoria_id for c in fijos}

    # ---- piezas ----
    def terminados(self, ini, fin):
        """Vestidos (con taller) cuyo último proceso se terminó en el rango."""
        filas = []
        qs = (
            VestidoContrato.objects.filter(estado="FINALIZADO", ruta__isnull=False)
            .select_related("contrato__cliente", "tipo_vestido", "ruta").prefetch_related("pasos")
        )
        for v in qs:
            fechas = [p.completado_en for p in v.pasos.all() if p.completado_en]
            if not fechas:
                continue
            termino = timezone.localtime(max(fechas)).date()
            if ini <= termino < fin:
                filas.append((v, termino, termino <= v.fecha_limite_efectiva))
        return filas

    def sesiones(self, ini, fin):
        return list(
            SesionVestido.objects.filter(jornada__fecha__gte=ini, jornada__fecha__lt=fin)
            .select_related("paso").prefetch_related("pausas")
        )

    def costos(self, ini, fin):
        """Sueldos, materiales (producción), fijos y otros gastos del rango."""
        sueldos = CERO
        fijos = CERO
        for m, s in _rango_meses(ini, fin):
            sueldos += sum((sueldo_en_mes(t, m, s) for t in self.personal), CERO)
            fijos += sum((c.monto_mensual() for c in self.fijos if c.aplica_en(m)), CERO)
        materiales = CERO
        otros = CERO
        for g in Gasto.objects.filter(fecha__gte=ini, fecha__lt=fin, costo_fijo__isnull=True).select_related("categoria"):
            nombre = g.categoria.nombre
            if (self.hay_sueldos and es_planilla(nombre)) or g.categoria_id in self.categorias_fijas:
                continue
            if es_produccion(nombre):
                materiales += g.importe
            else:
                otros += g.importe
        return sueldos, materiales, fijos, otros

    # ---- indicadores ----
    def indicadores(self, ini, fin):
        hoy = timezone.localdate()
        term = self.terminados(ini, fin)
        n_term = len(term)
        a_tiempo = sum(1 for _, _, ok in term if ok)
        ingresos_atrib = sum((v.precio + v.precio_otros for v, _, _ in term), CERO)

        sueldos, materiales, fijos, otros = self.costos(ini, fin)
        costo_mo = sueldos
        costo_prod = sueldos + materiales
        utilidad_bruta = ingresos_atrib - costo_prod
        utilidad_oper = utilidad_bruta - fijos - otros

        # Horas estándar vs. reales en procesos terminados en el rango.
        ses = self.sesiones(ini, fin)
        horas_reales_total = sum((s.horas_efectivas for s in ses), CERO)
        horas_retrabajo = sum((s.horas_efectivas for s in ses if s.paso_id and s.paso.es_retrabajo), CERO)
        reales_paso = defaultdict(lambda: CERO)
        for s in SesionVestido.objects.filter(
            paso__estado=PasoVestido.Estado.COMPLETADO, paso__completado_en__date__gte=ini, paso__completado_en__date__lt=fin
        ).prefetch_related("pausas"):
            reales_paso[s.paso_id] += s.horas_efectivas
        estandar = CERO
        reales = CERO
        for p in PasoVestido.objects.filter(pk__in=reales_paso.keys(), tipo_tiempo=PlantillaOperacion.TipoTiempo.TRABAJO):
            if p.es_retrabajo:
                continue  # el retrabajo no tiene "estándar": se mide aparte
            estandar += p.horas_estimadas
            reales += reales_paso[p.id]

        # Capacidad: horas disponibles (horario − ausencias) vs. asignadas por el planificador.
        cap = CapacidadTaller(ini, dias=(fin - ini).days + 1)
        resumen = cap.resumen_por_area(ini, fin - timedelta(days=1))
        disponibles = sum((a["capacidad"] for a in resumen.values()), CERO)
        asignadas = sum((a["comprometidas"] for a in resumen.values()), CERO)

        horas_pagadas = sum(horas_programadas([t.id for t in self.personal], ini, fin).values(), CERO)
        cobrado = ingresos(ini, fin).aggregate(t=Sum("importe"))["t"] or CERO
        vendido = (
            Contrato.objects.filter(fecha_firma__gte=ini, fecha_firma__lt=fin).exclude(estado="CANCELADO")
            .aggregate(t=Sum("precio_total"))["t"] or CERO
        )

        from core.estado_resultados import estado
        er = estado(ini, fin)
        eficiencia = _pct(estandar, reales)
        capacidad = _pct(asignadas, disponibles)
        return {
            # Componentes (para mostrar la fórmula con números).
            "c": {
                "horasEstandar": _r(estandar), "horasReales": _r(reales),
                "horasRealesTotal": _r(horas_reales_total), "horasRetrabajo": _r(horas_retrabajo),
                "costoManoObra": f(costo_mo), "materiales": f(materiales), "costoProduccion": f(costo_prod),
                "fijos": f(fijos), "otros": f(otros),
                "ingresosAtribuibles": f(ingresos_atrib), "vestidosTerminados": n_term, "aTiempo": a_tiempo,
                "horasDisponibles": _r(disponibles), "horasAsignadas": _r(asignadas), "horasPagadas": _r(horas_pagadas),
                "cobrado": f(cobrado), "vendido": f(vendido),
                "utilidadBruta": f(utilidad_bruta), "utilidadOperativa": f(utilidad_oper),
                "ventas": f(er["contable"]["ventas"]), "erOperativa": f(er["contable"]["operativa"]),
                "impuestos": f(er["contable"]["impuestos"]), "erNeta": f(er["contable"]["neta"]),
                "cajaEntro": f(er["financiera"]["ventas"]),
                "cajaSalio": f(er["financiera"]["costoVentas"] + er["financiera"]["gastosOperativos"] + er["financiera"]["impuestos"]),
            },
            # Financiero
            "ingresosAtribuibles": f(ingresos_atrib),
            "costoProduccion": f(costo_prod),
            "utilidadBruta": f(utilidad_bruta),
            "margenBruto": margen(utilidad_bruta, ingresos_atrib),
            "utilidadOperativa": f(utilidad_oper),
            "margenOperativo": margen(utilidad_oper, ingresos_atrib),
            "cobrado": f(cobrado),
            "utilidadNeta": f(er["contable"]["neta"]),
            "margenNeto": margen(er["contable"]["neta"], er["contable"]["ventas"]),
            "flujoCaja": f(er["financiera"]["neta"]),
            # Operativo
            "eficiencia": eficiencia,
            "desviacion": _r(reales - estandar) if reales or estandar else None,
            "retrabajo": _pct(horas_retrabajo, horas_reales_total),
            "cumplimiento": _pct(a_tiempo, n_term),
            "capacidadUtilizada": capacidad,
            # Estratégico
            "costoMoVestido": f(costo_mo / n_term) if n_term and costo_mo else None,
            "utilidadPorVestido": f(utilidad_bruta / n_term) if n_term else None,
            "utilidadPorHora": f(utilidad_bruta / horas_reales_total) if horas_reales_total else None,
            "rendimientoPlanilla": _r(_div(ingresos_atrib, costo_mo), 2),
            "costoOcioso": f(costo_mo * (1 - Decimal(str(capacidad)) / 100)) if capacidad is not None and costo_mo and capacidad <= 100 else None,
            "_terminados": term,
        }


def _limpio(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


class DashboardView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        ini, fin, meses, hoy = _periodo(request)
        calc = Calculo()
        periodo = calc.indicadores(ini, fin)

        # Periodo anterior del mismo largo, para comparar.
        ini_prev = ini
        for _ in range(meses):
            ini_prev = mes_anterior(ini_prev)
        anterior = calc.indicadores(ini_prev, ini)

        mensual = []
        for m, s in _rango_meses(ini, fin):
            x = _limpio(calc.indicadores(m, s))
            x.update({"month": m.strftime("%Y-%m"), "label": etiqueta_mes(m)})
            mensual.append(x)

        # Productividad por vestido terminado.
        horas_ses = defaultdict(lambda: CERO)
        retra_ses = defaultdict(lambda: CERO)
        ids = [v.id for v, _, _ in periodo["_terminados"]]
        for s in SesionVestido.objects.filter(vestido_id__in=ids).select_related("paso").prefetch_related("pausas"):
            horas_ses[s.vestido_id] += s.horas_efectivas
            if s.paso_id and s.paso.es_retrabajo:
                retra_ses[s.vestido_id] += s.horas_efectivas
        std = dict(
            PasoVestido.objects.filter(vestido_id__in=ids, tipo_tiempo=PlantillaOperacion.TipoTiempo.TRABAJO, es_retrabajo=False)
            .values("vestido").annotate(h=Sum("horas_estimadas")).values_list("vestido", "h")
        )
        c = periodo["c"]
        costo_hora_mo = _div(Decimal(str(c["costoManoObra"])), Decimal(str(c["horasPagadas"] or 0)))
        vestidos = []
        for v, termino, ok in sorted(periodo["_terminados"], key=lambda x: x[1], reverse=True):
            real = horas_ses[v.id]
            est = std.get(v.id) or CERO
            vestidos.append({
                "code": v.codigo, "contract": v.contrato.numero,
                "client": v.contrato.cliente.nombre if v.contrato.cliente_id else "",
                "model": v.tipo_vestido.nombre if v.tipo_vestido_id else "",
                "finished": termino, "onTime": ok,
                "price": f(v.precio + v.precio_otros),
                "standard": _r(est), "real": _r(real) if real else None,
                "efficiency": _pct(est, real) if real else None,
                "deviation": _r(real - est) if real else None,
                "rework": _r(retra_ses[v.id]),
                "laborCost": f(real * costo_hora_mo) if real and costo_hora_mo else None,
            })

        return Response({
            "from": ini, "to": fin - timedelta(days=1), "months": meses,
            "updatedAt": timezone.now(),
            "period": _limpio(periodo),
            "previous": _limpio(anterior),
            "monthly": mensual,
            "dresses": vestidos[:100],
        })


class CapacidadDashboardView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        hoy = timezone.localdate()
        lunes = hoy - timedelta(days=hoy.weekday())
        desde = lunes - timedelta(weeks=4)
        cap = CapacidadTaller(desde, dias=7 * 13)
        etiquetas = dict(Trabajadora.Area.choices)
        semanas = []
        for i in range(12):
            a = desde + timedelta(weeks=i)
            b = a + timedelta(days=6)
            res = cap.resumen_por_area(a, b)
            disp = sum((x["capacidad"] for x in res.values()), CERO)
            asig = sum((x["comprometidas"] for x in res.values()), CERO)
            semanas.append({
                "week": a, "label": f"{a:%d/%m}", "current": a == lunes, "past": b < hoy,
                "available": _r(disp), "assigned": _r(asig), "free": _r(max(CERO, disp - asig)),
                "used": _pct(asig, disp),
            })
        # Por área en las próximas 4 semanas.
        res = cap.resumen_por_area(lunes, lunes + timedelta(days=27))
        areas = [
            {"area": k, "name": etiquetas.get(k, k), "available": _r(v["capacidad"]), "assigned": _r(v["comprometidas"]),
             "used": _pct(v["comprometidas"], v["capacidad"]), "people": len(v["trabajadoras"])}
            for k, v in res.items() if v["capacidad"] > 0 or v["comprometidas"] > 0
        ]
        areas.sort(key=lambda x: -(x["used"] or 0))
        return Response({"weeks": semanas, "areas": areas})


class FinanzasDashboardView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        ini, fin, meses, hoy = _periodo(request)
        pagado = {
            r["contrato_id"]: r["t"]
            for r in Pago.objects.filter(confirmado=True).values("contrato_id").annotate(t=Sum("importe"))
        }
        atrasados, por_vencer = [], []
        saldo_total = CERO
        for c in Contrato.objects.exclude(estado="CANCELADO").select_related("cliente"):
            saldo = c.precio_total - pagado.get(c.id, CERO)
            if saldo <= 0:
                continue
            saldo_total += saldo
            dias = (hoy - c.fecha_entrega).days
            fila = {
                "contract": c.numero, "contractId": c.id,
                "client": c.cliente.nombre if c.cliente_id else "",
                "phone": c.cliente.telefono if c.cliente_id else "",
                "due": c.fecha_entrega, "total": f(c.precio_total), "paid": f(pagado.get(c.id, CERO)),
                "balance": f(saldo), "days": dias, "status": c.get_estado_display(),
            }
            if dias > 0:
                atrasados.append(fila)
            elif dias >= -7:
                por_vencer.append(fila)
        atrasados.sort(key=lambda x: -x["days"])
        por_vencer.sort(key=lambda x: x["days"], reverse=True)

        serie = []
        for m, s in _rango_meses(ini, fin):
            cob = ingresos(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            ven = (
                Contrato.objects.filter(fecha_firma__gte=m, fecha_firma__lt=s).exclude(estado="CANCELADO")
                .aggregate(t=Sum("precio_total"))["t"] or CERO
            )
            pag = Gasto.objects.filter(fecha__gte=m, fecha__lt=s, estado=Gasto.Estado.PAGADO).aggregate(t=Sum("importe"))["t"] or CERO
            serie.append({"label": etiqueta_mes(m), "collected": f(cob), "sold": f(ven), "paidOut": f(pag)})

        # Trazabilidad: últimos movimientos con quién los registró.
        def quien(u):
            return (u.get_full_name() or u.username) if u else "—"

        movs = []
        for p in Pago.objects.filter(confirmado=True).select_related("contrato__cliente", "registrado_por").order_by("-fecha", "-id")[:40]:
            movs.append({
                "date": p.fecha, "type": "Cobro", "amount": f(p.importe),
                "detail": f"{p.contrato.numero} · {p.contrato.cliente.nombre if p.contrato.cliente_id else ''} · {p.concepto}",
                "method": METODOS.get(p.metodo, p.metodo), "reference": p.referencia, "by": quien(p.registrado_por),
            })
        for g in Gasto.objects.select_related("categoria", "registrado_por").order_by("-fecha", "-id")[:40]:
            movs.append({
                "date": g.fecha, "type": "Gasto", "amount": f(-g.importe),
                "detail": f"{g.concepto} · {g.categoria.nombre}" + (" (por pagar)" if g.estado != Gasto.Estado.PAGADO else ""),
                "method": METODOS.get(g.metodo, g.metodo), "reference": g.comprobante, "by": quien(g.registrado_por),
            })
        movs.sort(key=lambda x: x["date"], reverse=True)

        cobrado_periodo = sum((Decimal(str(x["collected"])) for x in serie), CERO)
        vendido_periodo = sum((Decimal(str(x["sold"])) for x in serie), CERO)
        # Cobranza: de lo vendido en el periodo (100 %), cuánto ya se cobró.
        cobrado_de_vendido = (
            Pago.objects.filter(confirmado=True, contrato__fecha_firma__gte=ini, contrato__fecha_firma__lt=fin)
            .exclude(contrato__estado="CANCELADO").aggregate(t=Sum("importe"))["t"] or CERO
        )
        return Response({
            "summary": {
                "collected": f(cobrado_periodo), "sold": f(vendido_periodo),
                "collectionRate": min(100.0, _pct(cobrado_de_vendido, vendido_periodo)) if vendido_periodo else None,
                "collectedOfSold": f(cobrado_de_vendido),
                "balance": f(saldo_total),
                "overdue": f(sum((Decimal(str(x["balance"])) for x in atrasados), CERO)),
                "overdueCount": len(atrasados),
                "dueSoon": f(sum((Decimal(str(x["balance"])) for x in por_vencer), CERO)),
            },
            "overdue": atrasados[:50],
            "dueSoon": por_vencer[:30],
            "monthly": serie,
            "movements": movs[:60],
        })


# ------------------------------------------------------------------
# Reporte Excel
# ------------------------------------------------------------------

FILAS_REPORTE = [
    ("Nivel financiero — ¿La empresa gana dinero?", None, None, None),
    ("Ingresos atribuibles", "ingresosAtribuibles", "S/", "Precio de los vestidos terminados"),
    ("Costos de producción", "costoProduccion", "S/", "Mano de obra + materiales"),
    ("Utilidad bruta", "utilidadBruta", "S/", "Ingresos atribuibles − costos de producción"),
    ("Margen bruto", "margenBruto", "%", "Utilidad bruta / ingresos atribuibles × 100"),
    ("Utilidad operativa", "utilidadOperativa", "S/", "Utilidad bruta − gastos fijos − otros gastos"),
    ("Cobrado", "cobrado", "S/", "Pagos recibidos"),
    ("Utilidad neta (contable)", "utilidadNeta", "S/", "Utilidad operativa − impuestos (estado de resultados)"),
    ("Margen neto", "margenNeto", "%", "Utilidad neta / ingresos por ventas × 100"),
    ("Flujo neto de caja", "flujoCaja", "S/", "Lo que entró a caja − lo que salió de caja"),
    ("Nivel operativo — ¿El taller produce eficientemente?", None, None, None),
    ("Eficiencia de mano de obra", "eficiencia", "%", "Horas estándar / horas reales × 100"),
    ("Desviación de horas", "desviacion", "h", "Horas reales − horas estándar"),
    ("Índice de retrabajo", "retrabajo", "%", "Horas de retrabajo / horas reales × 100"),
    ("Cumplimiento de entregas", "cumplimiento", "%", "Entregados a tiempo / entregados × 100"),
    ("Capacidad utilizada", "capacidadUtilizada", "%", "Horas asignadas / horas disponibles × 100"),
    ("Nivel estratégico — ¿Los recursos generan rentabilidad?", None, None, None),
    ("Costo de mano de obra por vestido", "costoMoVestido", "S/", "Costo total de mano de obra / vestidos terminados"),
    ("Utilidad bruta por vestido", "utilidadPorVestido", "S/", "Utilidad bruta / vestidos terminados"),
    ("Utilidad bruta por hora trabajada", "utilidadPorHora", "S/", "Utilidad bruta / horas reales"),
    ("Rendimiento de la planilla", "rendimientoPlanilla", "x", "Ingresos atribuibles / costo de mano de obra"),
    ("Costo de horas no usadas", "costoOcioso", "S/", "Costo de mano de obra × (100 % − capacidad utilizada)"),
]


class ReporteView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        ini, fin, meses, hoy = _periodo(request)
        calc = Calculo()
        cols = [(etiqueta_mes(m), _limpio(calc.indicadores(m, s))) for m, s in _rango_meses(ini, fin)]
        total = _limpio(calc.indicadores(ini, fin))

        wb = Workbook()
        ws = wb.active
        ws.title = "Comparación mensual"
        oscuro = PatternFill("solid", fgColor="4A3428")
        dorado = PatternFill("solid", fgColor="F4EDE3")
        ws["A1"] = "FIANCÉE · Reporte gerencial"
        ws["A1"].font = Font(size=16, bold=True, color="4A3428")
        ws["A2"] = f"Del {ini:%d/%m/%Y} al {(fin - timedelta(days=1)):%d/%m/%Y} · generado el {timezone.localtime():%d/%m/%Y %H:%M}"
        enc = ["Indicador", "Fórmula"] + [c[0] for c in cols] + ["Periodo", "Variación último mes"]
        for i, t in enumerate(enc, start=1):
            c = ws.cell(row=4, column=i, value=t)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = oscuro
        fila = 5
        for nombre, clave, unidad, formula in FILAS_REPORTE:
            if clave is None:
                c = ws.cell(row=fila, column=1, value=nombre)
                c.font = Font(bold=True, color="4A3428")
                for i in range(1, len(enc) + 1):
                    ws.cell(row=fila, column=i).fill = dorado
                fila += 1
                continue
            ws.cell(row=fila, column=1, value=f"{nombre} ({unidad})")
            ws.cell(row=fila, column=2, value=formula).font = Font(italic=True, color="76604F")
            valores = [c[1].get(clave) for c in cols]
            for i, v in enumerate(valores + [total.get(clave)], start=3):
                cell = ws.cell(row=fila, column=i, value=v)
                cell.number_format = '#,##0.00' if unidad == "S/" else '0.0'
            if len(valores) >= 2 and valores[-1] is not None and valores[-2] not in (None, 0):
                var = (valores[-1] - valores[-2]) / abs(valores[-2])
                c = ws.cell(row=fila, column=len(enc), value=var)
                c.number_format = '+0.0%;-0.0%'
            fila += 1
        ws.column_dimensions["A"].width = 38
        ws.column_dimensions["B"].width = 46
        for i in range(3, len(enc) + 1):
            ws.column_dimensions[get_column_letter(i)].width = 14
        ws.freeze_panes = "C5"

        # Hoja de cuentas por cobrar.
        resp = FinanzasDashboardView().get(request).data
        ws2 = wb.create_sheet("Pagos atrasados")
        cab = ["Contrato", "Clienta", "Teléfono", "Recojo", "Días de atraso", "Total", "Pagado", "Saldo"]
        for i, t in enumerate(cab, start=1):
            c = ws2.cell(row=1, column=i, value=t)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = oscuro
        for r, x in enumerate(resp["overdue"], start=2):
            for i, v in enumerate([x["contract"], x["client"], x["phone"], x["due"], x["days"], x["total"], x["paid"], x["balance"]], start=1):
                ws2.cell(row=r, column=i, value=v)
        for i, w in enumerate([16, 28, 14, 12, 14, 12, 12, 12], start=1):
            ws2.column_dimensions[get_column_letter(i)].width = w

        ws3 = wb.create_sheet("Movimientos")
        cab = ["Fecha", "Tipo", "Detalle", "Método", "Referencia", "Monto", "Registrado por"]
        for i, t in enumerate(cab, start=1):
            c = ws3.cell(row=1, column=i, value=t)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = oscuro
        for r, x in enumerate(resp["movements"], start=2):
            for i, v in enumerate([x["date"], x["type"], x["detail"], x["method"], x["reference"], x["amount"], x["by"]], start=1):
                ws3.cell(row=r, column=i, value=v).alignment = Alignment(vertical="top")
        for i, w in enumerate([12, 10, 50, 14, 16, 12, 20], start=1):
            ws3.column_dimensions[get_column_letter(i)].width = w

        out = BytesIO()
        wb.save(out)
        r = HttpResponse(out.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        r["Content-Disposition"] = f'attachment; filename="reporte_gerencial_{hoy:%Y%m%d}.xlsx"'
        r["Access-Control-Expose-Headers"] = "Content-Disposition"
        return r
