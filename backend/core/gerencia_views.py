"""
Gerencia: finanzas (ingresos + gastos + meta), horas del personal e indicadores.

/api/core/gerencia/finanzas/?mes=AAAA-MM          resumen del mes
/api/core/gerencia/gastos/                       GET (?mes, estado, categoria, q) · POST
/api/core/gerencia/gastos/<id>/                  PATCH · DELETE
/api/core/gerencia/fijos/                        GET · POST
/api/core/gerencia/fijos/<id>/                   PATCH · DELETE
/api/core/gerencia/fijos/<id>/pagar/             POST {mes, fecha?, importe?, metodo?, comprobante?}
/api/core/gerencia/categorias/                   GET · POST
/api/core/gerencia/categorias/<id>/              PATCH
/api/core/gerencia/configuracion/                GET · PATCH
/api/core/gerencia/metas/                        POST {mes, meta|null, nota?}
/api/core/gerencia/horas/?desde&hasta            horas del personal
/api/core/gerencia/indicadores/?meses=6          indicadores del negocio
"""

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError
from django.db.models import Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.comercial_views import (
    ACTIVOS,
    etiqueta_mes,
    inicio_mes,
    mes_anterior,
    mes_siguiente,
    saldos_activos,
    vendido,
)
from core.models import (
    CategoriaFinanciera,
    ConfiguracionNegocio,
    Contrato,
    CostoOperativo,
    Gasto,
    MetaMensual,
    Pago,
    PasoVestido,
    RegistroAsistencia,
    SesionVestido,
    SimulacionContrato,
    Trabajadora,
    VestidoContrato,
)
from core.services.jornada import cerrar_jornadas_vencidas

CERO = Decimal("0")
METODOS = dict(Pago.Metodo.choices)
FRECUENCIAS = dict(CostoOperativo.Frecuencia.choices)


class PermisoGerencia(IsAuthenticated):
    message = "Solo gerencia puede ver esta información."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        u = request.user
        return u.is_superuser or getattr(u, "rol", None) == "gerencia" or u.groups.filter(name="Gerencia").exists()


def f(v):
    return round(float(v or 0), 2)


def leer_mes(texto, por_defecto=None):
    try:
        anio, numero = (int(x) for x in (texto or "").split("-")[:2])
        return date(anio, numero, 1)
    except (TypeError, ValueError):
        return por_defecto or inicio_mes(timezone.localdate())


def decimal(valor, campo, minimo=CERO, obligatorio=True):
    if valor in (None, ""):
        if obligatorio:
            raise ValueError(f"Indica {campo}.")
        return None
    try:
        d = Decimal(str(valor)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{campo.capitalize()} no es un número válido.")
    if d < minimo:
        raise ValueError(f"{campo.capitalize()} no puede ser menor que {minimo}.")
    return d


def error(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": msg}, status=code)


def nombre_usuario(u):
    return (u.get_full_name() or u.username) if u else ""


# ============================================================
# SERIALIZACIÓN
# ============================================================

def ser_categoria(c):
    return {"id": c.id, "name": c.nombre, "type": c.tipo, "active": c.activa}


def ser_gasto(g, hoy=None):
    hoy = hoy or timezone.localdate()
    vence = g.vence or g.fecha
    return {
        "id": g.id,
        "date": g.fecha,
        "concept": g.concepto,
        "categoryId": g.categoria_id,
        "category": g.categoria.nombre,
        "amount": f(g.importe),
        "method": g.metodo,
        "methodLabel": METODOS.get(g.metodo, g.metodo),
        "supplier": g.proveedor,
        "receipt": g.comprobante,
        "status": g.estado,
        "due": g.vence,
        "overdue": g.estado == Gasto.Estado.PENDIENTE and vence < hoy,
        "fixedId": g.costo_fijo_id,
        "fixedMonth": g.mes_fijo,
        "notes": g.observaciones,
        "by": nombre_usuario(g.registrado_por),
    }


def vence_fijo(fijo, mes):
    if not fijo.dia_pago:
        return None
    fin = mes_siguiente(mes) - timedelta(days=1)
    return mes.replace(day=min(fijo.dia_pago, fin.day))


def ser_fijo(c, mes=None, pagos=None):
    data = {
        "id": c.id,
        "name": c.nombre,
        "categoryId": c.categoria_id,
        "category": c.categoria.nombre,
        "amount": f(c.importe),
        "monthly": f(c.monto_mensual()),
        "frequency": c.frecuencia,
        "frequencyLabel": FRECUENCIAS.get(c.frecuencia, c.frecuencia),
        "from": c.fecha_inicio,
        "to": c.fecha_fin,
        "payDay": c.dia_pago,
        "active": c.activo,
        "notes": c.observaciones,
    }
    if mes is not None:
        pago = (pagos or {}).get(c.id)
        data["appliesThisMonth"] = c.aplica_en(mes)
        data["due"] = vence_fijo(c, mes)
        data["paid"] = bool(pago)
        data["paidExpenseId"] = pago.id if pago else None
        data["paidAmount"] = f(pago.importe) if pago else None
        data["paidDate"] = pago.fecha if pago else None
    return data


# ============================================================
# FINANZAS DEL MES
# ============================================================

def gastos_pagados(desde, hasta):
    return Gasto.objects.filter(estado=Gasto.Estado.PAGADO, fecha__gte=desde, fecha__lt=hasta)


def ingresos(desde, hasta):
    return Pago.objects.filter(confirmado=True, fecha__gte=desde, fecha__lt=hasta)


def fijos_pendientes(mes):
    """Gastos fijos que corresponden al mes y aún no se registran como pagados."""
    pagados = set(
        Gasto.objects.filter(mes_fijo=mes, costo_fijo__isnull=False).values_list("costo_fijo_id", flat=True)
    )
    return [
        c for c in CostoOperativo.objects.filter(activo=True).select_related("categoria")
        if c.aplica_en(mes) and c.id not in pagados
    ]


class FinanzasResumenView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_finanzas", tags=["gerencia"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        hoy = timezone.localdate()
        mes = leer_mes(request.query_params.get("mes"))
        sig = mes_siguiente(mes)
        ant = mes_anterior(mes)
        es_actual = mes == inicio_mes(hoy)
        config = ConfiguracionNegocio.obtener()

        pagos = list(ingresos(mes, sig))
        total_ingresos = sum((p.importe for p in pagos), CERO)
        gastos = list(gastos_pagados(mes, sig).select_related("categoria"))
        total_gastos = sum((g.importe for g in gastos), CERO)

        # Por pagar de este mes (gastos pendientes + fijos sin pagar).
        pendientes = list(
            Gasto.objects.filter(estado=Gasto.Estado.PENDIENTE)
            .filter(Q(vence__gte=mes, vence__lt=sig) | Q(vence__isnull=True, fecha__gte=mes, fecha__lt=sig) | Q(vence__lt=mes) | Q(vence__isnull=True, fecha__lt=mes))
            .select_related("categoria", "registrado_por")
        )
        fijos = fijos_pendientes(mes)
        por_pagar = []
        for g in pendientes:
            v = g.vence or g.fecha
            por_pagar.append({
                "kind": "gasto", "id": g.id, "concept": g.concepto, "category": g.categoria.nombre,
                "amount": f(g.importe), "due": v, "overdue": v < hoy, "thisMonth": mes <= v < sig,
            })
        for c in fijos:
            v = vence_fijo(c, mes)
            por_pagar.append({
                "kind": "fijo", "id": c.id, "concept": c.nombre, "category": c.categoria.nombre,
                "amount": f(c.monto_mensual()), "due": v, "overdue": bool(v and v < hoy), "thisMonth": True,
            })
        por_pagar.sort(key=lambda x: (x["due"] or sig, x["concept"]))
        pendiente_mes = sum((Decimal(str(x["amount"])) for x in por_pagar if x["thisMonth"]), CERO)
        pendiente_total = sum((Decimal(str(x["amount"])) for x in por_pagar), CERO)

        gastos_mes = total_gastos + pendiente_mes
        utilidad = total_ingresos - total_gastos
        utilidad_estimada = total_ingresos - gastos_mes
        margen = float(utilidad_estimada / total_ingresos) if total_ingresos else None

        meta, personalizada = config.meta_de(mes)
        dias_mes = (sig - mes).days
        dias_restantes = max(0, (sig - hoy).days) if es_actual else 0
        falta = max(CERO, meta - total_ingresos)

        # Lo que entraría: saldos de contratos con recojo este mes.
        saldos = saldos_activos()
        por_entrar = sum(
            (max(CERO, saldos.get(c.id, CERO)) for c in Contrato.objects.filter(
                estado__in=ACTIVOS, fecha_entrega__gte=max(mes, hoy) if es_actual else mes, fecha_entrega__lt=sig
            )),
            CERO,
        )

        por_categoria = {}
        for g in gastos:
            por_categoria[g.categoria.nombre] = por_categoria.get(g.categoria.nombre, CERO) + g.importe
        por_metodo = {}
        for p in pagos:
            por_metodo[p.metodo] = por_metodo.get(p.metodo, CERO) + p.importe

        dias = []
        d = mes
        while d < sig:
            dias.append({
                "date": d, "day": d.day,
                "income": f(sum((p.importe for p in pagos if p.fecha == d), CERO)),
                "expense": f(sum((g.importe for g in gastos if g.fecha == d), CERO)),
            })
            d += timedelta(days=1)

        historial = []
        m = mes
        for _ in range(12):
            s = mes_siguiente(m)
            i = ingresos(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            g = gastos_pagados(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            mt, _ = config.meta_de(m)
            historial.append({"month": m.strftime("%Y-%m"), "label": etiqueta_mes(m), "income": f(i), "expense": f(g), "profit": f(i - g), "goal": f(mt)})
            m = mes_anterior(m)
        historial.reverse()

        ing_ant = ingresos(ant, mes).aggregate(t=Sum("importe"))["t"] or CERO
        gas_ant = gastos_pagados(ant, mes).aggregate(t=Sum("importe"))["t"] or CERO
        n_vendidos, monto_vendido = vendido(mes, sig)
        fijos_mensual = sum((c.monto_mensual() for c in CostoOperativo.objects.filter(activo=True) if c.frecuencia != "UNICO"), CERO)

        return Response({
            "month": mes.strftime("%Y-%m"),
            "monthLabel": etiqueta_mes(mes, larga=True),
            "isCurrent": es_actual,
            "income": {
                "total": f(total_ingresos), "count": len(pagos), "prev": f(ing_ant),
                "byMethod": [{"code": k, "label": METODOS.get(k, k), "total": f(v)} for k, v in sorted(por_metodo.items(), key=lambda x: -x[1])],
                "sold": f(monto_vendido), "contractsSold": n_vendidos, "toCome": f(por_entrar),
                "toCollectAll": f(sum((s for s in saldos.values() if s > 0), CERO)),
            },
            "expense": {
                "paid": f(total_gastos), "count": len(gastos), "prev": f(gas_ant),
                "pendingMonth": f(pendiente_mes), "pendingAll": f(pendiente_total),
                "month": f(gastos_mes), "fixedMonthly": f(fijos_mensual),
                "byCategory": [{"name": k, "total": f(v)} for k, v in sorted(por_categoria.items(), key=lambda x: -x[1])],
                "toPay": por_pagar,
            },
            "result": {
                "profit": f(utilidad),
                "profitEstimated": f(utilidad_estimada),
                "margin": round(margen, 4) if margen is not None else None,
                "targetMargin": f(config.margen_objetivo),
                "breakEven": f(gastos_mes),
            },
            "goal": {
                "amount": f(meta), "custom": personalizada, "progress": round(float(total_ingresos / meta), 4) if meta else None,
                "missing": f(falta), "daysLeft": dias_restantes, "daysInMonth": dias_mes,
                "perDay": f(falta / dias_restantes) if dias_restantes and falta else 0,
            },
            "days": dias,
            "months": historial,
        })


# ============================================================
# GASTOS
# ============================================================

def leer_gasto(data, gasto=None):
    g = gasto or Gasto()
    if "concept" in data or gasto is None:
        concepto = (data.get("concept") or "").strip()
        if not concepto:
            raise ValueError("Escribe en qué se gastó.")
        g.concepto = concepto[:200]
    if "amount" in data or gasto is None:
        g.importe = decimal(data.get("amount"), "el monto", Decimal("0.01"))
    if "categoryId" in data or gasto is None:
        cat = CategoriaFinanciera.objects.filter(pk=data.get("categoryId"), tipo="EGRESO").first()
        if not cat:
            raise ValueError("Elige una categoría.")
        g.categoria = cat
    if "date" in data:
        fecha = parse_date(str(data.get("date") or ""))
        if not fecha:
            raise ValueError("La fecha no es válida.")
        g.fecha = fecha
    if "status" in data:
        if data["status"] not in Gasto.Estado.values:
            raise ValueError("Estado no válido.")
        g.estado = data["status"]
    if "due" in data:
        g.vence = parse_date(str(data.get("due") or "")) if data.get("due") else None
    if "method" in data and data["method"]:
        if data["method"] not in Pago.Metodo.values:
            raise ValueError("Método no válido.")
        g.metodo = data["method"]
    for campo, attr, largo in (("supplier", "proveedor", 150), ("receipt", "comprobante", 60)):
        if campo in data:
            setattr(g, attr, (data.get(campo) or "").strip()[:largo])
    if "notes" in data:
        g.observaciones = data.get("notes") or ""
    return g


class GastosView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_gastos", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        p = request.query_params
        qs = Gasto.objects.select_related("categoria", "registrado_por")
        if p.get("mes"):
            mes = leer_mes(p["mes"])
            qs = qs.filter(fecha__gte=mes, fecha__lt=mes_siguiente(mes))
        if p.get("estado"):
            qs = qs.filter(estado=p["estado"])
        if p.get("categoria"):
            qs = qs.filter(categoria_id=p["categoria"])
        if q := (p.get("q") or "").strip():
            qs = qs.filter(Q(concepto__icontains=q) | Q(proveedor__icontains=q) | Q(comprobante__icontains=q))
        hoy = timezone.localdate()
        items = [ser_gasto(g, hoy) for g in qs[:500]]
        return Response({"total": round(sum(i["amount"] for i in items), 2), "items": items})

    def post(self, request):
        try:
            g = leer_gasto(request.data)
        except ValueError as exc:
            return error(str(exc))
        g.registrado_por = request.user
        g.save()
        return Response(ser_gasto(g), status=status.HTTP_201_CREATED)


class GastoView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_gasto", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request, pk):
        g = get_object_or_404(Gasto, pk=pk)
        try:
            leer_gasto(request.data, g)
        except ValueError as exc:
            return error(str(exc))
        g.save()
        return Response(ser_gasto(g))

    def delete(self, request, pk):
        get_object_or_404(Gasto, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ============================================================
# GASTOS FIJOS
# ============================================================

def leer_fijo(data, fijo=None):
    c = fijo or CostoOperativo()
    if "name" in data or fijo is None:
        nombre = (data.get("name") or "").strip()
        if not nombre:
            raise ValueError("Escribe el nombre del gasto fijo.")
        c.nombre = nombre[:150]
    if "amount" in data or fijo is None:
        c.importe = decimal(data.get("amount"), "el monto")
    if "categoryId" in data or fijo is None:
        cat = CategoriaFinanciera.objects.filter(pk=data.get("categoryId"), tipo="EGRESO").first()
        if not cat:
            raise ValueError("Elige una categoría.")
        c.categoria = cat
    if "frequency" in data:
        if data["frequency"] not in CostoOperativo.Frecuencia.values:
            raise ValueError("Frecuencia no válida.")
        c.frecuencia = data["frequency"]
    if "from" in data and data["from"]:
        c.fecha_inicio = parse_date(str(data["from"])) or c.fecha_inicio
    if "to" in data:
        c.fecha_fin = parse_date(str(data["to"])) if data.get("to") else None
    if "payDay" in data:
        dia = data.get("payDay")
        c.dia_pago = int(dia) if dia not in (None, "") else None
        if c.dia_pago is not None and not 1 <= c.dia_pago <= 31:
            raise ValueError("El día de pago debe estar entre 1 y 31.")
    if "active" in data:
        c.activo = bool(data["active"])
    if "notes" in data:
        c.observaciones = data.get("notes") or ""
    return c


class FijosView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_fijos", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        mes = leer_mes(request.query_params.get("mes"))
        pagos = {g.costo_fijo_id: g for g in Gasto.objects.filter(mes_fijo=mes, costo_fijo__isnull=False)}
        items = [ser_fijo(c, mes, pagos) for c in CostoOperativo.objects.select_related("categoria").order_by("-activo", "nombre")]
        activos = [i for i in items if i["active"] and i["appliesThisMonth"]]
        return Response({
            "month": mes.strftime("%Y-%m"),
            "monthlyTotal": round(sum(i["monthly"] for i in activos), 2),
            "paidTotal": round(sum(i["paidAmount"] or 0 for i in activos if i["paid"]), 2),
            "items": items,
        })

    def post(self, request):
        try:
            c = leer_fijo(request.data)
        except ValueError as exc:
            return error(str(exc))
        c.save()
        return Response(ser_fijo(c), status=status.HTTP_201_CREATED)


class FijoView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_fijo", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request, pk):
        c = get_object_or_404(CostoOperativo, pk=pk)
        try:
            leer_fijo(request.data, c)
        except ValueError as exc:
            return error(str(exc))
        c.save()
        return Response(ser_fijo(c))

    def delete(self, request, pk):
        c = get_object_or_404(CostoOperativo, pk=pk)
        if c.gastos.exists():
            # Tiene pagos registrados: se desactiva para no perder el historial.
            c.activo = False
            c.fecha_fin = c.fecha_fin or timezone.localdate()
            c.save(update_fields=["activo", "fecha_fin"])
            return Response({"detail": "Tenía pagos registrados: se desactivó.", "fixed": ser_fijo(c)})
        c.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PagarFijoView(APIView):
    """Registra el pago de un gasto fijo para un mes (crea el gasto)."""

    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_fijo_pagar", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        c = get_object_or_404(CostoOperativo.objects.select_related("categoria"), pk=pk)
        mes = leer_mes(request.data.get("month"))
        try:
            importe = decimal(request.data.get("amount"), "el monto", Decimal("0.01"), obligatorio=False) or c.monto_mensual()
            if importe <= 0:
                raise ValueError("Indica el monto pagado.")
        except ValueError as exc:
            return error(str(exc))
        fecha = parse_date(str(request.data.get("date") or "")) or timezone.localdate()
        metodo = request.data.get("method") or Pago.Metodo.TRANSFERENCIA
        if metodo not in Pago.Metodo.values:
            return error("Método no válido.")
        try:
            g = Gasto(
                fecha=fecha, concepto=f"{c.nombre} · {etiqueta_mes(mes, larga=True)}", categoria=c.categoria,
                importe=importe, metodo=metodo, comprobante=(request.data.get("receipt") or "")[:60],
                estado=Gasto.Estado.PAGADO, costo_fijo=c, mes_fijo=mes, registrado_por=request.user,
                observaciones=request.data.get("notes") or "",
            )
            g.save()
        except IntegrityError:
            return error("Este gasto fijo ya está pagado para ese mes.")
        return Response(ser_gasto(g), status=status.HTTP_201_CREATED)


# ============================================================
# CATEGORÍAS, CONFIGURACIÓN Y METAS
# ============================================================

class CategoriasView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_categorias", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        qs = CategoriaFinanciera.objects.filter(tipo="EGRESO").order_by("-activa", "nombre")
        return Response([ser_categoria(c) for c in qs])

    def post(self, request):
        nombre = (request.data.get("name") or "").strip()
        if not nombre:
            return error("Escribe el nombre de la categoría.")
        c, creada = CategoriaFinanciera.objects.get_or_create(nombre=nombre[:100], defaults={"tipo": "EGRESO"})
        if not creada and c.tipo != "EGRESO":
            return error("Ya existe una categoría de ingresos con ese nombre.")
        if not c.activa:
            c.activa = True
            c.save(update_fields=["activa"])
        return Response(ser_categoria(c), status=status.HTTP_201_CREATED)


class CategoriaView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_categoria", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request, pk):
        c = get_object_or_404(CategoriaFinanciera, pk=pk, tipo="EGRESO")
        if "name" in request.data:
            nombre = (request.data.get("name") or "").strip()
            if not nombre:
                return error("El nombre no puede quedar vacío.")
            c.nombre = nombre[:100]
        if "active" in request.data:
            c.activa = bool(request.data["active"])
        try:
            c.save()
        except IntegrityError:
            return error("Ya existe una categoría con ese nombre.")
        return Response(ser_categoria(c))


def ser_config(cfg):
    hoy = timezone.localdate()
    mes = inicio_mes(hoy)
    metas = [
        {"month": m.mes.strftime("%Y-%m"), "label": etiqueta_mes(m.mes, larga=True), "goal": f(m.meta), "note": m.nota}
        for m in MetaMensual.objects.filter(mes__gte=mes_anterior(mes)).order_by("mes")
    ]
    return {
        "businessName": cfg.nombre_negocio,
        "monthlyGoal": f(cfg.meta_mensual),
        "targetMargin": f(cfg.margen_objetivo),
        "customGoals": metas,
        "updatedAt": cfg.actualizado_en,
    }


class ConfiguracionView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_configuracion", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response(ser_config(ConfiguracionNegocio.obtener()))

    def patch(self, request):
        cfg = ConfiguracionNegocio.obtener()
        try:
            if "monthlyGoal" in request.data:
                cfg.meta_mensual = decimal(request.data["monthlyGoal"], "la meta mensual")
            if "targetMargin" in request.data:
                m = decimal(request.data["targetMargin"], "el margen")
                if m > 100:
                    raise ValueError("El margen no puede ser mayor que 100%.")
                cfg.margen_objetivo = m
            if "businessName" in request.data:
                cfg.nombre_negocio = (request.data["businessName"] or "Fiancée").strip()[:120]
        except ValueError as exc:
            return error(str(exc))
        cfg.save()
        return Response(ser_config(cfg))


class MetasView(APIView):
    """Meta de un mes en particular. Con meta = null se borra y vuelve a la general."""

    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_metas", tags=["gerencia"], request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        mes = leer_mes(request.data.get("month"))
        if request.data.get("goal") in (None, ""):
            MetaMensual.objects.filter(mes=mes).delete()
        else:
            try:
                meta = decimal(request.data.get("goal"), "la meta")
            except ValueError as exc:
                return error(str(exc))
            MetaMensual.objects.update_or_create(mes=mes, defaults={"meta": meta, "nota": (request.data.get("note") or "")[:200]})
        return Response(ser_config(ConfiguracionNegocio.obtener()))


# ============================================================
# HORAS DEL PERSONAL
# ============================================================

class HorasPersonalView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_horas", tags=["gerencia"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        cerrar_jornadas_vencidas()
        hoy = timezone.localdate()
        ahora = timezone.now()
        desde = parse_date(request.query_params.get("desde") or "") or inicio_mes(hoy)
        hasta = parse_date(request.query_params.get("hasta") or "") or hoy
        if hasta < desde:
            desde, hasta = hasta, desde
        if (hasta - desde).days > 186:
            return error("Elige un periodo de hasta 6 meses.")

        trabajadoras = list(Trabajadora.objects.filter(activa=True).prefetch_related("horarios", "ausencias").order_by("nombre"))
        registros = {}
        for r in RegistroAsistencia.objects.filter(fecha__range=(desde, hasta), trabajadora__in=trabajadoras):
            registros.setdefault(r.trabajadora_id, {})[r.fecha] = r
        en_vestidos = {}
        for s in SesionVestido.objects.filter(jornada__fecha__range=(desde, hasta)).prefetch_related("pausas"):
            en_vestidos[s.trabajadora_id] = en_vestidos.get(s.trabajadora_id, CERO) + s.horas_efectivas

        filas = []
        tot = {"scheduled": 0.0, "worked": 0.0, "extra": 0.0, "dresses": 0.0, "missed": 0, "auto": 0}
        for t in trabajadoras:
            horario = {h.dia_semana: float(h.horas_disponibles) for h in t.horarios.all()}
            ausencias = list(t.ausencias.all())
            regs = registros.get(t.id, {})
            programadas = trabajadas = extra = 0.0
            faltas = permisos = autos = dias = 0
            d = desde
            while d <= hasta and d <= hoy:
                base = horario.get(d.weekday(), 0.0)
                aus = next((a for a in ausencias if a.fecha_inicio <= d <= a.fecha_fin), None)
                prog = max(0.0, base - (float(aus.horas_no_disponibles) if aus else 0.0))
                programadas += prog
                r = regs.get(d)
                if r:
                    dias += 1
                    h = float(r.horas_trabajadas) if r.salida else max(0.0, (ahora - r.entrada).total_seconds() / 3600)
                    trabajadas += h
                    extra += float(r.horas_extra)
                    autos += int(r.cierre_automatico)
                elif aus:
                    permisos += 1
                elif base > 0 and d < hoy:
                    faltas += 1
                d += timedelta(days=1)
            vest = float(en_vestidos.get(t.id, CERO))
            filas.append({
                "id": str(t.id),
                "name": t.nombre,
                "area": Trabajadora.Area(t.area).label if t.area in Trabajadora.Area.values else t.area,
                "daysWorked": dias,
                "scheduled": round(programadas, 2),
                "worked": round(trabajadas, 2),
                "extra": round(extra, 2),
                "inDresses": round(vest, 2),
                "missed": faltas,
                "absences": permisos,
                "autoClosed": autos,
                "compliance": round(trabajadas / programadas, 3) if programadas else None,
                "productive": round(vest / trabajadas, 3) if trabajadas else None,
            })
            tot["scheduled"] += programadas
            tot["worked"] += trabajadas
            tot["extra"] += extra
            tot["dresses"] += vest
            tot["missed"] += faltas
            tot["auto"] += autos

        return Response({
            "from": desde,
            "to": hasta,
            "totals": {
                "scheduled": round(tot["scheduled"], 2),
                "worked": round(tot["worked"], 2),
                "extra": round(tot["extra"], 2),
                "inDresses": round(tot["dresses"], 2),
                "missed": tot["missed"],
                "autoClosed": tot["auto"],
                "compliance": round(tot["worked"] / tot["scheduled"], 3) if tot["scheduled"] else None,
                "productive": round(tot["dresses"] / tot["worked"], 3) if tot["worked"] else None,
            },
            "rows": filas,
        })


# ============================================================
# INDICADORES
# ============================================================

class IndicadoresView(APIView):
    permission_classes = [PermisoGerencia]

    @extend_schema(operation_id="gerencia_indicadores", tags=["gerencia"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        hoy = timezone.localdate()
        try:
            meses = max(1, min(12, int(request.query_params.get("meses", 6))))
        except ValueError:
            meses = 6
        fin = mes_siguiente(inicio_mes(hoy))
        ini = inicio_mes(hoy)
        for _ in range(meses - 1):
            ini = mes_anterior(ini)

        contratos = list(Contrato.objects.filter(fecha_firma__gte=ini, fecha_firma__lt=fin).exclude(estado="CANCELADO").prefetch_related("vestidos", "pagos"))
        n_contratos = len(contratos)
        vendido_total = sum((c.precio_total for c in contratos), CERO)
        n_vestidos = sum(len(c.vestidos.all()) for c in contratos)
        cobrado_de_ventas = sum((p.importe for c in contratos for p in c.pagos.all() if p.confirmado), CERO)

        sims = SimulacionContrato.objects.filter(fecha_simulacion__date__gte=ini, fecha_simulacion__date__lt=fin)
        n_sims = sims.count()
        n_acept = sims.filter(estado=SimulacionContrato.Estado.ACEPTADA).count()

        # Entregas a tiempo: vestidos terminados en el periodo.
        terminados = []
        for v in VestidoContrato.objects.filter(estado="FINALIZADO", ruta__isnull=False).select_related("contrato").prefetch_related("pasos"):
            pasos = list(v.pasos.all())
            fechas_fin = [p.completado_en for p in pasos if p.completado_en]
            fechas_ini = [p.iniciado_en for p in pasos if p.iniciado_en]
            if not fechas_fin:
                continue
            termino = timezone.localtime(max(fechas_fin)).date()
            if not (ini <= termino < fin):
                continue
            empezo = timezone.localtime(min(fechas_ini)).date() if fechas_ini else None
            terminados.append({"a_tiempo": termino <= v.fecha_limite_efectiva, "dias": (termino - empezo).days if empezo else None, "fecha": termino})
        a_tiempo = sum(1 for t in terminados if t["a_tiempo"])
        duraciones = [t["dias"] for t in terminados if t["dias"] is not None]

        # Tiempos reales vs. estimados por proceso.
        reales = {}
        for s in SesionVestido.objects.filter(paso__isnull=False, paso__estado=PasoVestido.Estado.COMPLETADO, inicio__date__gte=ini).select_related("paso").prefetch_related("pausas"):
            reales[s.paso_id] = reales.get(s.paso_id, CERO) + s.horas_efectivas
        procesos = {}
        for p in PasoVestido.objects.filter(pk__in=reales.keys()):
            d = procesos.setdefault(p.nombre.lower(), {"name": p.nombre, "count": 0, "est": CERO, "real": CERO})
            d["count"] += 1
            d["est"] += p.horas_estimadas
            d["real"] += reales[p.id]
        eficiencia = []
        for d in procesos.values():
            est = float(d["est"]) / d["count"]
            real = float(d["real"]) / d["count"]
            eficiencia.append({"name": d["name"], "count": d["count"], "estimated": round(est, 2), "real": round(real, 2),
                               "diff": round((real - est) / est, 3) if est else None})
        eficiencia.sort(key=lambda x: -(abs(x["diff"]) if x["diff"] is not None else 0))

        # Serie mensual.
        serie = []
        m = ini
        cfg = ConfiguracionNegocio.obtener()
        while m < fin:
            s = mes_siguiente(m)
            n, v = vendido(m, s)
            i = ingresos(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            g = gastos_pagados(m, s).aggregate(t=Sum("importe"))["t"] or CERO
            meta, _ = cfg.meta_de(m)
            regs = RegistroAsistencia.objects.filter(fecha__gte=m, fecha__lt=s, salida__isnull=False)
            h_trab = sum((r.horas_trabajadas or CERO for r in regs), CERO) + sum((r.horas_extra for r in regs), CERO)
            h_vest = sum((x.horas_efectivas for x in SesionVestido.objects.filter(jornada__fecha__gte=m, jornada__fecha__lt=s).prefetch_related("pausas")), CERO)
            ent = [t for t in terminados if m <= t["fecha"] < s]
            serie.append({
                "month": m.strftime("%Y-%m"), "label": etiqueta_mes(m), "contracts": n, "sold": f(v),
                "avgTicket": f(v / n) if n else 0,
                "hoursWorked": f(h_trab), "hoursInDresses": f(h_vest),
                "deliveredOnTime": sum(1 for t in ent if t["a_tiempo"]),
                "deliveredLate": sum(1 for t in ent if not t["a_tiempo"]),
                "income": f(i), "expense": f(g), "profit": f(i - g),
                "margin": round(float((i - g) / i), 3) if i else None, "goal": f(meta),
                "goalReached": bool(meta and i >= meta),
            })
            m = s

        # Productividad del personal en el periodo.
        trabajadas = sum(
            (r.horas_trabajadas or CERO for r in RegistroAsistencia.objects.filter(fecha__gte=ini, fecha__lt=fin, salida__isnull=False)),
            CERO,
        )
        en_vestidos = sum((s.horas_efectivas for s in SesionVestido.objects.filter(jornada__fecha__gte=ini, jornada__fecha__lt=fin).prefetch_related("pausas")), CERO)

        clientes_top = {}
        for c in contratos:
            nombre = c.cliente.nombre if c.cliente_id else "Sin nombre"
            clientes_top[nombre] = clientes_top.get(nombre, CERO) + c.precio_total

        # Repartos para gráficos de torta.
        def reparto(pares):
            acc = {}
            for clave, monto in pares:
                d = acc.setdefault(clave, {"name": clave, "total": CERO, "count": 0})
                d["total"] += monto
                d["count"] += 1
            return [{"name": x["name"], "total": f(x["total"]), "count": x["count"]} for x in sorted(acc.values(), key=lambda x: -x["total"])]

        evento = reparto(
            ((c.get_tipo_evento_display() if c.tipo_evento != "OTRO" else (c.tipo_evento_detalle or "Otros")), c.precio_total)
            for c in contratos
        )
        talleres = {"A": "Taller A", "C": "Taller C", "T": "Tienda"}
        vestidos_periodo = [v for c in contratos for v in c.vestidos.all()]
        por_taller = reparto(
            (talleres.get(v.ruta.taller, "Sin taller") if v.ruta_id else "Sin taller (accesorios)", v.precio + v.precio_otros)
            for v in VestidoContrato.objects.filter(pk__in=[v.pk for v in vestidos_periodo]).select_related("ruta")
        )
        modalidad = reparto((v.get_modalidad_display(), v.precio + v.precio_otros) for v in vestidos_periodo)
        metodos = reparto(
            (METODOS.get(p.metodo, p.metodo), p.importe) for p in ingresos(ini, fin)
        )
        categorias = reparto((g.categoria.nombre, g.importe) for g in gastos_pagados(ini, fin).select_related("categoria"))

        # Saldos por cobrar según cuándo se recoge.
        hoy_ = timezone.localdate()
        saldos = saldos_activos()
        cortes = [("Ya debió pagarse", None, -1), ("Esta semana", 0, 7), ("En 8 a 30 días", 8, 30), ("En más de 30 días", 31, None)]
        aging = {c[0]: CERO for c in cortes}
        for c in Contrato.objects.filter(estado__in=ACTIVOS):
            saldo = saldos.get(c.id, CERO)
            if saldo <= 0:
                continue
            dias = (c.fecha_entrega - hoy_).days
            for nombre, a, b in cortes:
                if (a is None or dias >= a) and (b is None or dias <= b):
                    aging[nombre] += saldo
                    break
        por_cobrar = [{"name": k, "total": f(v)} for k, v in aging.items()]

        # Embudo comercial del periodo.
        embudo = [
            {"name": "Contratos", "value": n_contratos},
            {"name": "Con algún pago", "value": sum(1 for c in contratos if any(p.confirmado for p in c.pagos.all()))},
            {"name": "Pagados completo", "value": sum(1 for c in contratos if sum((p.importe for p in c.pagos.all() if p.confirmado), CERO) >= c.precio_total > 0)},
        ]

        # Horas por proceso (dónde se va el tiempo del taller).
        horas_proc = {}
        for x in SesionVestido.objects.filter(jornada__fecha__gte=ini, jornada__fecha__lt=fin, paso__isnull=False).select_related("paso").prefetch_related("pausas"):
            nombre = x.paso.nombre.capitalize()
            horas_proc[nombre] = horas_proc.get(nombre, CERO) + x.horas_efectivas
        horas_por_proceso = [{"name": k, "hours": f(v)} for k, v in sorted(horas_proc.items(), key=lambda x: -x[1])[:8]]

        ingresos_total = sum((Decimal(str(x["income"])) for x in serie), CERO)
        gastos_total = sum((Decimal(str(x["expense"])) for x in serie), CERO)

        return Response({
            "from": ini,
            "to": fin - timedelta(days=1),
            "months": meses,
            "sales": {
                "contracts": n_contratos,
                "sold": f(vendido_total),
                "avgTicket": f(vendido_total / n_contratos) if n_contratos else 0,
                "avgDressPrice": f(vendido_total / n_vestidos) if n_vestidos else 0,
                "dresses": n_vestidos,
                "collectedRate": round(float(cobrado_de_ventas / vendido_total), 3) if vendido_total else None,
                "simulations": n_sims,
                "conversion": round(n_acept / n_sims, 3) if n_sims else None,
            },
            "production": {
                "finished": len(terminados),
                "onTime": a_tiempo,
                "onTimeRate": round(a_tiempo / len(terminados), 3) if terminados else None,
                "avgDays": round(sum(duraciones) / len(duraciones), 1) if duraciones else None,
                "processes": eficiencia[:12],
            },
            "people": {
                "worked": f(trabajadas),
                "inDresses": f(en_vestidos),
                "productive": round(float(en_vestidos / trabajadas), 3) if trabajadas else None,
            },
            "money": {
                "income": f(ingresos_total),
                "expense": f(gastos_total),
                "profit": f(ingresos_total - gastos_total),
                "margin": round(float((ingresos_total - gastos_total) / ingresos_total), 3) if ingresos_total else None,
                "targetMargin": f(cfg.margen_objetivo),
                "goalsReached": sum(1 for x in serie if x["goalReached"]),
            },
            "topClients": [{"name": k, "total": f(v)} for k, v in sorted(clientes_top.items(), key=lambda x: -x[1])[:5]],
            "byEvent": evento,
            "byWorkshop": por_taller,
            "byModality": modalidad,
            "paymentMethods": metodos,
            "expenseCategories": categorias,
            "receivables": por_cobrar,
            "funnel": embudo,
            "hoursByProcess": horas_por_proceso,
            "series": serie,
        })
