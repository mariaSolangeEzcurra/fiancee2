from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Cliente, Contrato, ReservaOperacion, SimulacionContrato
from core.services.contratos import (
    aceptar_simulacion,
    actualizar_contrato,
    crear_contrato,
)

from .serializers import (
    AceptarSimulacionSerializer,
    ClienteSerializer,
    ContratoEntradaSerializer,
    ContratoListaSerializer,
    ContratoSerializer,
)

ROLES_EDICION = ("comercial",)
ROLES_LECTURA = ROLES_EDICION + ("gerencia", "jefa_taller")


class PermisoContratos(IsAuthenticated):
    """
    Lectura: comercial, gerencia y jefa de taller.
    Creación y edición: solo comercial (gerencia solo consulta).
    """

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        rol = getattr(request.user, "rol", None)
        if request.method in SAFE_METHODS:
            return rol in ROLES_LECTURA
        return rol in ROLES_EDICION


def error_servicio(exc):
    if hasattr(exc, "message_dict"):
        return Response(exc.message_dict, status=status.HTTP_400_BAD_REQUEST)
    return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)


def contratos_queryset():
    return Contrato.objects.select_related(
        "cliente", "asesora", "simulacion"
    ).prefetch_related(
        "vestidos__tipo_vestido",
        "vestidos__ruta__operaciones__operacion",
        "vestidos__procesos",
        "pagos__vestido",
        "cargos_adicionales__vestido",
    )


def respuesta_contrato(contrato, resultado, mensaje, codigo=status.HTTP_200_OK):
    contrato = contratos_queryset().get(pk=contrato.pk)
    return Response(
        {
            "mensaje": mensaje,
            "cliente_creado": resultado.get("cliente_creado", False),
            "contrato": ContratoSerializer(contrato).data,
            "planificacion": resultado.get("planificacion", []),
        },
        status=codigo,
    )


def _datos_servicio(validated):
    datos = dict(validated)
    if datos.get("datos_cliente") is None:
        datos.pop("datos_cliente", None)
    return datos


# ============================================================
# LISTA Y CREACIÓN
# ============================================================

class ContratoListCreateView(APIView):
    """
    GET  /api/core/contratos/   Lista (filtros: q, estado, origen, desde, hasta)
    POST /api/core/contratos/   Crea un contrato manual
    """

    permission_classes = [PermisoContratos]

    @extend_schema(
        operation_id="listar_contratos",
        tags=["contratos"],
        parameters=[
            OpenApiParameter("q", OpenApiTypes.STR, description="Número, nombre o DNI de la clienta."),
            OpenApiParameter("estado", OpenApiTypes.STR),
            OpenApiParameter("origen", OpenApiTypes.STR, description="MANUAL o SIMULADOR"),
            OpenApiParameter("desde", OpenApiTypes.DATE, description="Fecha de evento desde."),
            OpenApiParameter("hasta", OpenApiTypes.DATE, description="Fecha de evento hasta."),
        ],
        responses={200: ContratoListaSerializer(many=True)},
    )
    def get(self, request):
        contratos = Contrato.objects.select_related("cliente").prefetch_related(
            "vestidos__tipo_vestido", "vestidos__ruta"
        )
        params = request.query_params

        if q := params.get("q", "").strip():
            contratos = contratos.filter(
                Q(numero__icontains=q)
                | Q(cliente__nombre__icontains=q)
                | Q(cliente__documento__icontains=q)
            )
        if estado := params.get("estado"):
            contratos = contratos.filter(estado=estado)
        if (origen := params.get("origen", "").upper()) in ("MANUAL", "SIMULADOR"):
            contratos = contratos.filter(simulacion__isnull=(origen == "MANUAL"))
        if desde := parse_date(params.get("desde") or ""):
            contratos = contratos.filter(fecha_evento__gte=desde)
        if hasta := parse_date(params.get("hasta") or ""):
            contratos = contratos.filter(fecha_evento__lte=hasta)

        data = ContratoListaSerializer(contratos, many=True).data
        return Response({"total": len(data), "contratos": data})

    @extend_schema(
        operation_id="crear_contrato",
        tags=["contratos"],
        request=ContratoEntradaSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    def post(self, request):
        serializer = ContratoEntradaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = _datos_servicio(serializer.validated_data)
        datos.pop("replanificar", None)

        try:
            contrato, resultado = crear_contrato(usuario=request.user, **datos)
        except DjangoValidationError as exc:
            return error_servicio(exc)

        return respuesta_contrato(
            contrato, resultado, "Contrato creado correctamente.", status.HTTP_201_CREATED
        )


class PrevisualizarContratoView(APIView):
    """
    POST /api/core/contratos/previsualizar/

    Mismo cuerpo que crear. Calcula la planificación del taller
    (fechas, trabajadoras, horas) sin guardar nada.
    """

    permission_classes = [PermisoContratos]

    @extend_schema(
        operation_id="previsualizar_contrato",
        tags=["contratos"],
        request=ContratoEntradaSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request):
        serializer = ContratoEntradaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = _datos_servicio(serializer.validated_data)
        datos.pop("replanificar", None)

        try:
            with transaction.atomic():
                contrato, resultado = crear_contrato(usuario=request.user, **datos)
                data = ContratoSerializer(contratos_queryset().get(pk=contrato.pk)).data
                transaction.set_rollback(True)
        except DjangoValidationError as exc:
            return error_servicio(exc)

        data["id"] = None
        return Response({
            "mensaje": "Vista previa: no se guardó ningún dato.",
            "cliente_nuevo": resultado["cliente_creado"],
            "contrato": data,
            "planificacion": resultado["planificacion"],
        })


# ============================================================
# DETALLE Y EDICIÓN
# ============================================================

class ContratoDetailView(APIView):
    """
    GET   /api/core/contratos/<id>/
    PATCH /api/core/contratos/<id>/   Edición parcial
    PUT   /api/core/contratos/<id>/   Edición completa
    """

    permission_classes = [PermisoContratos]

    @extend_schema(operation_id="detalle_contrato", tags=["contratos"], responses={200: ContratoSerializer})
    def get(self, request, pk):
        contrato = get_object_or_404(contratos_queryset(), pk=pk)
        return Response(ContratoSerializer(contrato).data)

    def _editar(self, request, pk, partial):
        contrato = get_object_or_404(Contrato, pk=pk)
        serializer = ContratoEntradaSerializer(contrato, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        datos = _datos_servicio(serializer.validated_data)

        try:
            contrato, resultado = actualizar_contrato(contrato, usuario=request.user, **datos)
        except DjangoValidationError as exc:
            return error_servicio(exc)

        return respuesta_contrato(contrato, resultado, "Contrato actualizado correctamente.")

    @extend_schema(
        operation_id="editar_contrato_parcial", tags=["contratos"],
        request=ContratoEntradaSerializer, responses={200: OpenApiTypes.OBJECT},
    )
    def patch(self, request, pk):
        return self._editar(request, pk, partial=True)

    @extend_schema(
        operation_id="editar_contrato", tags=["contratos"],
        request=ContratoEntradaSerializer, responses={200: OpenApiTypes.OBJECT},
    )
    def put(self, request, pk):
        return self._editar(request, pk, partial=False)


class PlanificacionContratoView(APIView):
    """
    GET  /api/core/contratos/<id>/planificacion/  Reservas del taller por vestido
    POST /api/core/contratos/<id>/planificacion/  Replanifica los vestidos sin avance
    """

    permission_classes = [PermisoContratos]

    @extend_schema(operation_id="planificacion_contrato", tags=["contratos"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request, pk):
        contrato = get_object_or_404(contratos_queryset(), pk=pk)
        reservas = (
            ReservaOperacion.objects.filter(contrato=contrato)
            .exclude(estado=ReservaOperacion.Estado.CANCELADA)
            .select_related("trabajadora", "plantilla__operacion")
            .order_by("fecha", "plantilla__orden", "id")
        )

        por_vestido = {}
        for reserva in reservas:
            por_vestido.setdefault(reserva.vestido_id, []).append({
                "id": reserva.id,
                "fecha": reserva.fecha,
                "operacion": reserva.plantilla.operacion.nombre,
                "orden": reserva.plantilla.orden,
                "trabajadora_id": reserva.trabajadora_id,
                "trabajadora": reserva.trabajadora.nombre,
                "horas_reservadas": reserva.horas_reservadas,
                "horas_realizadas": reserva.horas_realizadas,
                "estado": reserva.estado,
            })

        vestidos = []
        for vestido in contrato.vestidos.all():
            items = por_vestido.get(vestido.id, [])
            vestidos.append({
                "vestido_id": vestido.id,
                "codigo": vestido.codigo,
                "tipo_vestido": vestido.tipo_vestido.nombre if vestido.tipo_vestido_id else None,
                "taller": vestido.taller,
                "estado": vestido.estado,
                "fecha_fin_estimada": vestido.fecha_fin_estimada,
                "a_tiempo": (
                    vestido.fecha_fin_estimada <= contrato.fecha_entrega
                    and vestido.horas_sin_asignar == 0
                ) if vestido.fecha_fin_estimada else None,
                "horas_sin_asignar": vestido.horas_sin_asignar,
                "horas_reservadas": sum((r["horas_reservadas"] for r in items), 0),
                "reservas": items,
            })

        return Response({
            "contrato_id": contrato.id,
            "numero": contrato.numero,
            "fecha_entrega": contrato.fecha_entrega,
            "vestidos": vestidos,
        })

    @extend_schema(operation_id="replanificar_contrato", tags=["contratos"], request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        contrato = get_object_or_404(Contrato, pk=pk)
        try:
            contrato, resultado = actualizar_contrato(contrato, usuario=request.user, replanificar=True)
        except DjangoValidationError as exc:
            return error_servicio(exc)
        return respuesta_contrato(contrato, resultado, "Planificación del taller actualizada.")


# ============================================================
# DESDE EL SIMULADOR
# ============================================================

class AceptarSimulacionView(APIView):
    """POST /api/core/contratos/aceptar-simulacion/"""

    permission_classes = [PermisoContratos]

    @extend_schema(
        operation_id="aceptar_simulacion", tags=["contratos"],
        request=AceptarSimulacionSerializer, responses={201: OpenApiTypes.OBJECT},
    )
    def post(self, request):
        serializer = AceptarSimulacionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = dict(serializer.validated_data)
        get_object_or_404(SimulacionContrato, pk=datos["simulacion_id"])

        try:
            contrato, resultado = aceptar_simulacion(usuario=request.user, **datos)
        except DjangoValidationError as exc:
            return error_servicio(exc)

        return respuesta_contrato(
            contrato, resultado,
            "Simulación aceptada y contrato generado correctamente.",
            status.HTTP_201_CREATED,
        )


# ============================================================
# CLIENTAS (para autocompletar en el formulario)
# ============================================================

class ClientesView(APIView):
    """GET /api/core/contratos/clientes/?q=texto  (nombre, DNI o celular)"""

    permission_classes = [PermisoContratos]

    @extend_schema(
        operation_id="buscar_clientes", tags=["contratos"],
        parameters=[OpenApiParameter("q", OpenApiTypes.STR)],
        responses={200: ClienteSerializer(many=True)},
    )
    def get(self, request):
        clientes = Cliente.objects.filter(activo=True)
        if q := request.query_params.get("q", "").strip():
            clientes = clientes.filter(
                Q(nombre__icontains=q) | Q(documento__icontains=q) | Q(telefono__icontains=q)
            )
        return Response(ClienteSerializer(clientes.order_by("nombre")[:20], many=True).data)
