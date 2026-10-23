
from decimal import Decimal
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from core.models import (
    Trabajadora,
    ReservaOperacion,
    RegistroAsistencia,
    SesionTrabajo,
)


class EsPersonalTaller(IsAuthenticated):
    """
    Solo permite acceder a usuarios con rol taller
    que tengan un perfil de trabajadora asociado.
    """

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False

        if getattr(request.user, "rol", None) != "taller":
            return False

        return getattr(request.user, "perfil_trabajadora", None) is not None


def obtener_trabajadora(request):
    return getattr(request.user, "perfil_trabajadora", None)


def horas_decimal(inicio, fin=None):
    fin = fin or timezone.now()
    segundos = max(0, (fin - inicio).total_seconds())
    return Decimal(str(segundos / 3600)).quantize(
        Decimal("0.01")
    )


def serializar_asistencia(asistencia):
    if not asistencia:
        return None

    return {
        "id": asistencia.id,
        "fecha": asistencia.fecha,
        "entrada": asistencia.entrada,
        "salida": asistencia.salida,
        "jornada_activa": asistencia.salida is None,
        "horas_trabajadas": (
            horas_decimal(asistencia.entrada, asistencia.salida)
            if asistencia.salida
            else horas_decimal(asistencia.entrada)
        ),
        "observaciones_entrada": asistencia.observaciones_entrada,
        "observaciones_salida": asistencia.observaciones_salida,
    }


def dependencias_completadas(reserva):
    """
    Verifica que las operaciones anteriores de la ruta
    estén completadas para el mismo vestido/contrato.
    """
    dependencias = reserva.plantilla.depende_de.all()

    for plantilla_anterior in dependencias:
        completada = ReservaOperacion.objects.filter(
            contrato=reserva.contrato,
            plantilla=plantilla_anterior,
            estado=ReservaOperacion.Estado.COMPLETADA,
        ).exists()

        if not completada:
            return False

    return True


def serializar_reserva(reserva):
    contrato = reserva.contrato
    simulacion = contrato.simulacion
    cliente = simulacion.cliente
    plantilla = reserva.plantilla
    operacion = plantilla.operacion

    return {
        "id": reserva.id,
        "fecha": reserva.fecha,
        "estado": reserva.estado,
        "horas_reservadas": reserva.horas_reservadas,
        "horas_realizadas": reserva.horas_realizadas,
        "horas_pendientes": reserva.horas_pendientes,
        "vestido": {
            "contrato_id": contrato.id,
            "numero": contrato.numero,
            "cliente": str(cliente),
            "tipo": str(simulacion.tipo_vestido),
        },
        "proceso": {
            "plantilla_id": plantilla.id,
            "operacion_id": operacion.id,
            "nombre": operacion.nombre,
            "area": operacion.area_responsable,
        },
        "puede_iniciar": (
            reserva.estado
            in [
                ReservaOperacion.Estado.RESERVADA,
                ReservaOperacion.Estado.EN_PROCESO,
            ]
            and dependencias_completadas(reserva)
        ),
    }


class MiPanelTallerView(APIView):
    permission_classes = [EsPersonalTaller]

    @extend_schema(
        operation_id="taller_mi_panel",
        responses={200: OpenApiTypes.OBJECT},
    )

    def get(self, request):
        trabajadora = obtener_trabajadora(request)
        hoy = timezone.localdate()

        asistencia = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora,
            fecha=hoy,
        ).first()

        sesion_activa = SesionTrabajo.objects.filter(
            reserva__trabajadora=trabajadora,
            fin__isnull=True,
        ).first()

        return Response({
            "trabajadora": {
                "id": trabajadora.id,
                "nombre": trabajadora.nombre,
                "area": trabajadora.area,
            },
            "fecha": hoy,
            "asistencia": serializar_asistencia(asistencia),
            "sesion_activa": (
                {
                    "id": sesion_activa.id,
                    "reserva_id": sesion_activa.reserva_id,
                    "inicio": sesion_activa.inicio,
                    "observaciones": sesion_activa.observaciones_inicio,
                }
                if sesion_activa
                else None
            ),
        })


class IniciarJornadaView(APIView):
    permission_classes = [EsPersonalTaller]

    @extend_schema(
        operation_id="taller_iniciar_jornada",
        request=OpenApiTypes.OBJECT,
        responses={
            201: OpenApiTypes.OBJECT,
            400: OpenApiTypes.OBJECT,
        },
    )

    @transaction.atomic
    def post(self, request):
        trabajadora = obtener_trabajadora(request)
        hoy = timezone.localdate()

        asistencia = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora,
            fecha=hoy,
        ).first()

        if asistencia:
            if asistencia.salida is None:
                return Response(
                    {
                        "detail": "Tu jornada ya está iniciada.",
                        "asistencia": serializar_asistencia(asistencia),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            return Response(
                {
                    "detail": (
                        "Tu jornada de hoy ya fue finalizada. "
                        "No puedes abrir otra jornada para la misma fecha."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        observaciones = request.data.get("observaciones", "")

        asistencia = RegistroAsistencia.objects.create(
            trabajadora=trabajadora,
            fecha=hoy,
            entrada=timezone.now(),
            observaciones_entrada=observaciones,
        )

        return Response(
            {
                "detail": "Jornada iniciada correctamente.",
                "asistencia": serializar_asistencia(asistencia),
            },
            status=status.HTTP_201_CREATED,
        )


class FinalizarJornadaView(APIView):
    permission_classes = [EsPersonalTaller]

    @extend_schema(
        operation_id="taller_finalizar_jornada",
        request=OpenApiTypes.OBJECT,
        responses={
            200: OpenApiTypes.OBJECT,
            400: OpenApiTypes.OBJECT,
        },
    )

    @transaction.atomic
    def post(self, request):
        trabajadora = obtener_trabajadora(request)
        hoy = timezone.localdate()

        asistencia = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora,
            fecha=hoy,
        ).first()

        if not asistencia:
            return Response(
                {"detail": "Primero debes iniciar tu jornada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asistencia.salida:
            return Response(
                {"detail": "Tu jornada ya fue finalizada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tiene_sesion_activa = SesionTrabajo.objects.filter(
            reserva__trabajadora=trabajadora,
            fin__isnull=True,
        ).exists()

        if tiene_sesion_activa:
            return Response(
                {
                    "detail": (
                        "Antes de finalizar tu jornada, "
                        "detén el cronómetro del proceso que estás realizando."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        asistencia.salida = timezone.now()
        asistencia.observaciones_salida = request.data.get(
            "observaciones", ""
        )
        asistencia.save(
            update_fields=[
                "salida",
                "observaciones_salida",
                "actualizado_en",
            ]
        )

        return Response({
            "detail": "Jornada finalizada correctamente.",
            "asistencia": serializar_asistencia(asistencia),
        })


class MisTrabajosView(APIView):
    permission_classes = [EsPersonalTaller]

    def get(self, request):
        trabajadora = obtener_trabajadora(request)
        hoy = timezone.localdate()

        reservas = ReservaOperacion.objects.filter(
            trabajadora=trabajadora,
            fecha__lte=hoy,
            estado__in=[
                ReservaOperacion.Estado.RESERVADA,
                ReservaOperacion.Estado.EN_PROCESO,
            ],
            plantilla__activa=True,
            plantilla__operacion__activa=True,
        ).select_related(
            "contrato",
            "contrato__simulacion",
            "contrato__simulacion__cliente",
            "contrato__simulacion__tipo_vestido",
            "plantilla",
            "plantilla__operacion",
        ).order_by("fecha", "plantilla__orden")

        resultado = []

        for reserva in reservas:
            # La trabajadora debe tener la operación entre sus habilidades.
            tiene_habilidad = trabajadora.habilidades.filter(
                pk=reserva.plantilla.operacion_id
            ).exists()

            if not tiene_habilidad:
                continue

            datos = serializar_reserva(reserva)

            # No se ofrece para iniciar hasta completar las dependencias.
            if datos["puede_iniciar"]:
                resultado.append(datos)

        return Response({
            "fecha": hoy,
            "total": len(resultado),
            "trabajos": resultado,
        })


class IniciarSesionTrabajoView(APIView):
    permission_classes = [EsPersonalTaller]

    @transaction.atomic
    def post(self, request):
        trabajadora = obtener_trabajadora(request)
        reserva_id = request.data.get("reserva_id")

        if not reserva_id:
            return Response(
                {"detail": "Debes indicar el reserva_id."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            reserva = ReservaOperacion.objects.select_for_update().get(
                id=reserva_id,
                trabajadora=trabajadora,
            )
        except (ReservaOperacion.DoesNotExist, ValueError, TypeError):
            return Response(
                {"detail": "No se encontró ese trabajo asignado a tu perfil."},
                status=status.HTTP_404_NOT_FOUND,
            )

        asistencia = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora,
            fecha=timezone.localdate(),
            salida__isnull=True,
        ).first()

        if not asistencia:
            return Response(
                {
                    "detail": (
                        "Debes iniciar tu jornada antes de comenzar "
                        "a trabajar en un vestido."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if reserva.estado not in [
            ReservaOperacion.Estado.RESERVADA,
            ReservaOperacion.Estado.EN_PROCESO,
        ]:
            return Response(
                {"detail": "Este proceso ya no está disponible."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tiene_habilidad = trabajadora.habilidades.filter(
            pk=reserva.plantilla.operacion_id
        ).exists()

        if not tiene_habilidad:
            return Response(
                {
                    "detail": (
                        "No tienes registrada la habilidad necesaria "
                        "para realizar este proceso."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if not dependencias_completadas(reserva):
            return Response(
                {
                    "detail": (
                        "Este proceso todavía tiene operaciones anteriores "
                        "pendientes."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        sesion_activa = SesionTrabajo.objects.filter(
            reserva__trabajadora=trabajadora,
            fin__isnull=True,
        ).first()

        if sesion_activa:
            return Response(
                {
                    "detail": (
                        "Ya tienes un cronómetro activo. "
                        "Finalízalo antes de iniciar otro."
                    ),
                    "sesion_activa_id": sesion_activa.id,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        sesion = SesionTrabajo.objects.create(
            reserva=reserva,
            inicio=timezone.now(),
            observaciones_inicio=request.data.get("observaciones", ""),
        )

        reserva.estado = ReservaOperacion.Estado.EN_PROCESO
        reserva.save(update_fields=["estado"])

        return Response(
            {
                "detail": "Cronómetro iniciado correctamente.",
                "sesion": {
                    "id": sesion.id,
                    "reserva_id": reserva.id,
                    "inicio": sesion.inicio,
                    "observaciones": sesion.observaciones_inicio,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class FinalizarSesionTrabajoView(APIView):
    permission_classes = [EsPersonalTaller]

    @transaction.atomic
    def post(self, request, pk):
        trabajadora = obtener_trabajadora(request)

        try:
            sesion = SesionTrabajo.objects.select_for_update().get(
                pk=pk,
                reserva__trabajadora=trabajadora,
            )
        except SesionTrabajo.DoesNotExist:
            return Response(
                {"detail": "No se encontró esa sesión de trabajo."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if sesion.fin:
            return Response(
                {"detail": "Este cronómetro ya fue detenido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sesion.fin = timezone.now()
        sesion.observaciones_fin = request.data.get("observaciones", "")
        sesion.save(
            update_fields=["fin", "observaciones_fin"]
        )

        reserva = ReservaOperacion.objects.select_for_update().get(
            pk=sesion.reserva_id
        )

        # Se acumula el tiempo de esta sesión una sola vez.
        duracion = horas_decimal(sesion.inicio, sesion.fin)
        reserva.horas_realizadas = (
            reserva.horas_realizadas + duracion
        ).quantize(Decimal("0.01"))

        # Completar el proceso es opcional: detener el cronómetro
        # no significa necesariamente que el vestido esté terminado.
        completar = request.data.get("completar", False)

        if isinstance(completar, str):
            completar = completar.lower() in ("true", "1", "si", "sí")

        if completar is True:
            if not dependencias_completadas(reserva):
                return Response(
                    {
                        "detail": (
                            "No se puede completar el proceso porque "
                            "hay operaciones anteriores pendientes."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            reserva.estado = ReservaOperacion.Estado.COMPLETADA
        else:
            reserva.estado = ReservaOperacion.Estado.RESERVADA

        reserva.save(
            update_fields=["horas_realizadas", "estado"]
        )

        return Response({
            "detail": (
                "Proceso completado y cronómetro detenido."
                if reserva.estado == ReservaOperacion.Estado.COMPLETADA
                else "Cronómetro detenido y tiempo registrado."
            ),
            "sesion": {
                "id": sesion.id,
                "inicio": sesion.inicio,
                "fin": sesion.fin,
                "horas_sesion": duracion,
                "observaciones": sesion.observaciones_fin,
            },
            "reserva": {
                "id": reserva.id,
                "estado": reserva.estado,
                "horas_realizadas": reserva.horas_realizadas,
                "horas_pendientes": reserva.horas_pendientes,
            },
        })


class MiResumenTallerView(APIView):
    permission_classes = [EsPersonalTaller]

    def get(self, request):
        trabajadora = obtener_trabajadora(request)
        hoy = timezone.localdate()

        inicio_semana = hoy - timedelta(days=hoy.weekday())
        fin_semana = inicio_semana + timedelta(days=6)

        asistencias = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora,
            fecha__range=(inicio_semana, fin_semana),
        )

        sesiones = SesionTrabajo.objects.filter(
            reserva__trabajadora=trabajadora,
            inicio__date__range=(inicio_semana, fin_semana),
        ).select_related(
            "reserva",
            "reserva__contrato",
            "reserva__plantilla",
            "reserva__plantilla__operacion",
        )

        segundos_totales = 0
        for sesion in sesiones:
            fin = sesion.fin or timezone.now()
            segundos_totales += max(
                0, (fin - sesion.inicio).total_seconds()
            )

        horas_semana = Decimal(
            str(segundos_totales / 3600)
        ).quantize(Decimal("0.01"))

        vestidos_ids = set(
            sesiones.values_list("reserva__contrato_id", flat=True)
        )

        procesos = list(
            sesiones.values_list(
                "reserva__plantilla__operacion__nombre",
                flat=True,
            ).distinct()
        )

        return Response({
            "semana": {
                "desde": inicio_semana,
                "hasta": fin_semana,
            },
            "horas_trabajadas": horas_semana,
            "registros_asistencia": asistencias.count(),
            "vestidos_atendidos": len(vestidos_ids),
            "procesos_trabajados": procesos,
            "procesos_completados": ReservaOperacion.objects.filter(
                trabajadora=trabajadora,
                estado=ReservaOperacion.Estado.COMPLETADA,
                fecha__range=(inicio_semana, fin_semana),
            ).count(),
        })
