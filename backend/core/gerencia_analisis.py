"""
Análisis para gerencia (todo expresado en % sobre 100 cuando se puede).

GET /api/core/gerencia/indicadores/rentabilidad/?meses=6
    ¿El taller es rentable? Ingresos contra TODOS los costos del mes:
      - Sueldos del personal (sueldo mensual de cada trabajadora).
      - Gastos fijos (alquiler, luz, internet…: Configuración → gastos fijos).
      - Gastos variables (telas, pedrería, movilidad…: Finanzas → gastos).
    Se cuentan en el mes al que corresponden, estén pagados o no.

GET /api/core/gerencia/indicadores/personal/?meses=6
    ¿En qué se va el tiempo que se paga y cuánto se demora cada una?
"""

import unicodedata
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.comercial_views import etiqueta_mes, mes_anterior, mes_siguiente
from core.gerencia_views import CERO, PermisoGerencia, f, gastos_pagados, ingresos
from core.models import (
    ConfiguracionNegocio,
    Contrato,
    CostoOperativo,
    DisponibilidadSemanal,
    Gasto,
    PasoVestido,
    PlantillaOperacion,
    RegistroAsistencia,
    SesionVestido,
    Trabajadora,
    VestidoContrato,
)

TALLERES = {"A": "Taller A", "C": "Taller C", "T": "Tienda"}


def _norm(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def es_planilla(nombre_categoria):
    """Planilla del TALLER (ya está en el sueldo de cada trabajadora).
    La planilla administrativa (comercial, gerencia) es gasto operativo."""
    n = _norm(nombre_categoria)
    return ("planilla" in n or "sueldo" in n or "remuneracion" in n) and "administr" not in n


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


def _meses(ini, fin):
    m = ini
    while m < fin:
        yield m, mes_siguiente(m)
        m = mes_siguiente(m)


def _r(x, n=1):
    return round(float(x), n)


def _pct(parte, total):
    return round(float(parte) / float(total) * 100, 1) if total else None


def margen(utilidad, ingresos):
    """
    Margen siempre entre −100 % y 100 %.
    Con ganancia: utilidad / ingresos × 100.
    Con pérdida: pérdida / costos × 100 (qué parte de los costos no se cubrió).
    """
    ingresos = Decimal(str(ingresos or 0))
    utilidad = Decimal(str(utilidad or 0))
    base = max(ingresos, ingresos - utilidad)
    return round(float(utilidad / base * 100), 1) if base else None


def fmt(v):
    return f"S/ {v:,.2f}"


def sueldo_en_mes(t, m, s):
    """Sueldo de una trabajadora en el mes [m, s). Si entró a mitad de mes, se prorratea."""
    if not t.sueldo_mensual:
        return CERO
    if t.fecha_ingreso and t.fecha_ingreso >= s:
        return CERO
    if t.fecha_ingreso and t.fecha_ingreso > m:
        dias_mes = (s - m).days
        return (t.sueldo_mensual * Decimal((s - t.fecha_ingreso).days) / Decimal(dias_mes)).quantize(Decimal("0.01"))
    return t.sueldo_mensual


def horas_programadas(trabajadora_ids, ini, fin):
    """Horas que se le pagan a cada una según su horario semanal (hasta hoy)."""
    horario = defaultdict(dict)
    for d in DisponibilidadSemanal.objects.filter(trabajadora_id__in=trabajadora_ids):
        horario[d.trabajadora_id][d.dia_semana] = d.horas_disponibles
    ingreso = dict(Trabajadora.objects.filter(pk__in=trabajadora_ids).values_list("id", "fecha_ingreso"))
    limite = min(fin, timezone.localdate() + timedelta(days=1))
    total = defaultdict(lambda: CERO)
    for tid in trabajadora_ids:
        dia = max(ini, ingreso.get(tid) or ini)
        while dia < limite:
            total[tid] += horario[tid].get(dia.weekday(), CERO)
            dia += timedelta(days=1)
    return total


class RentabilidadView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        ini, fin, meses, hoy = _periodo(request)
        cfg = ConfiguracionNegocio.obtener()
        objetivo = float(cfg.margen_objetivo or 0)

        personal = list(Trabajadora.objects.filter(activa=True))
        hay_sueldos = any(t.sueldo_mensual > 0 for t in personal)
        fijos = [c for c in CostoOperativo.objects.filter(activo=True).select_related("categoria")]
        # Si los sueldos están en cada trabajadora, la planilla registrada como gasto
        # es el pago de esos mismos sueldos: no se cuenta dos veces.
        if hay_sueldos:
            fijos = [c for c in fijos if not es_planilla(c.categoria.nombre)]

        # Un gasto suelto en la misma categoría que un gasto fijo (p. ej. "Alquiler
        # del local") es el pago de ese fijo: ya está contado en fijos.
        categorias_fijas = {c.categoria_id for c in fijos}

        def variables(m, s):
            qs = Gasto.objects.filter(fecha__gte=m, fecha__lt=s, costo_fijo__isnull=True).select_related("categoria")
            return [
                g for g in qs
                if not (hay_sueldos and es_planilla(g.categoria.nombre)) and g.categoria_id not in categorias_fijas
            ]

        serie = []
        detalle_sueldos = defaultdict(lambda: CERO)
        detalle_fijos = defaultdict(lambda: CERO)
        detalle_var = defaultdict(lambda: CERO)
        caja_acum = CERO
        for m, s in _meses(ini, fin):
            cobrado = ingresos(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            vendido = (
                Contrato.objects.filter(fecha_firma__gte=m, fecha_firma__lt=s).exclude(estado="CANCELADO")
                .aggregate(t=Sum("precio_total"))["t"] or CERO
            )
            contratos = Contrato.objects.filter(fecha_firma__gte=m, fecha_firma__lt=s).exclude(estado="CANCELADO").count()
            sue = CERO
            for t in personal:
                x = sueldo_en_mes(t, m, s)
                sue += x
                detalle_sueldos[t.nombre] += x
            fij = CERO
            for c in fijos:
                if c.aplica_en(m):
                    fij += c.monto_mensual()
                    detalle_fijos[c.nombre] += c.monto_mensual()
            var = CERO
            for g in variables(m, s):
                var += g.importe
                detalle_var[g.categoria.nombre] += g.importe
            costo = sue + fij + var
            salio = gastos_pagados(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            caja_acum += cobrado - salio
            serie.append({
                "month": m.strftime("%Y-%m"), "label": etiqueta_mes(m),
                "income": f(cobrado), "sold": f(vendido), "contracts": contratos,
                "salaries": f(sue), "fixed": f(fij), "variable": f(var), "cost": f(costo),
                "profit": f(cobrado - costo),
                "margin": margen(cobrado - costo, cobrado),
                "cashIn": f(cobrado), "cashOut": f(salio), "cashBalance": f(caja_acum),
            })

        T = lambda k: sum((Decimal(str(x[k])) for x in serie), CERO)
        ing, sue, fij, var = T("income"), T("salaries"), T("fixed"), T("variable")
        costo = sue + fij + var
        utilidad = ing - costo
        margen_t = margen(utilidad, ing)
        meses_con_dato = sum(1 for x in serie if x["income"] or x["cost"])
        meses_ganancia = sum(1 for x in serie if x["profit"] > 0)

        faltantes = []
        if not hay_sueldos:
            faltantes.append("el sueldo mensual de cada trabajadora (Personal → editar)")
        if not fijos:
            faltantes.append("los gastos fijos como alquiler, luz e internet (Configuración → Gastos fijos)")

        if not meses_con_dato:
            veredicto = ("SIN_DATOS", "Todavía no hay datos", "Registra cobros y gastos para saber si el taller es rentable.")
        elif utilidad < 0:
            veredicto = ("NO", "Hoy el taller no es rentable",
                         f"Los costos ({fmt(costo)}) superan lo que entró ({fmt(ing)}): se perdieron {fmt(-utilidad)}.")
        elif margen_t is not None and margen_t < objetivo:
            veredicto = ("JUSTO", "Es rentable, pero con poco margen",
                         f"Después de pagar sueldos, gastos fijos y variables quedaron {fmt(utilidad)}: "
                         f"el {margen_t} % de lo que entró. Tu objetivo es {round(objetivo)} %.")
        else:
            veredicto = ("SI", "Sí, el taller es rentable",
                         f"Después de pagar sueldos, gastos fijos y variables quedaron {fmt(utilidad)}: "
                         f"el {margen_t} % de lo que entró.")

        # ---- De cada 100 % de lo que entra ----
        # 100 % = lo que entró; si hubo pérdida, 100 % = lo que costó todo.
        base = max(ing, costo)
        reparto = []
        if base > 0:
            reparto = [
                {"key": "salaries", "name": "Sueldos del personal", "pct": _pct(sue, base), "total": f(sue)},
                {"key": "fixed", "name": "Gastos fijos", "pct": _pct(fij, base), "total": f(fij)},
                {"key": "variable", "name": "Gastos variables", "pct": _pct(var, base), "total": f(var)},
                {"key": "profit", "name": "Te queda (utilidad)" if utilidad >= 0 else "Pérdida",
                 "pct": _pct(utilidad, base), "total": f(utilidad)},
            ]

        # ---- Estructura de costos (100 % = todo lo que cuesta el taller) ----
        def lista(d, grupo):
            return [
                {"group": grupo, "name": k, "total": f(v), "pct": _pct(v, costo)}
                for k, v in sorted(d.items(), key=lambda x: -x[1]) if v > 0
            ]
        estructura = {
            "groups": [
                {"key": "salaries", "name": "Sueldos", "total": f(sue), "pct": _pct(sue, costo)},
                {"key": "fixed", "name": "Gastos fijos", "total": f(fij), "pct": _pct(fij, costo)},
                {"key": "variable", "name": "Gastos variables", "total": f(var), "pct": _pct(var, costo)},
            ],
            "items": lista(detalle_sueldos, "salaries") + lista(detalle_fijos, "fixed") + lista(detalle_var, "variable"),
        }

        # ---- Punto de equilibrio ----
        n = max(1, meses_con_dato or meses)
        fijos_mes = (sue + fij) / n  # lo que se paga sí o sí cada mes
        ratio_var = (var / ing) if ing else CERO  # de cada sol que entra, cuánto se va en variables
        equilibrio = fijos_mes / (1 - ratio_var) if ratio_var < 1 else None
        ingreso_prom = ing / n
        vestidos = list(
            VestidoContrato.objects.filter(contrato__fecha_firma__gte=ini, contrato__fecha_firma__lt=fin)
            .exclude(contrato__estado="CANCELADO").select_related("ruta", "tipo_vestido")
        )
        vendido_total = sum((v.precio + v.precio_otros for v in vestidos), CERO)
        precio_prom = vendido_total / len(vestidos) if vestidos else CERO

        # ---- Cuánto deja cada vestido (por modelo y por taller) ----
        con_ruta = [v for v in vestidos if v.ruta_id]
        reales = defaultdict(lambda: CERO)
        for ses in SesionVestido.objects.filter(vestido__in=con_ruta).prefetch_related("pausas"):
            reales[ses.vestido_id] += ses.horas_efectivas
        estimadas = dict(
            PasoVestido.objects.filter(vestido__in=con_ruta, tipo_tiempo=PlantillaOperacion.TipoTiempo.TRABAJO)
            .values("vestido").annotate(h=Sum("horas_estimadas")).values_list("vestido", "h")
        )

        def horas_de(v):
            return reales[v.id] if v.estado == "FINALIZADO" and reales[v.id] > 0 else (estimadas.get(v.id) or CERO)

        # Costo de una hora del taller: sueldos + fijos + variables / horas que se pagan.
        ids = [t.id for t in personal]
        horas_pagadas = sum(horas_programadas(ids, ini, fin).values(), CERO)
        costo_hora = (costo / horas_pagadas) if horas_pagadas and costo else None

        def agrupar(clave_fn):
            acc = {}
            for v in con_ruta:
                h = horas_de(v)
                d = acc.setdefault(clave_fn(v), {"n": 0, "ingreso": CERO, "horas": CERO})
                d["n"] += 1
                d["ingreso"] += v.precio + v.precio_otros
                d["horas"] += h
            filas = []
            for nombre, d in acc.items():
                costo_v = d["horas"] * costo_hora if costo_hora is not None else None
                gan = d["ingreso"] - costo_v if costo_v is not None else None
                filas.append({
                    "name": nombre, "count": d["n"],
                    "avgPrice": f(d["ingreso"] / d["n"]),
                    "avgHours": _r(d["horas"] / d["n"]),
                    "perHour": f(d["ingreso"] / d["horas"]) if d["horas"] else None,
                    "avgCost": f(costo_v / d["n"]) if costo_v is not None else None,
                    "avgProfit": f(gan / d["n"]) if gan is not None else None,
                    "margin": margen(gan, d["ingreso"]) if gan is not None else None,
                })
            filas.sort(key=lambda x: -(x["margin"] if x["margin"] is not None else -999))
            return filas

        return Response({
            "from": ini, "to": fin - timedelta(days=1), "months": meses,
            "verdict": {"code": veredicto[0], "title": veredicto[1], "text": veredicto[2]},
            "missing": faltantes,
            "totals": {
                "income": f(ing), "cost": f(costo), "salaries": f(sue), "fixed": f(fij), "variable": f(var),
                "profit": f(utilidad), "margin": margen_t, "targetMargin": objetivo,
                "monthsWithProfit": meses_ganancia, "monthsWithData": meses_con_dato,
                "sold": f(vendido_total), "contracts": sum(x["contracts"] for x in serie), "dresses": len(vestidos),
            },
            "per100": reparto,
            "structure": estructura,
            "breakEven": {
                "monthlyNeeded": f(equilibrio) if equilibrio is not None else None,
                "fixedMonthly": f(fijos_mes),
                "variablePct": _pct(ratio_var, 1),
                "avgIncome": f(ingreso_prom),
                "progress": _pct(ingreso_prom, equilibrio) if equilibrio else None,
                "avgDressPrice": f(precio_prom),
                "dressesNeeded": (int(-(-equilibrio // precio_prom)) if equilibrio and precio_prom > 0 else None),
                "dressesPerMonth": round(len(vestidos) / meses, 1),
            },
            "hourCost": {
                "value": f(costo_hora) if costo_hora is not None else None,
                "paidHours": _r(horas_pagadas, 0),
                # Horas de trabajo de los vestidos vendidos frente a las horas que se pagan.
                "dressHours": _r(sum((horas_de(v) for v in con_ruta), CERO), 0),
                "usedPct": min(100.0, _pct(sum((horas_de(v) for v in con_ruta), CERO), horas_pagadas) or 0) if horas_pagadas else None,
            },
            "coverage": _pct(ing, costo),
            "series": serie,
            "byModel": agrupar(lambda v: v.tipo_vestido.nombre if v.tipo_vestido_id else "Otro"),
            "byWorkshop": agrupar(lambda v: TALLERES.get(v.ruta.taller, v.ruta.taller)),
        })


class TiemposPersonalView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        ini, fin, meses, hoy = _periodo(request)

        sesiones = list(
            SesionVestido.objects.filter(jornada__fecha__gte=ini, jornada__fecha__lt=fin)
            .select_related("trabajadora", "paso", "jornada").prefetch_related("pausas")
        )
        asistencias = list(
            RegistroAsistencia.objects.filter(fecha__gte=ini, fecha__lt=fin, salida__isnull=False).select_related("trabajadora")
        )

        por_paso = defaultdict(lambda: defaultdict(lambda: CERO))
        horas_vest = defaultdict(lambda: CERO)
        mensual = defaultdict(lambda: defaultdict(lambda: CERO))
        nombres = {}
        for s in sesiones:
            h = s.horas_efectivas
            t = s.trabajadora
            nombres[t.id] = t.nombre
            horas_vest[t.id] += h
            mensual[s.jornada.fecha.strftime("%Y-%m")][t.nombre] += h
            if s.paso_id:
                por_paso[s.paso_id][t.id] += h

        horas_taller = defaultdict(lambda: CERO)
        dias = defaultdict(set)
        extra = defaultdict(lambda: CERO)
        for a in asistencias:
            nombres.setdefault(a.trabajadora_id, a.trabajadora.nombre)
            horas_taller[a.trabajadora_id] += a.horas_trabajadas or CERO
            extra[a.trabajadora_id] += a.horas_extra or CERO
            dias[a.trabajadora_id].add(a.fecha)

        pasos = {
            p.id: p for p in PasoVestido.objects.filter(
                pk__in=por_paso.keys(), estado=PasoVestido.Estado.COMPLETADO,
                tipo_tiempo=PlantillaOperacion.TipoTiempo.TRABAJO,
            )
        }
        trab = defaultdict(lambda: {"pasos": 0, "est": CERO, "real": CERO})
        proc = defaultdict(lambda: defaultdict(lambda: {"n": 0, "est": CERO, "real": CERO}))
        for pid, quien in por_paso.items():
            p = pasos.get(pid)
            if p is None or p.horas_estimadas <= 0:
                continue
            total_real = sum(quien.values(), CERO)
            if total_real <= 0:
                continue
            nombre_proc = p.nombre.strip().capitalize()
            for tid, h in quien.items():
                est = p.horas_estimadas * (h / total_real)
                trab[tid]["pasos"] += 1
                trab[tid]["est"] += est
                trab[tid]["real"] += h
                d = proc[nombre_proc][tid]
                d["n"] += 1
                d["est"] += est
                d["real"] += h

        activas = {t.id: t for t in Trabajadora.objects.filter(activa=True)}
        ids = set(horas_vest) | set(horas_taller) | set(activas)
        fichas = {t.id: t for t in Trabajadora.objects.filter(pk__in=ids)}
        for tid, t in fichas.items():
            nombres.setdefault(tid, t.nombre)
        programadas = horas_programadas(list(ids), ini, fin)
        etiquetas_area = dict(Trabajadora.Area.choices)

        trabajadoras = []
        for tid in ids:
            t = fichas.get(tid)
            tr = trab.get(tid)
            pagadas = programadas.get(tid, CERO)
            ht, hv = horas_taller[tid], horas_vest[tid]
            if not (pagadas or ht or hv):
                continue
            # 100 % = horas pagadas según horario. Se reparte en:
            base = max(pagadas, ht)
            en_vestidos = min(hv, ht) if ht else hv
            en_taller_otro = max(CERO, ht - en_vestidos)
            no_vino = max(CERO, base - ht - (hv - en_vestidos))
            sueldo = sum((sueldo_en_mes(t, m, s) for m, s in _meses(ini, min(fin, mes_siguiente(hoy.replace(day=1))))), CERO) if t else CERO
            eficiencia = float(tr["est"] / tr["real"]) if tr and tr["real"] else None
            trabajadoras.append({
                "id": tid, "name": nombres[tid],
                "area": etiquetas_area.get(t.area, "") if t else "",
                "days": len(dias[tid]),
                "paidHours": _r(pagadas), "hoursInWorkshop": _r(ht), "hoursInDresses": _r(hv), "overtime": _r(extra[tid]),
                "split": {
                    "dresses": _pct(en_vestidos, base), "otherInWorkshop": _pct(en_taller_otro, base),
                    "absent": _pct(no_vino, base),
                },
                "productive": _pct(hv, base),
                "salary": f(sueldo),
                "costPerProductiveHour": f(sueldo / hv) if sueldo and hv else None,
                "stepsDone": tr["pasos"] if tr else 0,
                "estimated": _r(tr["est"]) if tr else 0,
                "real": _r(tr["real"]) if tr else 0,
                # 100 % = hace el trabajo en las horas del catálogo; 120 % = rinde 20 % más.
                "efficiency": round(eficiencia * 100, 1) if eficiencia is not None else None,
            })
        trabajadoras.sort(key=lambda x: -x["hoursInDresses"])

        procesos = []
        for nombre_proc, por_t in proc.items():
            filas = [{
                "name": nombres[tid], "count": d["n"],
                "avgReal": _r(d["real"] / d["n"], 2), "avgEstimated": _r(d["est"] / d["n"], 2),
                "efficiency": round(float(d["est"] / d["real"]) * 100, 1) if d["real"] else None,
            } for tid, d in por_t.items()]
            filas.sort(key=lambda x: x["avgReal"])
            total_n = sum(x["count"] for x in filas)
            procesos.append({
                "name": nombre_proc, "count": total_n,
                "estimated": _r(sum((d["est"] for d in por_t.values()), CERO) / total_n, 2) if total_n else 0,
                "workers": filas,
            })
        procesos.sort(key=lambda x: -x["count"])

        top = [x["name"] for x in trabajadoras if x["hoursInDresses"] > 0][:6]
        serie = []
        for m, s in _meses(ini, fin):
            clave = m.strftime("%Y-%m")
            fila = {"month": clave, "label": etiqueta_mes(m)}
            otros = CERO
            for nombre, h in mensual[clave].items():
                if nombre in top:
                    fila[nombre] = _r(h)
                else:
                    otros += h
            if otros:
                fila["Otras"] = _r(otros)
            serie.append(fila)

        tot_pag = sum((Decimal(str(x["paidHours"])) for x in trabajadoras), CERO)
        tot_taller = sum((Decimal(str(x["hoursInWorkshop"])) for x in trabajadoras), CERO)
        tot_vest = sum((Decimal(str(x["hoursInDresses"])) for x in trabajadoras), CERO)
        base = max(tot_pag, tot_taller)
        con_ef = [x for x in trabajadoras if x["efficiency"] is not None]
        tot_est = sum(x["estimated"] for x in con_ef)
        tot_real = sum(x["real"] for x in con_ef)
        sueldos = sum((Decimal(str(x["salary"])) for x in trabajadoras), CERO)
        return Response({
            "from": ini, "to": fin - timedelta(days=1), "months": meses,
            "summary": {
                "workers": len(trabajadoras),
                "paidHours": _r(tot_pag), "hoursInWorkshop": _r(tot_taller), "hoursInDresses": _r(tot_vest),
                "split": {
                    "dresses": _pct(min(tot_vest, tot_taller) if tot_taller else tot_vest, base),
                    "otherInWorkshop": _pct(max(CERO, tot_taller - tot_vest), base),
                    "absent": _pct(max(CERO, base - max(tot_taller, tot_vest)), base),
                },
                "stepsDone": sum(x["stepsDone"] for x in trabajadoras),
                "efficiency": round(tot_est / tot_real * 100, 1) if tot_real else None,
                "salaries": f(sueldos),
                "costPerProductiveHour": f(sueldos / tot_vest) if sueldos and tot_vest else None,
                "fastest": max(con_ef, key=lambda x: x["efficiency"])["name"] if len(con_ef) > 1 else None,
                "missingSalaries": not any(t.sueldo_mensual > 0 for t in activas.values()),
            },
            "workers": trabajadoras,
            "processes": procesos,
            "monthly": serie,
            "monthlyNames": top + (["Otras"] if any("Otras" in x for x in serie) else []),
        })
