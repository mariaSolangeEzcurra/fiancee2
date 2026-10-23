
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Trabajadora,
    Operacion,
    DisponibilidadSemanal,
    AusenciaTrabajadora,
    ReservaOperacion,
)

from .serializers import (
    TrabajadoraSerializer,
    OperacionSerializer,
    DisponibilidadSerializer,
    AusenciaSerializer,
    ReservaPersonalSerializer,
    HorarioSemanalEntradaSerializer,
)


class EsGerencia(BasePermission):
    """
    Acceso exclusivo para superusuarios o miembros
    del grupo Gerencia de Django.
    """

    message = "No tienes permisos de Gerencia."

    def has_permission(self, request, view):
        usuario = request.user

        return bool(
            usuario
            and usuario.is_authenticated
            and (
                usuario.is_superuser
                or usuario.groups.filter(
                    name="Gerencia"
                ).exists()
            )
        )


class TrabajadoraViewSet(viewsets.ModelViewSet):
    """
    CRUD de personal:
    GET, POST, PATCH, PUT y DELETE.

    DELETE está deshabilitado para conservar
    el historial del taller.
    """

    serializer_class = TrabajadoraSerializer
    permission_classes = [IsAuthenticated, EsGerencia]

    queryset = Trabajadora.objects.prefetch_related(
        "habilidades",
        "horarios",
    ).all().order_by("nombre", "id")

    def get_queryset(self):
        queryset = super().get_queryset()

        nombre = self.request.query_params.get("buscar")
        area = self.request.query_params.get("area")
        activa = self.request.query_params.get("activa")

        if nombre:
            queryset = queryset.filter(
                nombre__icontains=nombre.strip()
            )

        if area:
            queryset = queryset.filter(area=area)

        if activa is not None:
            if activa.lower() == "true":
                queryset = queryset.filter(activa=True)
            elif activa.lower() == "false":
                queryset = queryset.filter(activa=False)

        return queryset

    def perform_create(self, serializer):
        """
        Al registrar personal, crea sus siete días
        de disponibilidad con cero horas.
        Gerencia podrá configurarlos después.
        """
        with transaction.atomic():
            trabajadora = serializer.save()

            DisponibilidadSemanal.objects.bulk_create([
                DisponibilidadSemanal(
                    trabajadora=trabajadora,
                    dia_semana=dia,
                    horas_disponibles=Decimal("0"),
                )
                for dia in range(7)
            ])

    def destroy(self, request, *args, **kwargs):
        return Response(
            {
                "detalle": (
                    "No se permite eliminar personal. "
                    "Cambia su estado a inactivo."
                )
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=False, methods=["get"])
    def opciones(self, request):
        """
        Opciones para los selectores del frontend.
        """
        operaciones = Operacion.objects.filter(
            activa=True
        ).order_by("area_responsable", "nombre")

        return Response({
            "areas": [
                {"valor": valor, "nombre": nombre}
                for valor, nombre in Trabajadora.Area.choices
            ],
            "dias": [
                {"valor": valor, "nombre": nombre}
                for valor, nombre in DisponibilidadSemanal.DIAS
            ],
            "operaciones": OperacionSerializer(
                operaciones,
                many=True,
            ).data,
        })

    @action(
        detail=True,
        methods=["get", "put"],
        url_path="horarios",
    )
    def horarios(self, request, pk=None):
        trabajadora = self.get_object()

        if request.method == "GET":
            horarios = trabajadora.horarios.all()

            return Response({
                "trabajadora": trabajadora.id,
                "nombre": trabajadora.nombre,
                "horarios": DisponibilidadSerializer(
                    horarios,
                    many=True,
                ).data,
            })

        serializer = HorarioSemanalEntradaSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            for item in serializer.validated_data["horarios"]:
                DisponibilidadSemanal.objects.update_or_create(
                    trabajadora=trabajadora,
                    dia_semana=item["dia_semana"],
                    defaults={
                        "horas_disponibles":
                            item["horas_disponibles"]
                    },
                )

        horarios = trabajadora.horarios.all()

        return Response({
            "mensaje": "Horario actualizado correctamente.",
            "horarios": DisponibilidadSerializer(
                horarios,
                many=True,
            ).data,
        })

    @action(
        detail=True,
        methods=["get"],
        url_path="ausencias",
    )
    def ausencias(self, request, pk=None):
        trabajadora = self.get_object()

        ausencias = trabajadora.ausencias.all().order_by(
            "-fecha_inicio", "-id"
        )

        return Response(
            AusenciaSerializer(ausencias, many=True).data
        )

    @action(
        detail=True,
        methods=["get"],
        url_path="reservas",
    )
    def reservas(self, request, pk=None):
        trabajadora = self.get_object()

        reservas = ReservaOperacion.objects.filter(
            trabajadora=trabajadora
        ).select_related(
            "contrato",
            "plantilla__operacion",
        ).order_by("fecha", "id")

        return Response(
            ReservaPersonalSerializer(
                reservas,
                many=True,
            ).data
        )

    @action(
        detail=True,
        methods=["get"],
        url_path="capacidad",
    )
    def capacidad(self, request, pk=None):
        """
        Resumen de una semana.

        Parámetro opcional:
        ?fecha=2026-10-26

        La semana se calcula de lunes a domingo.

        horas_no_disponibles se interpreta como
        descuento diario en cada fecha de ausencia.

        Las reservas COMPLETADAS se cuentan por sus
        horas reservadas para mostrar ocupación
        planificada, no solamente trabajo pendiente.
        """
        trabajadora = self.get_object()

        fecha_texto = request.query_params.get("fecha")

        if fecha_texto:
            try:
                from datetime import date
                fecha = date.fromisoformat(fecha_texto)
            except ValueError:
                return Response(
                    {"fecha": "Usa el formato AAAA-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            fecha = timezone.localdate()

        lunes = fecha - timedelta(days=fecha.weekday())
        domingo = lunes + timedelta(days=6)

        horarios = {
            horario.dia_semana: horario.horas_disponibles
            for horario in trabajadora.horarios.all()
        }

        ausencias = AusenciaTrabajadora.objects.filter(
            trabajadora=trabajadora,
            fecha_inicio__lte=domingo,
            fecha_fin__gte=lunes,
        )

        reservas = ReservaOperacion.objects.filter(
            trabajadora=trabajadora,
            fecha__range=(lunes, domingo),
        ).exclude(
            estado=ReservaOperacion.Estado.CANCELADA
        )

        reservas_por_fecha = {}

        for reserva in reservas:
            reservas_por_fecha.setdefault(
                reserva.fecha, Decimal("0")
            )
            reservas_por_fecha[reserva.fecha] += (
                reserva.horas_reservadas
            )

        detalle = []
        total_capacidad = Decimal("0")
        total_reservado = Decimal("0")
        total_libre = Decimal("0")

        for numero_dia in range(7):
            dia = lunes + timedelta(days=numero_dia)

            horas_base = (
                horarios.get(numero_dia, Decimal("0"))
                if trabajadora.activa
                else Decimal("0")
            )

            descuento = sum(
                (
                    ausencia.horas_no_disponibles
                    for ausencia in ausencias
                    if ausencia.fecha_inicio <= dia
                    <= ausencia.fecha_fin
                ),
                Decimal("0"),
            )

            capacidad = max(
                Decimal("0"),
                horas_base - descuento,
            )

            reservado = reservas_por_fecha.get(
                dia, Decimal("0")
            )

            libre = max(
                Decimal("0"),
                capacidad - reservado,
            )

            total_capacidad += capacidad
            total_reservado += reservado
            total_libre += libre

            detalle.append({
                "fecha": dia.isoformat(),
                "dia_semana": numero_dia,
                "horas_base": horas_base,
                "horas_ausencia": descuento,
                "horas_disponibles": capacidad,
                "horas_reservadas": reservado,
                "horas_libres": libre,
                "sobrecarga": max(
                    Decimal("0"),
                    reservado - capacidad,
                ),
            })

        ocupacion = (
            (total_reservado / total_capacidad * 100)
            if total_capacidad > 0
            else Decimal("0")
        )

        return Response({
            "trabajadora": trabajadora.id,
            "nombre": trabajadora.nombre,
            "activa": trabajadora.activa,
            "semana_inicio": lunes.isoformat(),
            "semana_fin": domingo.isoformat(),
            "horas_disponibles": total_capacidad,
            "horas_reservadas": total_reservado,
            "horas_libres": total_libre,
            "ocupacion_porcentaje": round(ocupacion, 2),
            "detalle": detalle,
        })


class AusenciaViewSet(viewsets.ModelViewSet):
    """
    Registrar, consultar, editar y eliminar ausencias.
    """

    serializer_class = AusenciaSerializer
    permission_classes = [IsAuthenticated, EsGerencia]

    queryset = AusenciaTrabajadora.objects.select_related(
        "trabajadora"
    ).all().order_by("-fecha_inicio", "-id")

    def get_queryset(self):
        queryset = super().get_queryset()

        trabajadora = self.request.query_params.get(
            "trabajadora"
        )

        if trabajadora:
            queryset = queryset.filter(
                trabajadora_id=trabajadora
            )

        return queryset


class OperacionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Consulta de operaciones para los selectores
    de habilidades del personal.
    """

    serializer_class = OperacionSerializer
    permission_classes = [IsAuthenticated, EsGerencia]

    queryset = Operacion.objects.all().order_by(
        "area_responsable", "nombre"
    )

    def get_queryset(self):
        queryset = super().get_queryset()

        area = self.request.query_params.get("area")
        activa = self.request.query_params.get("activa")

        if area:
            queryset = queryset.filter(
                area_responsable=area
            )

        if activa is not None:
            if activa.lower() == "true":
                queryset = queryset.filter(activa=True)
            elif activa.lower() == "false":
                queryset = queryset.filter(activa=False)

        return queryset
