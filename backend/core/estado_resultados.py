"""
Estado de resultados de FIANCÉE, en dos perspectivas:

  CONTABLE (devengado): lo que se vendió y lo que se gastó en el periodo,
  se haya cobrado/pagado o no.
  FINANCIERA (caja): lo que efectivamente entró y salió de caja.

  1. Ingresos por ventas
  2. Costo de ventas      (mano de obra directa + materiales + otros costos de producción)
  3. Utilidad bruta       = 1 − 2
  4. Gastos operativos    (alquiler, servicios, marketing, administración, otros)
  5. Utilidad operativa   = 3 − 4
  6. Impuestos            (contable: tasa × utilidad operativa; caja: impuestos pagados)
  7. Utilidad neta        = 5 − 6

GET /api/core/gerencia/estado-resultados/?meses=6
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
from core.gerencia_analisis import es_planilla, margen, sueldo_en_mes
from core.gerencia_views import CERO, PermisoGerencia, f, ingresos
from core.models import ConfiguracionNegocio, Contrato, CostoOperativo, Gasto, Trabajadora

PALABRAS_PRODUCCION = ("tela", "encaje", "pedrer", "avio", "material", "insumo", "lavander", "hilo", "bordad", "confecc", "tinte")
PALABRAS_IMPUESTO = ("impuesto", "sunat", "tribut", "renta")


def _norm(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def es_produccion(nombre):
    n = _norm(nombre)
    return any(p in n for p in PALABRAS_PRODUCCION)


def es_impuesto(nombre):
    n = _norm(nombre)
    return any(p in n for p in PALABRAS_IMPUESTO)


def _pct(a, b):
    return round(float(a) / float(b) * 100, 1) if b else None


def _meses(ini, fin):
    m = ini
    while m < fin:
        yield m, mes_siguiente(m)
        m = mes_siguiente(m)


def estado(ini, fin, tasa=None):
    """Calcula el estado de resultados del rango [ini, fin) en las dos perspectivas."""
    if tasa is None:
        tasa = ConfiguracionNegocio.obtener().tasa_impuesto
    personal = list(Trabajadora.objects.filter(activa=True))
    hay_sueldos = any(t.sueldo_mensual > 0 for t in personal)
    fijos = [c for c in CostoOperativo.objects.filter(activo=True).select_related("categoria")]
    if hay_sueldos:
        fijos = [c for c in fijos if not es_planilla(c.categoria.nombre)]
    cat_fijas = {c.categoria_id for c in fijos}

    # ── CONTABLE ──────────────────────────────────────────────
    ventas = (
        Contrato.objects.filter(fecha_firma__gte=ini, fecha_firma__lt=fin).exclude(estado="CANCELADO")
        .aggregate(t=Sum("precio_total"))["t"] or CERO
    )
    n_contratos = Contrato.objects.filter(fecha_firma__gte=ini, fecha_firma__lt=fin).exclude(estado="CANCELADO").count()

    mano_obra = CERO
    for m, s in _meses(ini, fin):
        mano_obra += sum((sueldo_en_mes(t, m, s) for t in personal), CERO)

    materiales_c = defaultdict(lambda: CERO)   # costo de ventas
    operativos_c = defaultdict(lambda: CERO)   # gastos operativos
    impuestos_registrados = CERO
    for m, s in _meses(ini, fin):
        for c in fijos:
            if not c.aplica_en(m):
                continue
            nombre = c.categoria.nombre
            if es_impuesto(nombre):
                continue
            (materiales_c if es_produccion(nombre) else operativos_c)[nombre] += c.monto_mensual()

    gastos = list(Gasto.objects.filter(fecha__gte=ini, fecha__lt=fin).select_related("categoria"))
    for g in gastos:
        nombre = g.categoria.nombre
        if g.costo_fijo_id or g.categoria_id in cat_fijas:
            continue  # ya está en el gasto fijo devengado
        if hay_sueldos and es_planilla(nombre):
            continue  # ya está en la mano de obra directa
        if es_impuesto(nombre):
            impuestos_registrados += g.importe
            continue
        (materiales_c if es_produccion(nombre) else operativos_c)[nombre] += g.importe

    costo_ventas = mano_obra + sum(materiales_c.values(), CERO)
    bruta = ventas - costo_ventas
    gastos_oper = sum(operativos_c.values(), CERO)
    operativa = bruta - gastos_oper
    impuesto = (operativa * tasa / 100).quantize(Decimal("0.01")) if operativa > 0 else CERO
    neta = operativa - impuesto

    # ── FINANCIERA (caja) ─────────────────────────────────────
    cobrado = ingresos(ini, fin).aggregate(t=Sum("importe"))["t"] or CERO
    pagados = [g for g in gastos if g.estado == Gasto.Estado.PAGADO]
    planilla_pagada = sum((g.importe for g in pagados if es_planilla(g.categoria.nombre)), CERO)
    # Si la planilla del taller no se registra como gasto, se asume que los sueldos se pagan cada mes.
    mano_obra_caja = planilla_pagada if planilla_pagada > 0 else mano_obra
    sueldos_supuestos = planilla_pagada == 0 and mano_obra > 0
    materiales_f = defaultdict(lambda: CERO)
    operativos_f = defaultdict(lambda: CERO)
    impuestos_pagados = CERO
    for g in pagados:
        nombre = g.categoria.nombre
        if es_planilla(nombre):
            continue
        if es_impuesto(nombre):
            impuestos_pagados += g.importe
            continue
        (materiales_f if es_produccion(nombre) else operativos_f)[nombre] += g.importe
    costo_caja = mano_obra_caja + sum(materiales_f.values(), CERO)
    bruta_caja = cobrado - costo_caja
    oper_caja = sum(operativos_f.values(), CERO)
    operativa_caja = bruta_caja - oper_caja
    neta_caja = operativa_caja - impuestos_pagados

    def detalle(d):
        return {k: v for k, v in d.items() if v}

    return {
        "contable": {
            "ventas": ventas, "manoObra": mano_obra, "materiales": detalle(materiales_c), "costoVentas": costo_ventas,
            "bruta": bruta, "operativos": detalle(operativos_c), "gastosOperativos": gastos_oper,
            "operativa": operativa, "impuestos": impuesto, "neta": neta,
            "impuestosRegistrados": impuestos_registrados, "contratos": n_contratos,
        },
        "financiera": {
            "ventas": cobrado, "manoObra": mano_obra_caja, "materiales": detalle(materiales_f), "costoVentas": costo_caja,
            "bruta": bruta_caja, "operativos": detalle(operativos_f), "gastosOperativos": oper_caja,
            "operativa": operativa_caja, "impuestos": impuestos_pagados, "neta": neta_caja,
            "sueldosSupuestos": sueldos_supuestos,
        },
        "tasa": tasa,
    }


def _lineas(e):
    """Arma las filas del estado de resultados con las dos columnas."""
    c, k = e["contable"], e["financiera"]
    base_c = max(c["ventas"], c["ventas"] - c["neta"])
    base_k = max(k["ventas"], k["ventas"] - k["neta"])
    filas = []

    def fila(key, label, a, b, tipo="item", formula=""):
        filas.append({
            "key": key, "label": label, "type": tipo, "formula": formula,
            "accounting": f(a), "cash": f(b),
            # 100 % = lo que entró; si hubo pérdida, 100 % = todo lo que costó.
            "accountingPct": _pct(a, base_c), "cashPct": _pct(b, base_k),
        })

    fila("ventas", "1. Ingresos por ventas", c["ventas"], k["ventas"], "total",
         "Contable: valor de los contratos y servicios vendidos. Caja: pagos cobrados.")
    fila("manoObra", "Mano de obra directa", c["manoObra"], k["manoObra"], "item",
         "Sueldos del personal del taller (Personal → sueldo mensual).")
    for nombre in sorted(set(c["materiales"]) | set(k["materiales"])):
        fila(f"mat:{nombre}", nombre, c["materiales"].get(nombre, CERO), k["materiales"].get(nombre, CERO), "item")
    fila("costoVentas", "2. Costo de ventas", c["costoVentas"], k["costoVentas"], "total",
         "Mano de obra directa + materiales + otros costos de producción.")
    fila("bruta", "3. Utilidad bruta", c["bruta"], k["bruta"], "result", "Ingresos por ventas − costo de ventas")
    for nombre in sorted(set(c["operativos"]) | set(k["operativos"]), key=lambda n: -(c["operativos"].get(n, CERO))):
        fila(f"op:{nombre}", nombre, c["operativos"].get(nombre, CERO), k["operativos"].get(nombre, CERO), "item")
    fila("gastosOperativos", "4. Gastos operativos", c["gastosOperativos"], k["gastosOperativos"], "total",
         "Alquiler, servicios, marketing, administración y otros gastos para operar.")
    fila("operativa", "5. Utilidad operativa", c["operativa"], k["operativa"], "result", "Utilidad bruta − gastos operativos")
    fila("impuestos", "6. Impuestos", c["impuestos"], k["impuestos"], "total",
         f"Contable: {e['tasa']} % de la utilidad operativa (si hay utilidad). Caja: impuestos pagados registrados en gastos.")
    fila("neta", "7. Utilidad neta", c["neta"], k["neta"], "final", "Utilidad operativa − impuestos")
    return filas


class EstadoResultadosView(APIView):
    permission_classes = [PermisoGerencia]

    def get(self, request):
        try:
            meses = max(1, min(12, int(request.query_params.get("meses", 6))))
        except ValueError:
            meses = 6
        hoy = timezone.localdate()
        ini = hoy.replace(day=1)
        fin = mes_siguiente(ini)
        for _ in range(meses - 1):
            ini = mes_anterior(ini)
        tasa = ConfiguracionNegocio.obtener().tasa_impuesto
        e = estado(ini, fin, tasa)

        serie = []
        for m, s in _meses(ini, fin):
            x = estado(m, s, tasa)
            serie.append({
                "label": etiqueta_mes(m),
                "sales": f(x["contable"]["ventas"]), "cashIn": f(x["financiera"]["ventas"]),
                "gross": f(x["contable"]["bruta"]), "operating": f(x["contable"]["operativa"]),
                "net": f(x["contable"]["neta"]), "cashNet": f(x["financiera"]["neta"]),
            })

        c, k = e["contable"], e["financiera"]
        return Response({
            "from": ini, "to": fin - timedelta(days=1), "months": meses,
            "taxRate": f(tasa),
            "lines": _lineas(e),
            "summary": {
                "net": f(c["neta"]), "netMargin": margen(c["neta"], c["ventas"]),
                "cashNet": f(k["neta"]), "cashMargin": margen(k["neta"], k["ventas"]),
                "grossMargin": margen(c["bruta"], c["ventas"]), "operatingMargin": margen(c["operativa"], c["ventas"]),
                "lossBase": c["neta"] < 0, "cashLossBase": k["neta"] < 0,
                "difference": f(c["neta"] - k["neta"]),
                "contracts": c["contratos"],
            },
            "notes": {
                "assumedSalaries": k["sueldosSupuestos"],
                "taxesRecorded": f(c["impuestosRegistrados"]),
            },
            "monthly": serie,
        })
