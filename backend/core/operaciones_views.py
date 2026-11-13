"""
Endpoints compartidos entre Comercial, Jefa de taller y Gerencia:

  GET/POST  /api/core/contratos/<id>/pagos/            pagos del contrato (1.º, 2.º, 3.º y otros)
  GET/POST  /api/core/vestidos/<id>/archivos/          fichas técnicas y referencias
  DELETE    /api/core/vestidos/<id>/archivos/<aid>/
  PATCH     /api/core/vestidos/<id>/ficha/             texto de la ficha técnica
  GET/POST  /api/core/gastos-area/                     gastos registrados por taller y tienda
  GET       /api/core/calendario/?mes=2026-11          salidas y devoluciones de vestidos
"""

import calendar
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import ArchivoVestido, CategoriaFinanciera, Contrato, Gasto, Pago, VestidoContrato
from core.services.pagos import registrar_abono, resumen_pagos

COMERCIAL, JEFA, GERENCIA, TALLER = "comercial", "jefa_taller", "gerencia", "taller"


def _rol(u):
    return getattr(u, "rol", "") or ("gerencia" if u.is_superuser else "")


class Roles(IsAuthenticated):
    """Permiso por rol: lectura y escritura por separado."""

    lectura = ()
    escritura = ()
    message = "Tu rol no tiene acceso a esta sección."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        roles = self.lectura if request.method in ("GET", "HEAD", "OPTIONS") else self.escritura
        return _rol(request.user) in roles


def roles(lectura, escritura):
    return type("RolesX", (Roles,), {"lectura": lectura, "escritura": escritura})


def _error(exc):
    msg = " ".join(exc.messages) if hasattr(exc, "messages") else str(exc)
    return Response({"error": msg}, status=status.HTTP_400_BAD_REQUEST)


def _nombre(u):
    return (u.get_full_name() or u.username) if u else ""


# ─── Pagos ────────────────────────────────────────────────────────

class ContratoPagosView(APIView):
    permission_classes = [roles((COMERCIAL, JEFA, GERENCIA), (COMERCIAL, JEFA, GERENCIA))]

    class Entrada(serializers.Serializer):
        amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
        method = serializers.ChoiceField(choices=Pago.Metodo.choices, required=False)
        date = serializers.DateField(required=False)
        reference = serializers.CharField(required=False, allow_blank=True, max_length=100)
        number = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=3)
        description = serializers.CharField(required=False, allow_blank=True, max_length=150)
        notes = serializers.CharField(required=False, allow_blank=True)
        dressId = serializers.IntegerField(required=False, allow_null=True)

    def get(self, request, pk):
        contrato = get_object_or_404(Contrato.objects.select_related("cliente"), pk=pk)
        return Response(resumen_pagos(contrato))

    def post(self, request, pk):
        if _rol(request.user) == GERENCIA and not request.user.is_superuser:
            return Response({"error": "Gerencia solo puede ver los pagos."}, status=status.HTTP_403_FORBIDDEN)
        contrato = get_object_or_404(Contrato, pk=pk)
        e = self.Entrada(data=request.data)
        e.is_valid(raise_exception=True)
        d = e.validated_data
        vestido = None
        if d.get("dressId"):
            vestido = VestidoContrato.objects.filter(pk=d["dressId"], contrato=contrato).first()
        try:
            pago = registrar_abono(
                contrato, d["amount"], request.user, d.get("method"), d.get("date"), d.get("reference", ""),
                numero=d.get("number"), descripcion=d.get("description", ""), observaciones=d.get("notes", ""),
                vestido=vestido,
            )
        except ValidationError as exc:
            return _error(exc)
        contrato.refresh_from_db()
        data = resumen_pagos(contrato)
        data["message"] = f"{pago.concepto}: S/ {pago.importe:,.2f} registrado (recibo {pago.codigo})."
        data["created"] = pago.id
        return Response(data, status=status.HTTP_201_CREATED)


# ─── Fichas técnicas y referencias ───────────────────────────────

EXT_PERMITIDAS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".pdf", ".gif")
MAX_MB = 15


def _puede_ver_vestido(user, vestido):
    rol = _rol(user)
    if rol in (COMERCIAL, JEFA, GERENCIA):
        return True
    if rol == TALLER:
        # El personal ve la ficha de los vestidos que están en el taller.
        perfil = getattr(user, "perfil_trabajadora", None)
        return bool(perfil) and (
            vestido.pasos.filter(trabajadoras=perfil).exists()
            or (vestido.ruta_id and vestido.estado != "FINALIZADO")
        )
    return False


def serializar_archivo(a, request):
    url = a.archivo.url if a.archivo else ""
    if url and request is not None:
        url = request.build_absolute_uri(url)
    nombre = a.nombre or a.archivo.name.rsplit("/", 1)[-1]
    return {
        "id": a.id, "kind": a.tipo, "kindLabel": a.get_tipo_display(),
        "url": url, "name": nombre, "description": a.descripcion,
        "isImage": nombre.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic")),
        "by": _nombre(a.subido_por), "createdAt": a.creado_en,
    }


def ficha_vestido(vestido, request):
    return {
        "dressId": vestido.id,
        "code": vestido.codigo,
        "sheet": vestido.ficha_tecnica,
        "files": [serializar_archivo(a, request) for a in vestido.archivos.select_related("subido_por")],
    }


class ArchivosVestidoView(APIView):
    permission_classes = [roles((COMERCIAL, JEFA, GERENCIA, TALLER), (COMERCIAL, JEFA))]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, pk):
        vestido = get_object_or_404(VestidoContrato, pk=pk)
        if not _puede_ver_vestido(request.user, vestido):
            return Response({"error": "Este vestido no está asignado a ti."}, status=status.HTTP_403_FORBIDDEN)
        return Response(ficha_vestido(vestido, request))

    def post(self, request, pk):
        vestido = get_object_or_404(VestidoContrato, pk=pk)
        tipo = request.data.get("kind", ArchivoVestido.Tipo.REFERENCIA)
        if tipo not in ArchivoVestido.Tipo.values:
            tipo = ArchivoVestido.Tipo.REFERENCIA
        archivos = request.FILES.getlist("files") or request.FILES.getlist("file")
        if not archivos:
            return Response({"error": "Elige al menos un archivo."}, status=status.HTTP_400_BAD_REQUEST)
        for f in archivos:
            if not f.name.lower().endswith(EXT_PERMITIDAS):
                return Response({"error": f"«{f.name}»: solo fotos (JPG, PNG) o PDF."}, status=status.HTTP_400_BAD_REQUEST)
            if f.size > MAX_MB * 1024 * 1024:
                return Response({"error": f"«{f.name}» pesa más de {MAX_MB} MB."}, status=status.HTTP_400_BAD_REQUEST)
        for f in archivos:
            ArchivoVestido.objects.create(
                vestido=vestido, tipo=tipo, archivo=f, nombre=f.name[:200],
                descripcion=(request.data.get("description") or "")[:300], subido_por=request.user,
            )
        return Response(ficha_vestido(vestido, request), status=status.HTTP_201_CREATED)


class ArchivoVestidoView(APIView):
    permission_classes = [roles((), (COMERCIAL, JEFA))]

    def delete(self, request, pk, aid):
        a = get_object_or_404(ArchivoVestido, pk=aid, vestido_id=pk)
        a.archivo.delete(save=False)
        a.delete()
        return Response(ficha_vestido(a.vestido, request))


class FichaTecnicaView(APIView):
    permission_classes = [roles((), (COMERCIAL, JEFA))]

    def patch(self, request, pk):
        vestido = get_object_or_404(VestidoContrato, pk=pk)
        vestido.ficha_tecnica = (request.data.get("sheet") or "").strip()
        vestido.save(update_fields=["ficha_tecnica"])
        return Response(ficha_vestido(vestido, request))


# ─── Gastos de taller y tienda ───────────────────────────────────

AREA_GASTO_LABEL = {"TIENDA": "Comercial", "TALLER": "Taller", "GERENCIA": "Gerencia"}
AREA_DE_ROL = {COMERCIAL: "TIENDA", JEFA: "TALLER"}


def serializar_gasto(g, request=None):
    url = g.archivo.url if g.archivo else ""
    if url and request is not None:
        url = request.build_absolute_uri(url)
    return {
        "id": g.id, "date": g.fecha, "createdAt": g.creado_en, "concept": g.concepto,
        "category": g.categoria.nombre, "categoryId": g.categoria_id, "amount": float(g.importe),
        "method": g.metodo, "methodLabel": g.get_metodo_display(), "supplier": g.proveedor,
        "receipt": g.comprobante, "notes": g.observaciones, "file": url,
        "by": _nombre(g.registrado_por) or "Finanzas", "byId": g.registrado_por_id,
        "byRole": (g.registrado_por.get_rol_display() if g.registrado_por_id and hasattr(g.registrado_por, "get_rol_display") else ""),
        "area": g.area, "areaLabel": AREA_GASTO_LABEL.get(g.area, g.get_area_display()),
    }


class GastosAreaView(APIView):
    """Jefa de taller y Comercial registran sus gastos; gerencia los ve todos en Finanzas."""

    permission_classes = [roles((COMERCIAL, JEFA, GERENCIA), (COMERCIAL, JEFA, GERENCIA))]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        """
        ?mes=YYYY-MM. Comercial y la jefa ven solo los gastos de su área.
        Gerencia ve todo y puede filtrar: ?area=TIENDA|TALLER|GERENCIA,
        ?categoria=<id>, ?persona=<id>, ?q=texto.
        """
        hoy = timezone.localdate()
        try:
            y, m = map(int, (request.query_params.get("mes") or hoy.strftime("%Y-%m")).split("-"))
            ini = date(y, m, 1)
        except ValueError:
            ini = hoy.replace(day=1)
        fin = date(ini.year + (ini.month // 12), ini.month % 12 + 1, 1)
        base = Gasto.objects.filter(fecha__gte=ini, fecha__lt=fin).select_related("categoria", "registrado_por")
        rol = _rol(request.user)
        es_gerencia = rol not in AREA_DE_ROL
        if not es_gerencia:
            base = base.filter(area=AREA_DE_ROL[rol])

        # Resumen por área y lista de personas (antes de filtrar, para armar los filtros).
        por_area = {}
        personas = {}
        for g in base:
            por_area[g.area] = por_area.get(g.area, Decimal("0")) + g.importe
            if g.registrado_por_id:
                personas[g.registrado_por_id] = _nombre(g.registrado_por)

        qs = base
        p = request.query_params
        if es_gerencia and p.get("area") in AREA_GASTO_LABEL:
            qs = qs.filter(area=p["area"])
        if (p.get("categoria") or "").isdigit():
            qs = qs.filter(categoria_id=int(p["categoria"]))
        if (p.get("persona") or "").isdigit():
            qs = qs.filter(registrado_por_id=int(p["persona"]))
        if p.get("q"):
            qs = qs.filter(concepto__icontains=p["q"].strip()) | qs.filter(proveedor__icontains=p["q"].strip())

        gastos = list(qs.order_by("-fecha", "-creado_en"))
        por_cat = {}
        for g in gastos:
            por_cat[g.categoria.nombre] = por_cat.get(g.categoria.nombre, 0) + float(g.importe)
        total_mes = sum(por_area.values(), Decimal("0"))
        return Response({
            "month": ini.strftime("%Y-%m"),
            "scope": "TODO" if es_gerencia else AREA_DE_ROL[rol],
            "total": float(sum((g.importe for g in gastos), Decimal("0"))),
            "monthTotal": float(total_mes),
            "count": len(gastos),
            "byArea": [
                {"area": a, "label": AREA_GASTO_LABEL[a], "total": float(por_area.get(a, Decimal("0")))}
                for a in (("TIENDA", "TALLER", "GERENCIA") if es_gerencia else (AREA_DE_ROL[rol],))
            ],
            "byCategory": [{"name": k, "total": v} for k, v in sorted(por_cat.items(), key=lambda x: -x[1])],
            "people": [{"id": k, "name": v} for k, v in sorted(personas.items(), key=lambda x: x[1])],
            "expenses": [serializar_gasto(g, request) for g in gastos],
            "categories": [
                {"id": c.id, "name": c.nombre}
                for c in CategoriaFinanciera.objects.filter(tipo=CategoriaFinanciera.Tipo.EGRESO, activa=True).order_by("nombre")
            ],
        })

    def post(self, request):
        d = request.data
        try:
            importe = Decimal(str(d.get("amount") or "0")).quantize(Decimal("0.01"))
        except Exception:
            return Response({"error": "El monto no es válido."}, status=status.HTTP_400_BAD_REQUEST)
        if importe <= 0:
            return Response({"error": "El monto debe ser mayor que cero."}, status=status.HTTP_400_BAD_REQUEST)
        concepto = (d.get("concept") or "").strip()
        if not concepto:
            return Response({"error": "Escribe en qué se gastó."}, status=status.HTTP_400_BAD_REQUEST)
        categoria = CategoriaFinanciera.objects.filter(pk=d.get("categoryId"), tipo=CategoriaFinanciera.Tipo.EGRESO).first()
        if categoria is None:
            return Response({"error": "Elige una categoría."}, status=status.HTTP_400_BAD_REQUEST)
        archivo = request.FILES.get("file")
        if archivo and not archivo.name.lower().endswith(EXT_PERMITIDAS):
            return Response({"error": "El comprobante debe ser foto o PDF."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            fecha = date.fromisoformat(d.get("date")) if d.get("date") else timezone.localdate()
        except ValueError:
            fecha = timezone.localdate()
        metodo = d.get("method") if d.get("method") in Pago.Metodo.values else Pago.Metodo.EFECTIVO
        g = Gasto.objects.create(
            fecha=fecha, concepto=concepto[:200], categoria=categoria, importe=importe, metodo=metodo,
            proveedor=(d.get("supplier") or "")[:150], comprobante=(d.get("receipt") or "")[:60],
            observaciones=d.get("notes") or "", estado=Gasto.Estado.PAGADO, registrado_por=request.user,
            archivo=archivo or "", area=AREA_DE_ROL.get(_rol(request.user), Gasto.Area.GERENCIA),
        )

        from core.services.notificaciones import ROL_GERENCIA, notificar, usuarios_con_rol

        area = AREA_GASTO_LABEL[g.area]
        if g.area != Gasto.Area.GERENCIA:
            notificar(
                usuarios_con_rol(ROL_GERENCIA), "GASTO", f"Gasto registrado · {area}",
                f"{_nombre(request.user)}: {concepto} ({categoria.nombre}) S/ {importe:,.2f}.",
            )
        return Response(serializar_gasto(g, request), status=status.HTTP_201_CREATED)


# ─── Calendario de salidas ───────────────────────────────────────

class CalendarioView(APIView):
    permission_classes = [roles((COMERCIAL, JEFA, GERENCIA), ())]

    def get(self, request):
        hoy = timezone.localdate()
        try:
            y, m = map(int, (request.query_params.get("mes") or hoy.strftime("%Y-%m")).split("-"))
            ini = date(y, m, 1)
        except ValueError:
            ini = hoy.replace(day=1)
        ultimo = date(ini.year, ini.month, calendar.monthrange(ini.year, ini.month)[1])
        # Se incluye la semana anterior y siguiente para la grilla.
        desde, hasta = ini - timedelta(days=7), ultimo + timedelta(days=7)

        pagado = {
            r["contrato_id"]: r["t"]
            for r in Pago.objects.filter(confirmado=True).values("contrato_id").annotate(t=Sum("importe"))
        }
        contratos = (
            Contrato.objects.exclude(estado="CANCELADO")
            .filter(fecha_entrega__range=(desde, hasta)) | Contrato.objects.exclude(estado="CANCELADO").filter(fecha_devolucion__range=(desde, hasta))
        )
        eventos = []
        for c in contratos.select_related("cliente").prefetch_related("vestidos__tipo_vestido").distinct():
            saldo = c.precio_total - (pagado.get(c.id) or Decimal("0"))
            vestidos = [
                {
                    "code": v.codigo,
                    "name": v.tipo_vestido.nombre if v.tipo_vestido_id else (v.descripcion or "Vestido"),
                    "mode": v.get_modalidad_display(),
                    "rental": v.modalidad == VestidoContrato.Modalidad.ALQUILER,
                    "status": v.get_estado_display(),
                    "ready": v.estado == "FINALIZADO" or not v.ruta_id,
                }
                for v in c.vestidos.all()
            ]
            base = {
                "contractId": c.id, "contract": c.numero,
                "client": c.cliente.nombre if c.cliente_id else "", "phone": c.cliente.telefono if c.cliente_id else "",
                "dresses": vestidos, "total": float(c.precio_total), "balance": float(max(saldo, Decimal("0"))),
                "collected": float(pagado.get(c.id) or Decimal("0")),
                "paid": saldo <= 0, "rental": any(v["rental"] for v in vestidos),
                "guarantee": float(c.garantia or 0), "guaranteeDetail": c.garantia_detalle,
                "event": c.fecha_evento, "eventType": c.get_tipo_evento_display(),
                "ready": all(v["ready"] for v in vestidos) if vestidos else True,
                "status": c.get_estado_display(),
            }
            if desde <= c.fecha_entrega <= hasta:
                eventos.append({**base, "kind": "SALIDA", "date": c.fecha_entrega})
            if c.fecha_devolucion and desde <= c.fecha_devolucion <= hasta:
                eventos.append({**base, "kind": "DEVOLUCION", "date": c.fecha_devolucion})
        eventos.sort(key=lambda e: (e["date"], e["contract"]))
        return Response({
            "month": ini.strftime("%Y-%m"), "today": hoy,
            "events": eventos,
            "summary": {
                "out": sum(1 for e in eventos if e["kind"] == "SALIDA" and ini <= e["date"] <= ultimo),
                "returns": sum(1 for e in eventos if e["kind"] == "DEVOLUCION" and ini <= e["date"] <= ultimo),
                "withBalance": sum(1 for e in eventos if e["kind"] == "SALIDA" and not e["paid"] and ini <= e["date"] <= ultimo),
                "balance": float(sum((Decimal(str(e["balance"])) for e in eventos if e["kind"] == "SALIDA" and not e["paid"] and ini <= e["date"] <= ultimo), Decimal("0"))),
            },
        })
