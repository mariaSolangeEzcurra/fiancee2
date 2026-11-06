from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import RutaProduccion
from core.services.simulador import simular


class PermisoSimulador(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser or getattr(request.user, "rol", None) in (
            "comercial", "gerencia", "jefa_taller",
        )


class ProcesoSimSerializer(serializers.Serializer):
    plantilla = serializers.IntegerField()
    horas = serializers.DecimalField(max_digits=9, decimal_places=2, min_value=Decimal("0"))
    incluido = serializers.BooleanField(default=True)


class ItemSimSerializer(serializers.Serializer):
    tipo_vestido = serializers.IntegerField()
    taller = serializers.ChoiceField(choices=RutaProduccion.Tipo.choices)
    cantidad = serializers.IntegerField(min_value=1, max_value=20, default=1)
    procesos = ProcesoSimSerializer(many=True, required=False)


class SimulacionSerializer(serializers.Serializer):
    fecha_entrega = serializers.DateField()
    fecha_evento = serializers.DateField(required=False, allow_null=True)
    vestidos = ItemSimSerializer(many=True)


class SimuladorView(APIView):
    """
    POST /api/core/simulador/

    Evalúa si un nuevo pedido se puede producir a tiempo con la carga y
    el personal reales. No guarda nada.
    """

    permission_classes = [PermisoSimulador]

    @extend_schema(operation_id="simular_contrato", tags=["simulador"], request=SimulacionSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request):
        entrada = SimulacionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            resultado = simular(
                [dict(v) for v in datos["vestidos"]],
                datos["fecha_entrega"],
                datos.get("fecha_evento"),
            )
        except DjangoValidationError as exc:
            return Response({"detail": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(resultado)
