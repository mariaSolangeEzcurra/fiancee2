
from decimal import Decimal
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status, serializers
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from core.models import (
    Trabajadora,
    ReservaOperacion,
    RegistroAsistencia,
    SesionTrabajo,
    DisponibilidadSemanal,
    AusenciaTrabajadora,
    VestidoContrato,
    SesionVestido,
    PausaSesionVestido,
)


from core.services.produccion import (  # noqa: E402
    asegurar_pasos,
    iniciar_paso,
    paso_actual,
)


class ObservacionesRequestSerializer(serializers.Serializer):
    observaciones = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
    )


class IniciarSesionTrabajoRequestSerializer(
    ObservacionesRequestSerializer
):
    reserva_id = serializers.IntegerField(min_value=1)


class FinalizarSesionTrabajoRequestSerializer(
    ObservacionesRequestSerializer
):
    completar = serializers.BooleanField(required=False, default=False)

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
        # Se compara dentro del mismo vestido (reservas antiguas
        # sin vestido se siguen comparando por contrato).
        completada = ReservaOperacion.objects.filter(
            contrato=reserva.contrato,
            vestido=reserva.vestido,
            plantilla=plantilla_anterior,
            estado=ReservaOperacion.Estado.COMPLETADA,
        ).exists()

        if not completada:
            return False

    return True


def serializar_reserva(reserva):
    contrato = reserva.contrato
    cliente = contrato.cliente
    vestido = reserva.vestido
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
            "vestido_id": reserva.vestido_id,
            "codigo": vestido.codigo if vestido else None,
            "cliente": str(cliente) if cliente else "",
            "tipo": (
                str(vestido.tipo_vestido)
                if vestido and vestido.tipo_vestido_id
                else str(plantilla.ruta.tipo_vestido)
            ),
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
    request=ObservacionesRequestSerializer,
    responses={201: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT},
)

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
    request=ObservacionesRequestSerializer,
    responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT},
)

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

            tiene_sesion_vestido_abierta = SesionVestido.objects.filter(
                trabajadora=trabajadora,
                estado__in=[
                    SesionVestido.Estado.EN_CURSO,
                    SesionVestido.Estado.PAUSADA,
                ],
            ).exists()

            if tiene_sesion_activa or tiene_sesion_vestido_abierta:
                return Response(
                    {
                        "detail": (
                            "Antes de finalizar tu jornada, debes finalizar "
                            "todas las sesiones de trabajo abiertas."
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
            "contrato__cliente",
            "vestido__tipo_vestido",
            "plantilla__ruta__tipo_vestido",
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

    @extend_schema(
    operation_id="taller_iniciar_sesion",
    request=IniciarSesionTrabajoRequestSerializer,
    responses={
        201: OpenApiTypes.OBJECT,
        400: OpenApiTypes.OBJECT,
        403: OpenApiTypes.OBJECT,
        404: OpenApiTypes.OBJECT,
    },
)

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

    @extend_schema(
    operation_id="taller_finalizar_sesion",
    request=FinalizarSesionTrabajoRequestSerializer,
    responses={
        200: OpenApiTypes.OBJECT,
        400: OpenApiTypes.OBJECT,
        404: OpenApiTypes.OBJECT,
    },
)

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


class MiDisponibilidadTallerView(APIView):
    """Consulta únicamente la disponibilidad de la trabajadora autenticada."""

    permission_classes = [EsPersonalTaller]

    @extend_schema(
        operation_id="taller_mi_disponibilidad",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        trabajadora = obtener_trabajadora(request)

        horarios = DisponibilidadSemanal.objects.filter(
            trabajadora=trabajadora
        ).order_by("dia_semana")

        resultado = [
            {
                "id": horario.id,
                "dia_semana": horario.dia_semana,
                "dia_nombre": horario.get_dia_semana_display(),
                "horas_disponibles": horario.horas_disponibles,
            }
            for horario in horarios
        ]

        return Response({
            "trabajadora": trabajadora.nombre,
            "total_dias_configurados": len(resultado),
            "disponibilidad": resultado,
        })


class MisAusenciasTallerView(APIView):
    """Consulta únicamente las ausencias de la trabajadora autenticada."""

    permission_classes = [EsPersonalTaller]

    @extend_schema(
        operation_id="taller_mis_ausencias",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        trabajadora = obtener_trabajadora(request)

        ausencias = AusenciaTrabajadora.objects.filter(
            trabajadora=trabajadora
        ).order_by("-fecha_inicio", "-id")

        resultado = [
            {
                "id": ausencia.id,
                "fecha_inicio": ausencia.fecha_inicio,
                "fecha_fin": ausencia.fecha_fin,
                "horas_no_disponibles": ausencia.horas_no_disponibles,
                "motivo": ausencia.motivo,
            }
            for ausencia in ausencias
        ]

        return Response({
            "trabajadora": trabajadora.nombre,
            "total": len(resultado),
            "ausencias": resultado,
        })


class MiHistorialTallerView(APIView):
    """
    Consulta el historial personal de asistencia y sesiones de producción.

    Permite filtrar con los parámetros opcionales:
    desde=AAAA-MM-DD
    hasta=AAAA-MM-DD
    """

    permission_classes = [EsPersonalTaller]

    @extend_schema(
        operation_id="taller_mi_historial",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        from datetime import date

        from django.utils.dateparse import parse_date

        trabajadora = obtener_trabajadora(request)

        desde_texto = request.query_params.get("desde")
        hasta_texto = request.query_params.get("hasta")

        desde = parse_date(desde_texto) if desde_texto else None
        hasta = parse_date(hasta_texto) if hasta_texto else None

        if desde_texto and desde is None:
            return Response(
                {"detail": "El parámetro 'desde' debe tener formato AAAA-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if hasta_texto and hasta is None:
            return Response(
                {"detail": "El parámetro 'hasta' debe tener formato AAAA-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if desde and hasta and desde > hasta:
            return Response(
                {"detail": "'desde' no puede ser posterior a 'hasta'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        asistencias = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora
        ).order_by("-fecha", "-entrada")

        sesiones = SesionTrabajo.objects.filter(
            reserva__trabajadora=trabajadora
        ).select_related(
            "reserva",
            "reserva__contrato",
            "reserva__contrato__cliente",
            "reserva__vestido__tipo_vestido",
            "reserva__plantilla__ruta__tipo_vestido",
            "reserva__plantilla",
            "reserva__plantilla__operacion",
        ).order_by("-inicio")

        if desde:
            asistencias = asistencias.filter(fecha__gte=desde)
            sesiones = sesiones.filter(inicio__date__gte=desde)

        if hasta:
            asistencias = asistencias.filter(fecha__lte=hasta)
            sesiones = sesiones.filter(inicio__date__lte=hasta)

        historial_asistencia = [
            serializar_asistencia(asistencia)
            for asistencia in asistencias
        ]

        historial_sesiones = []

        for sesion in sesiones:
            reserva = sesion.reserva
            contrato = reserva.contrato
            vestido = reserva.vestido
            operacion = reserva.plantilla.operacion

            historial_sesiones.append({
                "id": sesion.id,
                "reserva_id": reserva.id,
                "fecha": timezone.localtime(sesion.inicio).date(),
                "vestido": {
                    "contrato_id": contrato.id,
                    "numero": contrato.numero,
                    "codigo": vestido.codigo if vestido else None,
                    "cliente": str(contrato.cliente) if contrato.cliente_id else "",
                    "tipo": (
                        str(vestido.tipo_vestido)
                        if vestido and vestido.tipo_vestido_id
                        else str(reserva.plantilla.ruta.tipo_vestido)
                    ),
                },
                "proceso": {
                    "nombre": operacion.nombre,
                    "area": operacion.area_responsable,
                },
                "estado_proceso": reserva.estado,
                "inicio": sesion.inicio,
                "fin": sesion.fin,
                "sesion_activa": sesion.fin is None,
                "horas_trabajadas": horas_decimal(
                    sesion.inicio, sesion.fin
                ),
                "observaciones_inicio": sesion.observaciones_inicio,
                "observaciones_fin": sesion.observaciones_fin,
            })

        return Response({
            "trabajadora": trabajadora.nombre,
            "filtros": {
                "desde": desde,
                "hasta": hasta,
            },
            "asistencias": {
                "total": len(historial_asistencia),
                "registros": historial_asistencia,
            },
            "sesiones_trabajo": {
                "total": len(historial_sesiones),
                "registros": historial_sesiones,
            },
        })



def notas_para_taller(vestido, request=None, limite=10):
    """Observaciones con fotos y cobros extra, para que todas las vean."""
    datos = []
    for nota in vestido.notas.prefetch_related("imagenes", "cargos")[:limite]:
        cargo = next(iter(nota.cargos.all()), None)
        datos.append({
            "id": nota.id,
            "tipo": nota.tipo,
            "texto": nota.texto,
            "autor": nota.autor_nombre,
            "fecha": nota.creado_en,
            "imagenes": [
                request.build_absolute_uri(img.archivo.url) if request else img.archivo.url
                for img in nota.imagenes.all()
            ],
            "cobro_extra": float(cargo.monto) if cargo else None,
        })
    return datos


class NotasVestidoTallerView(APIView):
    """GET /api/taller/vestidos/<id>/notas/ — observaciones y fotos del vestido."""

    permission_classes = [EsPersonalTaller]

    def get(self, request, pk):
        vestido = VestidoContrato.objects.filter(pk=pk).first()
        if vestido is None:
            return Response({"detail": "El vestido no existe."}, status=status.HTTP_404_NOT_FOUND)
        return Response(notas_para_taller(vestido, request, limite=100))


def serializar_sesion_vestido(sesion):
    return {
        "id": sesion.id,
        "vestido_id": sesion.vestido_id,
        "paso_id": sesion.paso_id,
        "proceso": sesion.paso.nombre if sesion.paso_id else None,
        "codigo": sesion.vestido.codigo,
        "contrato": sesion.vestido.contrato.numero,
        "inicio": sesion.inicio,
        "fin": sesion.fin,
        "estado": sesion.estado,
        "horas_efectivas": sesion.horas_efectivas,
        "observaciones": sesion.observaciones,
        "pausada": sesion.estado == SesionVestido.Estado.PAUSADA,
    }


def obtener_asistencia_activa(trabajadora):
    return RegistroAsistencia.objects.filter(
        trabajadora=trabajadora,
        fecha=timezone.localdate(),
        salida__isnull=True,
    ).first()



class VestidosDisponiblesView(APIView):
    permission_classes = [EsPersonalTaller]

    def get(self, request):
        trabajadora = obtener_trabajadora(request)
        mis_operaciones = set(trabajadora.habilidades.values_list("id", flat=True))

        vestidos = VestidoContrato.objects.filter(
            estado__in=[
                VestidoContrato.Estado.PENDIENTE,
                VestidoContrato.Estado.EN_PROCESO,
            ],
            contrato__estado__in=["ACTIVO", "EN_PRODUCCION"],
            # Solo los ítems que pasan por el taller.
            ruta__isnull=False,
        ).select_related(
            "contrato",
            "contrato__cliente",
            "tipo_vestido",
            "ruta",
        ).order_by(
            "contrato__numero",
            "numero",
        )

        # Excluir vestidos que ya tengan una sesión abierta.
        vestidos = vestidos.exclude(
            sesiones_trabajo__estado__in=[
                SesionVestido.Estado.EN_CURSO,
                SesionVestido.Estado.PAUSADA,
            ]
        )

        resultado = []

        for vestido in vestidos.distinct():
            contrato = vestido.contrato
            cliente = contrato.cliente

            asegurar_pasos(vestido)
            paso = paso_actual(vestido)
            # La entrega la registra la jefa de taller y solo se puede
            # trabajar en un proceso que la jefa ya inició.
            if paso is None or paso.es_entrega or paso.estado != "EN_CURSO":
                continue

            resultado.append({
                "id": vestido.id,
                "vestido_id": vestido.id,
                "numero": vestido.numero,
                "codigo": vestido.codigo,
                "estado": vestido.estado,
                "contrato": contrato.numero,
                "contrato_id": contrato.id,
                "cliente": cliente.nombre if cliente else "",
                "tipo_vestido": (
                    str(vestido.tipo_vestido)
                    if vestido.tipo_vestido_id
                    else vestido.descripcion
                ),
                "taller": vestido.taller,
                "descripcion": vestido.descripcion,
                "fecha_entrega": vestido.fecha_limite_efectiva,
                "prioridad": vestido.prioridad,
                "paso_actual": vestido.paso_actual,
                "proceso_actual": paso.nombre,
                "area_proceso": paso.area,
                "horas_estimadas_proceso": paso.horas_estimadas,
                "es_de_mi_area": (
                    paso.plantilla is not None
                    and paso.plantilla.operacion_id in mis_operaciones
                ),
                "asignada_a_mi": paso.trabajadoras.filter(pk=trabajadora.pk).exists(),
                "proceso_iniciado_en": paso.iniciado_en,
                # Observaciones, fotos y cambios pedidos (visibles para todas).
                "observaciones": notas_para_taller(vestido, request),
            })

        # Primero lo asignado a ella y lo de su área.
        resultado.sort(key=lambda v: (not v["asignada_a_mi"], not v["es_de_mi_area"]))
        return Response(resultado)


class IniciarSesionVestidoView(APIView):
    permission_classes = [EsPersonalTaller]

    @transaction.atomic
    def post(self, request):
        trabajadora = obtener_trabajadora(request)
        vestido_id = request.data.get("vestido_id")
        observaciones = request.data.get("observaciones", "")

        if not vestido_id:
            return Response(
                {"detail": "Debes seleccionar un vestido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        jornada = RegistroAsistencia.objects.select_for_update().filter(
            trabajadora=trabajadora,
            fecha=timezone.localdate(),
            salida__isnull=True,
        ).first()

        if not jornada:
            return Response(
                {"detail": "Primero debes iniciar tu jornada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sesion_abierta = SesionVestido.objects.filter(
            trabajadora=trabajadora,
            estado__in=[
                SesionVestido.Estado.EN_CURSO,
                SesionVestido.Estado.PAUSADA,
            ],
        ).first()

        if sesion_abierta:
            return Response(
                {
                    "detail": (
                        "Debes finalizar o resolver tu sesión actual "
                        "antes de iniciar otro vestido."
                    ),
                    "sesion": serializar_sesion_vestido(sesion_abierta),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        vestido = VestidoContrato.objects.select_for_update().filter(
            pk=vestido_id
        ).select_related("contrato").first()

        if not vestido:
            return Response(
                {"detail": "El vestido seleccionado no existe."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if vestido.contrato.estado not in ["ACTIVO", "EN_PRODUCCION"]:
            return Response(
                {"detail": "El contrato no está habilitado para producción."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if vestido.estado == VestidoContrato.Estado.FINALIZADO:
            return Response(
                {"detail": "Este vestido ya está terminado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not vestido.ruta_id:
            return Response(
                {"detail": "Este ítem no pasa por el taller."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        asegurar_pasos(vestido)
        paso = paso_actual(vestido)
        if paso is None or paso.es_entrega:
            return Response(
                {"detail": "El vestido está listo para entrega."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if paso.estado != "EN_CURSO":
            return Response(
                {"detail": f"La jefa de taller aún no inició el proceso «{paso.nombre}»."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        otra_sesion = SesionVestido.objects.filter(
            vestido=vestido,
            estado__in=[
                SesionVestido.Estado.EN_CURSO,
                SesionVestido.Estado.PAUSADA,
            ],
        ).first()

        if otra_sesion:
            return Response(
                {"detail": "Este vestido está siendo trabajado por otra persona."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sesion = SesionVestido.objects.create(
            trabajadora=trabajadora,
            jornada=jornada,
            vestido=vestido,
            paso=paso,
            inicio=timezone.now(),
            estado=SesionVestido.Estado.EN_CURSO,
            observaciones=observaciones,
        )

        iniciar_paso(vestido, trabajadora)

        return Response(
            {
                "detail": f"Trabajo iniciado: {paso.nombre}.",
                "sesion": serializar_sesion_vestido(sesion),
            },
            status=status.HTTP_201_CREATED,
        )


class PausarSesionVestidoView(APIView):
    permission_classes = [EsPersonalTaller]

    @transaction.atomic
    def post(self, request, pk):
        trabajadora = obtener_trabajadora(request)

        sesion = SesionVestido.objects.select_for_update().filter(
            pk=pk,
            trabajadora=trabajadora,
        ).select_related("vestido", "vestido__contrato").first()

        if not sesion:
            return Response(
                {"detail": "No se encontró la sesión."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if sesion.estado != SesionVestido.Estado.EN_CURSO:
            return Response(
                {"detail": "Solo puedes pausar una sesión en curso."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        PausaSesionVestido.objects.create(
            sesion=sesion,
            inicio=timezone.now(),
            motivo=request.data.get("motivo", ""),
        )

        sesion.estado = SesionVestido.Estado.PAUSADA
        sesion.save(update_fields=["estado"])

        return Response({
            "detail": "Sesión pausada correctamente.",
            "sesion": serializar_sesion_vestido(sesion),
        })


class ReanudarSesionVestidoView(APIView):
    permission_classes = [EsPersonalTaller]

    @transaction.atomic
    def post(self, request, pk):
        trabajadora = obtener_trabajadora(request)

        sesion = SesionVestido.objects.select_for_update().filter(
            pk=pk,
            trabajadora=trabajadora,
        ).select_related("vestido", "vestido__contrato").first()

        if not sesion:
            return Response(
                {"detail": "No se encontró la sesión."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if sesion.estado != SesionVestido.Estado.PAUSADA:
            return Response(
                {"detail": "La sesión no está pausada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pausa = PausaSesionVestido.objects.filter(
            sesion=sesion,
            fin__isnull=True,
        ).first()

        if not pausa:
            return Response(
                {"detail": "No se encontró una pausa abierta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pausa.fin = timezone.now()
        pausa.save(update_fields=["fin"])

        sesion.estado = SesionVestido.Estado.EN_CURSO
        sesion.save(update_fields=["estado"])

        return Response({
            "detail": "Sesión reanudada correctamente.",
            "sesion": serializar_sesion_vestido(sesion),
        })


class FinalizarSesionVestidoView(APIView):
    permission_classes = [EsPersonalTaller]

    @transaction.atomic
    def post(self, request, pk):
        trabajadora = obtener_trabajadora(request)

        sesion = SesionVestido.objects.select_for_update().filter(
            pk=pk,
            trabajadora=trabajadora,
        ).select_related("vestido", "vestido__contrato").first()

        if not sesion:
            return Response(
                {"detail": "No se encontró la sesión."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if sesion.estado == SesionVestido.Estado.FINALIZADA:
            return Response(
                {"detail": "Esta sesión ya fue finalizada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pausa_abierta = PausaSesionVestido.objects.filter(
            sesion=sesion,
            fin__isnull=True,
        ).first()

        if pausa_abierta:
            pausa_abierta.fin = timezone.now()
            pausa_abierta.save(update_fields=["fin"])

        observaciones_finales = request.data.get("observaciones", "").strip()

        if observaciones_finales:
            if sesion.observaciones:
                sesion.observaciones += "\n" + observaciones_finales
            else:
                sesion.observaciones = observaciones_finales

        sesion.fin = timezone.now()
        sesion.estado = SesionVestido.Estado.FINALIZADA
        sesion.save(
            update_fields=["fin", "estado", "observaciones"]
        )

        # La trabajadora solo termina SU sesión de trabajo. El proceso
        # sigue abierto (otra persona puede continuarlo) y solo la jefa
        # de taller lo marca como terminado.
        horas = round(float(sesion.horas_efectivas), 2)
        proceso = sesion.paso.nombre if sesion.paso_id else "el vestido"

        return Response({
            "detail": f"Sesión finalizada: registraste {horas} h en {proceso}.",
            "horas_efectivas": horas,
            "sesion": serializar_sesion_vestido(sesion),
        })


class MiResumenDiarioVestidosView(APIView):
    permission_classes = [EsPersonalTaller]

    def get(self, request):
        trabajadora = obtener_trabajadora(request)
        hoy = timezone.localdate()

        jornada = RegistroAsistencia.objects.filter(
            trabajadora=trabajadora,
            fecha=hoy,
        ).first()

        sesiones = SesionVestido.objects.filter(
            trabajadora=trabajadora,
            jornada=jornada,
        ).select_related(
            "vestido",
            "vestido__contrato",
        ).prefetch_related("pausas").order_by("inicio") if jornada else (
            SesionVestido.objects.none()
        )

        sesiones_serializadas = [
            serializar_sesion_vestido(sesion)
            for sesion in sesiones
        ]

        total_horas = sum(
            (
                sesion.horas_efectivas
                for sesion in sesiones
            ),
            Decimal("0"),
        )

        return Response({
            "fecha": hoy,
            "asistencia": serializar_asistencia(jornada),
            "total_vestidos": len(sesiones_serializadas),
            "horas_efectivas": total_horas,
            "sesiones": sesiones_serializadas,
        })
