
from datetime import timedelta
from decimal import Decimal

from django.db.models import Prefetch
from django.utils import timezone
from django.utils.dateparse import parse_date

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, OpenApiParameter

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    AusenciaTrabajadora,
    ReservaOperacion,
    TipoVestido,
    Trabajadora,
)


CERO = Decimal("0.00")
MAX_DIAS_CAPACIDAD = 90


# ============================================================
# UTILIDADES DE CAPACIDAD
# ============================================================

def decimal_value(value):
    """Convierte un valor numérico a Decimal de forma segura."""
    if value is None:
        return CERO

    return Decimal(str(value))


def obtener_horas_ausencia(
    trabajadora_id,
    fecha,
    ausencias_por_persona_fecha,
    capacidad_programada,
):
    """
    Devuelve las horas no disponibles por ausencia.

    Si existen ausencias superpuestas, no descuenta más horas
    que las programadas para la trabajadora ese día.
    """
    horas_ausencia = ausencias_por_persona_fecha.get(
        (trabajadora_id, fecha),
        CERO,
    )

    return min(
        capacidad_programada,
        max(CERO, horas_ausencia),
    )


def obtener_horas_comprometidas(reserva):
    """
    Calcula las horas comprometidas de una reserva.

    RESERVADA / EN_PROCESO:
        horas_reservadas - horas_realizadas

    COMPLETADA:
        horas_realizadas

    CANCELADA:
        cero; normalmente se excluye antes de llamar a esta función.
    """
    estado = reserva["estado"]
    reservadas = decimal_value(reserva["horas_reservadas"])
    realizadas = decimal_value(reserva["horas_realizadas"])

    if estado == ReservaOperacion.Estado.COMPLETADA:
        return max(CERO, realizadas)

    if estado == ReservaOperacion.Estado.CANCELADA:
        return CERO

    return max(CERO, reservadas - realizadas)


# ============================================================
# 1. CATÁLOGO DEL SIMULADOR
# ============================================================

class CatalogoSimuladorView(APIView):
    """
    Devuelve vestidos activos, rutas, operaciones y trabajadoras.

    GET /api/core/catalogo/
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        vestidos = (
            TipoVestido.objects.filter(activo=True)
            .order_by("nombre", "id")
            .prefetch_related(
                Prefetch(
                    "rutas",
                    queryset=(
                        TipoVestido.rutas.rel.related_model.objects
                        .filter(activa=True)
                        .order_by("taller", "id")
                        .prefetch_related(
                            "operaciones__operacion",
                            "operaciones__depende_de__operacion",
                        )
                    ),
                )
            )
        )

        catalogo = []

        for vestido in vestidos:
            rutas = vestido.rutas.filter(
                activa=True,
            ).order_by("taller", "id")

            rutas_data = []

            for ruta in rutas:
                operaciones = (
                    ruta.operaciones.filter(
                        activa=True,
                        operacion__activa=True,
                    )
                    .select_related("operacion")
                    .prefetch_related("depende_de__operacion")
                    .order_by("orden", "id")
                )

                operaciones_data = []

                for plantilla in operaciones:
                    dependencias = list(
                        plantilla.depende_de.filter(
                            activa=True,
                            operacion__activa=True,
                        ).order_by("orden", "id")
                    )

                    operaciones_data.append({
                        # ID de PlantillaOperacion:
                        # se utiliza para resolver dependencias.
                        "id": plantilla.id,

                        # ID global de Operacion:
                        # se utiliza para comprobar habilidades.
                        "operacion_id": plantilla.operacion_id,

                        "nombre": plantilla.operacion.nombre,
                        "area": plantilla.operacion.area_responsable,
                        "orden": plantilla.orden,
                        "tipo_tiempo": plantilla.tipo_tiempo,
                        "horas_estimadas": str(
                            plantilla.horas_estimadas
                        ),
                        "obligatoria": plantilla.obligatoria,
                        "dependencias": [
                            dependencia.id
                            for dependencia in dependencias
                        ],
                        "dependencias_nombres": [
                            dependencia.operacion.nombre
                            for dependencia in dependencias
                        ],
                    })

                rutas_data.append({
                    "id": ruta.id,
                    "taller": ruta.taller,
                    "descripcion": ruta.descripcion,
                    "operaciones": operaciones_data,
                })

            catalogo.append({
                "id": vestido.id,
                "nombre": vestido.nombre,
                "descripcion": vestido.descripcion,
                "rutas": rutas_data,
            })

        trabajadoras = (
            Trabajadora.objects.filter(activa=True)
            .prefetch_related(
                "horarios",
                "habilidades",
            )
            .order_by("nombre", "id")
        )

        trabajadoras_data = []

        for trabajadora in trabajadoras:
            habilidades = (
                trabajadora.habilidades.filter(activa=True)
                .order_by("id")
                .values_list("id", flat=True)
            )

            horarios = trabajadora.horarios.all().order_by(
                "dia_semana"
            )

            trabajadoras_data.append({
                "id": trabajadora.id,
                "nombre": trabajadora.nombre,
                "area": trabajadora.area,
                "habilidades": list(habilidades),
                "horarios": [
                    {
                        "dia_semana": horario.dia_semana,
                        "horas_disponibles": str(
                            horario.horas_disponibles
                        ),
                    }
                    for horario in horarios
                ],
            })

        return Response({
            "vestidos": catalogo,
            "trabajadoras": trabajadoras_data,
        })


# ============================================================
# 2. CAPACIDAD DIARIA DE PRODUCCIÓN
# ============================================================

class CapacidadProduccionView(APIView):
    """
    Consulta la capacidad diaria de las trabajadoras.

    GET /api/core/capacidad/?desde=AAAA-MM-DD&hasta=AAAA-MM-DD

    La capacidad restante se calcula usando:
        horario semanal
        - ausencias aplicables
        - horas comprometidas pendientes

    Las reservas canceladas no consumen capacidad.
    Las reservas completadas contabilizan las horas realizadas.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="desde",
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Fecha inicial. Formato AAAA-MM-DD.",
            ),
            OpenApiParameter(
                name="hasta",
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
                required=False,
                description="Fecha final. Formato AAAA-MM-DD.",
            ),
        ],
        description=(
            "Consulta la capacidad diaria del personal entre las "
            "fechas indicadas. Si no se especifican, se utiliza "
            "hoy como inicio y se consultan 14 días. Máximo: 90 días."
        ),
    )
    def get(self, request):
        hoy = timezone.localdate()

        desde_texto = request.query_params.get("desde")
        hasta_texto = request.query_params.get("hasta")

        fecha_desde = (
            parse_date(desde_texto)
            if desde_texto
            else hoy
        )

        if fecha_desde is None:
            return Response(
                {
                    "error": (
                        "La fecha 'desde' debe tener el formato "
                        "AAAA-MM-DD."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        fecha_hasta = (
            parse_date(hasta_texto)
            if hasta_texto
            else fecha_desde + timedelta(days=13)
        )

        if fecha_hasta is None:
            return Response(
                {
                    "error": (
                        "La fecha 'hasta' debe tener el formato "
                        "AAAA-MM-DD."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if fecha_hasta < fecha_desde:
            return Response(
                {
                    "error": (
                        "La fecha 'hasta' no puede ser anterior "
                        "a la fecha 'desde'."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        cantidad_dias = (fecha_hasta - fecha_desde).days + 1

        if cantidad_dias > MAX_DIAS_CAPACIDAD:
            return Response(
                {
                    "error": (
                        f"Consulta un máximo de {MAX_DIAS_CAPACIDAD} "
                        "días por solicitud."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        trabajadoras = list(
            Trabajadora.objects.filter(activa=True)
            .prefetch_related("horarios")
            .order_by("nombre", "id")
        )

        # ----------------------------------------------------
        # Horarios semanales por trabajadora
        # ----------------------------------------------------

        horarios_por_persona = {
            trabajadora.id: {
                horario.dia_semana: decimal_value(
                    horario.horas_disponibles
                )
                for horario in trabajadora.horarios.all()
            }
            for trabajadora in trabajadoras
        }

        # ----------------------------------------------------
        # Ausencias por trabajadora y fecha
        # ----------------------------------------------------

        ausencias = list(
            AusenciaTrabajadora.objects.filter(
                trabajadora__in=trabajadoras,
                fecha_inicio__lte=fecha_hasta,
                fecha_fin__gte=fecha_desde,
            ).order_by("id")
        )

        ausencias_por_persona_fecha = {}

        fecha = fecha_desde

        while fecha <= fecha_hasta:
            for ausencia in ausencias:
                if (
                    ausencia.fecha_inicio
                    <= fecha
                    <= ausencia.fecha_fin
                ):
                    clave = (ausencia.trabajadora_id, fecha)

                    ausencias_por_persona_fecha[clave] = (
                        ausencias_por_persona_fecha.get(
                            clave,
                            CERO,
                        )
                        + decimal_value(
                            ausencia.horas_no_disponibles
                        )
                    )

            fecha += timedelta(days=1)

        # ----------------------------------------------------
        # Reservas por trabajadora y fecha
        # ----------------------------------------------------

        reservas = (
            ReservaOperacion.objects.filter(
                trabajadora__in=trabajadoras,
                fecha__range=(fecha_desde, fecha_hasta),
            )
            .exclude(
                estado=ReservaOperacion.Estado.CANCELADA
            )
            .values(
                "trabajadora_id",
                "fecha",
                "estado",
                "horas_reservadas",
                "horas_realizadas",
            )
        )

        reservas_por_persona_fecha = {}

        for reserva in reservas:
            clave = (
                reserva["trabajadora_id"],
                reserva["fecha"],
            )

            horas_comprometidas = obtener_horas_comprometidas(
                reserva
            )

            reservas_por_persona_fecha[clave] = (
                reservas_por_persona_fecha.get(clave, CERO)
                + horas_comprometidas
            )

        # ----------------------------------------------------
        # Construcción de la respuesta diaria
        # ----------------------------------------------------

        resultado = []
        fecha = fecha_desde

        while fecha <= fecha_hasta:
            personal_del_dia = []

            for trabajadora in trabajadoras:
                capacidad_semanal = horarios_por_persona[
                    trabajadora.id
                ].get(fecha.weekday(), CERO)

                ausencia = obtener_horas_ausencia(
                    trabajadora.id,
                    fecha,
                    ausencias_por_persona_fecha,
                    capacidad_semanal,
                )

                capacidad_neta = max(
                    CERO,
                    capacidad_semanal - ausencia,
                )

                horas_reservadas = (
                    reservas_por_persona_fecha.get(
                        (trabajadora.id, fecha),
                        CERO,
                    )
                )

                horas_restantes = max(
                    CERO,
                    capacidad_neta - horas_reservadas,
                )

                personal_del_dia.append({
                    "trabajadora_id": trabajadora.id,
                    "nombre": trabajadora.nombre,
                    "area": trabajadora.area,
                    "horas_semanales_disponibles": str(
                        capacidad_semanal
                    ),
                    "horas_no_disponibles": str(ausencia),
                    "horas_reservadas": str(horas_reservadas),
                    "horas_restantes": str(horas_restantes),
                })

            resultado.append({
                "fecha": fecha.isoformat(),
                "dia_semana": fecha.weekday(),
                "trabajadoras": personal_del_dia,
            })

            fecha += timedelta(days=1)

        return Response({
            "desde": fecha_desde.isoformat(),
            "hasta": fecha_hasta.isoformat(),
            "dias": resultado,
        })
