from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Notificacion
from core.services.jornada import cerrar_jornadas_vencidas
from core.services.notificaciones import sincronizar_avisos_taller


def serializar(n):
    return {
        "id": n.id,
        "type": n.tipo,
        "title": n.titulo,
        "message": n.mensaje,
        "read": n.leida,
        "createdAt": n.creada_en,
        "dressId": str(n.vestido_id) if n.vestido_id else None,
        "contractId": n.contrato_id,
    }


class NotificacionesView(APIView):
    """
    GET /api/core/notificaciones/?solo_nuevas=1
    Notificaciones del usuario que inició sesión (las 60 más recientes).
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="notificaciones", tags=["notificaciones"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        cerrar_jornadas_vencidas()
        if getattr(request.user, "rol", None) in ("jefa_taller", "gerencia") or request.user.is_superuser:
            sincronizar_avisos_taller()
        qs = Notificacion.objects.filter(usuario=request.user)
        if request.query_params.get("solo_nuevas"):
            qs = qs.filter(leida=False)
        return Response({
            "unread": Notificacion.objects.filter(usuario=request.user, leida=False).count(),
            "items": [serializar(n) for n in qs[:60]],
        })


class LeerNotificacionView(APIView):
    """POST /api/core/notificaciones/<id>/leer/"""

    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="notificacion_leer", tags=["notificaciones"], request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        n = get_object_or_404(Notificacion, pk=pk, usuario=request.user)
        n.leida = True
        n.save(update_fields=["leida"])
        return Response(serializar(n))


class LeerTodasView(APIView):
    """POST /api/core/notificaciones/leer-todas/"""

    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="notificaciones_leer_todas", tags=["notificaciones"], request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        total = Notificacion.objects.filter(usuario=request.user, leida=False).update(leida=True)
        return Response({"updated": total})
