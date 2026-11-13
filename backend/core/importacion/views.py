"""Panel de TI: plantillas, importación de Excel e historial."""

from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    Cliente,
    Contrato,
    Gasto,
    ImportacionDatos,
    Pago,
    Trabajadora,
    VestidoContrato,
)

from .esquema import HOJAS_POR_CLAVE, esquema_publico
from .importador import procesar
from .plantilla import generar_plantilla

MAX_MB = 10


class PermisoTI(IsAuthenticated):
    message = "Esta sección es solo para el área de TI."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser or getattr(request.user, "rol", None) == "ti"


def _historial(qs):
    return [
        {
            "id": i.id,
            "archivo": i.archivo,
            "estado": i.estado,
            "usuario": (i.usuario.get_full_name() or i.usuario.username) if i.usuario else "",
            "fecha": i.creado_en,
            "hojas": i.resumen.get("hojas", []),
            "total_errores": i.resumen.get("total_errores", 0),
            "errores": i.errores[:100],
        }
        for i in qs.select_related("usuario")
    ]


class ResumenTIView(APIView):
    """GET /api/core/ti/resumen/ · Cuánta información hay hoy en el sistema."""

    permission_classes = [PermisoTI]

    def get(self, request):
        ingresos = Pago.objects.filter(confirmado=True).aggregate(t=Sum("importe"))["t"] or 0
        egresos = Gasto.objects.filter(estado=Gasto.Estado.PAGADO).aggregate(t=Sum("importe"))["t"] or 0
        ultima = ImportacionDatos.objects.filter(estado=ImportacionDatos.Estado.IMPORTADO).first()
        return Response({
            "datos": [
                {"clave": "clientes", "titulo": "Clientas", "total": Cliente.objects.filter(activo=True).count()},
                {"clave": "personal", "titulo": "Personal activo", "total": Trabajadora.objects.filter(activa=True).count()},
                {"clave": "contratos", "titulo": "Contratos", "total": Contrato.objects.count(),
                 "detalle": f"{Contrato.objects.filter(estado__in=['ACTIVO', 'EN_PRODUCCION']).count()} activos"},
                {"clave": "vestidos", "titulo": "Vestidos", "total": VestidoContrato.objects.count(),
                 "detalle": f"{VestidoContrato.objects.exclude(estado='FINALIZADO').count()} en curso"},
                {"clave": "pagos", "titulo": "Pagos", "total": Pago.objects.filter(confirmado=True).count(),
                 "detalle": f"S/ {ingresos:,.2f}"},
                {"clave": "gastos", "titulo": "Gastos", "total": Gasto.objects.count(),
                 "detalle": f"S/ {egresos:,.2f}"},
            ],
            "ultima_importacion": ultima.creado_en if ultima else None,
            "importaciones": ImportacionDatos.objects.filter(estado=ImportacionDatos.Estado.IMPORTADO).count(),
            "recientes": _historial(ImportacionDatos.objects.all()[:5]),
        })


class EsquemaView(APIView):
    """GET /api/core/ti/esquema/ · Hojas y columnas de la plantilla."""

    permission_classes = [PermisoTI]

    def get(self, request):
        return Response({"hojas": esquema_publico()})


class PlantillaView(APIView):
    """GET /api/core/ti/plantilla/?hojas=clientes,pagos · Descarga el Excel."""

    permission_classes = [PermisoTI]

    def get(self, request):
        claves = [c for c in (request.query_params.get("hojas") or "").split(",") if c in HOJAS_POR_CLAVE]
        if "vestidos" in claves and "contratos" not in claves:
            claves.append("contratos")
        if "contratos" in claves and "vestidos" not in claves:
            claves.append("vestidos")
        contenido = generar_plantilla(claves or None)
        nombre = "plantilla_fiancee.xlsx" if not claves else f"plantilla_{'_'.join(sorted(set(claves)))}.xlsx"
        resp = HttpResponse(
            contenido,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        resp["Content-Disposition"] = f'attachment; filename="{nombre}"'
        resp["Access-Control-Expose-Headers"] = "Content-Disposition"
        return resp


class ImportarView(APIView):
    """
    POST /api/core/ti/importar/  (multipart: archivo, guardar=0|1)

    guardar=0 → solo revisa y devuelve lo que pasaría (no guarda nada).
    guardar=1 → guarda, solo si no hay errores.
    """

    permission_classes = [PermisoTI]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        archivo = request.FILES.get("archivo")
        if not archivo:
            return Response({"error": "Selecciona un archivo Excel."}, status=status.HTTP_400_BAD_REQUEST)
        if not archivo.name.lower().endswith((".xlsx", ".xlsm")):
            return Response(
                {"error": "El archivo debe ser Excel (.xlsx). Si lo tienes en .xls o .csv, ábrelo en Excel y guárdalo como .xlsx."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if archivo.size > MAX_MB * 1024 * 1024:
            return Response({"error": f"El archivo pesa más de {MAX_MB} MB. Divídelo en partes."}, status=status.HTTP_400_BAD_REQUEST)

        guardar = str(request.data.get("guardar", "0")).lower() in ("1", "true", "si", "sí")
        try:
            resultado = procesar(archivo, usuario=request.user, guardar=guardar)
        except ValidationError as exc:
            return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        if guardar:
            ImportacionDatos.objects.create(
                archivo=archivo.name[:200],
                usuario=request.user,
                estado=ImportacionDatos.Estado.IMPORTADO if resultado["guardado"] else ImportacionDatos.Estado.CON_ERRORES,
                resumen={k: resultado[k] for k in ("hojas", "total_errores", "total_avisos")},
                errores=resultado["errores"][:200],
                creado_en=timezone.now(),
            )
        return Response(resultado)


class HistorialView(APIView):
    """GET /api/core/ti/historial/"""

    permission_classes = [PermisoTI]

    def get(self, request):
        return Response({"importaciones": _historial(ImportacionDatos.objects.all()[:100])})
