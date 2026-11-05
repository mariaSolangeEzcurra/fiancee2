"""
API de producción para la jefa de taller (pantalla "Vestidos") y
para gerencia (pantalla "Producción", solo lectura).

Base: /api/core/produccion/

Los nombres de los campos siguen el modelo del frontend (Dress):
code, client, steps, currentIndex, deadline, etc.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    NotaVestido,
    PasoVestido,
    SesionVestido,
    Trabajadora,
    VestidoContrato,
)
from core.services.produccion import (
    alternar_trabajadora,
    asegurar_pasos,
    cambiar_horas_estimadas,
    cambiar_paso_actual,
    completar_paso,
)

ROLES_LECTURA = ("jefa_taller", "gerencia")
ROLES_EDICION = ("jefa_taller",)

TALLER_NOMBRE = {"A": "Taller A", "C": "Taller C", "T": "Tienda"}
PRIORIDAD_NOMBRE = {"ALTA": "Alta", "MEDIA": "Media", "BAJA": "Baja"}
PRIORIDAD_CODIGO = {v: k for k, v in PRIORIDAD_NOMBRE.items()}


class PermisoProduccion(IsAuthenticated):
    """Lectura: jefa de taller y gerencia. Cambios: jefa de taller."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        rol = getattr(request.user, "rol", None)
        if request.method in SAFE_METHODS:
            return rol in ROLES_LECTURA
        return rol in ROLES_EDICION


def error(exc):
    mensaje = " ".join(getattr(exc, "messages", [str(exc)]))
    return Response({"detail": mensaje}, status=status.HTTP_400_BAD_REQUEST)


# ============================================================
# SERIALIZACIÓN (forma del frontend)
# ============================================================

def estado_frontend(vestido, pasos):
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        return "Terminado"
    if vestido.estado == VestidoContrato.Estado.PENDIENTE and all(
        p.estado == PasoVestido.Estado.PENDIENTE for p in pasos
    ):
        return "En cola"
    return "En producción"


ESTADO_SESION = {
    SesionVestido.Estado.EN_CURSO: "Trabajando",
    SesionVestido.Estado.PAUSADA: "En pausa",
    SesionVestido.Estado.FINALIZADA: "Finalizada",
}


def serializar_sesion(sesion, pasos_por_id):
    """Una sesión de trabajo de una trabajadora sobre el vestido."""
    pausas = list(sesion.pausas.all())
    segundos_pausa = sum(
        max(0, ((p.fin or timezone.now()) - p.inicio).total_seconds()) for p in pausas
    )
    jornada = sesion.jornada
    paso = pasos_por_id.get(sesion.paso_id)
    return {
        "id": sesion.id,
        "workerId": str(sesion.trabajadora_id),
        "worker": sesion.trabajadora.nombre,
        "stepIndex": paso["index"] if paso else None,
        "process": paso["name"] if paso else "—",
        "status": ESTADO_SESION.get(sesion.estado, sesion.estado),
        "open": sesion.estado != SesionVestido.Estado.FINALIZADA,
        "paused": sesion.estado == SesionVestido.Estado.PAUSADA,
        "start": sesion.inicio,
        "end": sesion.fin,
        "hours": round(float(sesion.horas_efectivas), 2),
        "pauseMinutes": round(segundos_pausa / 60),
        "pauses": len(pausas),
        "notes": sesion.observaciones,
        # Asistencia (jornada) en la que se registró la sesión.
        "shift": {
            "date": jornada.fecha,
            "checkIn": jornada.entrada,
            "checkOut": jornada.salida,
        } if jornada else None,
    }


def serializar_vestido(vestido):
    contrato = vestido.contrato
    cliente = contrato.cliente
    pasos = sorted(vestido.pasos.all(), key=lambda p: p.orden)

    sesiones = sorted(vestido.sesiones_trabajo.all(), key=lambda x: x.inicio, reverse=True)
    sesion_abierta = next(
        (x for x in sesiones
         if x.estado in (SesionVestido.Estado.EN_CURSO, SesionVestido.Estado.PAUSADA)),
        None,
    )

    pasos_por_id = {
        paso.id: {"index": i, "name": paso.nombre[:1].upper() + paso.nombre[1:]}
        for i, paso in enumerate(pasos)
    }
    registro = [serializar_sesion(x, pasos_por_id) for x in sesiones]

    # Horas por trabajadora en todo el vestido.
    resumen = {}
    for item in registro:
        r = resumen.setdefault(item["workerId"], {
            "workerId": item["workerId"], "worker": item["worker"],
            "hours": 0.0, "sessions": 0, "processes": [],
        })
        r["hours"] = round(r["hours"] + item["hours"], 2)
        r["sessions"] += 1
        if item["process"] not in r["processes"]:
            r["processes"].append(item["process"])

    steps = []
    for indice, paso in enumerate(pasos):
        trabajadas = sum(
            (Decimal(str(x["hours"])) for x in registro if x["stepIndex"] == indice),
            Decimal("0"),
        )
        trabajadoras = list(paso.trabajadoras.all())
        steps.append({
            "id": paso.id,
            "index": indice,
            "process": paso.nombre,
            "name": paso.nombre[:1].upper() + paso.nombre[1:],
            "area": paso.area,
            "timeType": paso.tipo_tiempo,
            "isDelivery": paso.es_entrega,
            "estHours": float(paso.horas_estimadas),
            "workedHours": round(float(trabajadas), 2),
            "done": paso.estado == PasoVestido.Estado.COMPLETADO,
            "inProgress": paso.estado == PasoVestido.Estado.EN_CURSO,
            "workerIds": [str(t.id) for t in trabajadoras],
            "workers": [t.nombre for t in trabajadoras],
            "completedAt": paso.completado_en,
            "sessions": [x for x in registro if x["stepIndex"] == indice],
        })

    notas = [
        {
            "id": str(n.id),
            "kind": "incidencia" if n.tipo == NotaVestido.Tipo.INCIDENCIA else "observacion",
            "author": n.autor_nombre or "—",
            "date": timezone.localtime(n.creado_en).date().isoformat(),
            "createdAt": n.creado_en,
            "text": n.texto,
        }
        for n in vestido.notas.all()
    ]

    return {
        "id": str(vestido.id),
        "vestidoId": vestido.id,
        "code": vestido.codigo,
        "contractId": contrato.id,
        "contract": contrato.numero,
        "client": cliente.nombre if cliente else "",
        "clientPhone": cliente.telefono if cliente else "",
        "city": "",
        "type": contrato.get_tipo_evento_display(),
        "dressType": vestido.tipo_vestido.nombre if vestido.tipo_vestido_id else vestido.descripcion,
        "corteId": str(vestido.tipo_vestido_id or ""),
        "corteName": vestido.tipo_vestido.nombre if vestido.tipo_vestido_id else vestido.descripcion,
        "description": vestido.descripcion,
        "modality": vestido.get_modalidad_display(),
        "workshop": TALLER_NOMBRE.get(vestido.taller, "Sin taller"),
        "workshopCode": vestido.taller,
        "eventDate": contrato.fecha_evento,
        "pickupDate": contrato.fecha_entrega,
        "deadline": vestido.fecha_limite_efectiva,
        "estimatedEnd": vestido.fecha_fin_estimada,
        "priority": PRIORIDAD_NOMBRE.get(vestido.prioridad, "Media"),
        "status": estado_frontend(vestido, pasos),
        "currentIndex": min(vestido.paso_actual, max(len(steps) - 1, 0)),
        "steps": steps,
        "notes": notas,
        # Quién lo tiene ahora (sesión abierta).
        "activeSession": (
            next(x for x in registro if x["id"] == sesion_abierta.id)
            if sesion_abierta else None
        ),
        # Registro completo de trabajo (más reciente primero).
        "workLog": registro,
        "workersSummary": sorted(resumen.values(), key=lambda r: -r["hours"]),
    }


def vestidos_queryset():
    return (
        VestidoContrato.objects.filter(
            ruta__isnull=False,
            contrato__estado__in=["ACTIVO", "EN_PRODUCCION", "ENTREGADO"],
        )
        .select_related("contrato", "contrato__cliente", "tipo_vestido", "ruta")
        .prefetch_related(
            Prefetch("pasos", queryset=PasoVestido.objects.prefetch_related("trabajadoras")),
            Prefetch(
                "sesiones_trabajo",
                queryset=SesionVestido.objects.select_related("trabajadora", "jornada").prefetch_related("pausas"),
            ),
            "notas",
        )
    )


def respuesta(vestido, mensaje=None, codigo=status.HTTP_200_OK):
    vestido = vestidos_queryset().get(pk=vestido.pk)
    data = {"dress": serializar_vestido(vestido)}
    if mensaje:
        data["detail"] = mensaje
    return Response(data, status=codigo)


def vestido_o_404(pk):
    vestido = get_object_or_404(VestidoContrato.objects.select_related("contrato"), pk=pk, ruta__isnull=False)
    asegurar_pasos(vestido)
    return vestido


# ============================================================
# VISTAS
# ============================================================

class VestidosProduccionView(APIView):
    """GET /api/core/produccion/vestidos/?q=&taller=A|C|T&estado=PENDIENTE|EN_PROCESO|FINALIZADO"""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_vestidos", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        # Vestidos antiguos sin línea de producción.
        for vestido in VestidoContrato.objects.filter(ruta__isnull=False, pasos__isnull=True):
            asegurar_pasos(vestido)

        vestidos = vestidos_queryset()
        params = request.query_params
        if q := params.get("q", "").strip():
            vestidos = vestidos.filter(
                Q(codigo__icontains=q) | Q(contrato__cliente__nombre__icontains=q)
            )
        if taller := params.get("taller"):
            vestidos = vestidos.filter(ruta__taller=taller)
        if estado := params.get("estado"):
            vestidos = vestidos.filter(estado=estado)

        return Response([serializar_vestido(v) for v in vestidos.order_by("contrato__fecha_entrega", "codigo")])


class VestidoProduccionDetailView(APIView):
    """
    GET   /api/core/produccion/vestidos/<id>/
    PATCH /api/core/produccion/vestidos/<id>/  {deadline?, priority?}
    """

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        deadline = serializers.DateField(required=False, allow_null=True)
        priority = serializers.ChoiceField(choices=list(PRIORIDAD_CODIGO), required=False)

    @extend_schema(operation_id="produccion_vestido", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request, pk):
        return respuesta(vestido_o_404(pk))

    @extend_schema(operation_id="produccion_editar_vestido", tags=["produccion"], request=Entrada, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        campos = []
        if "deadline" in datos:
            vestido.fecha_limite = datos["deadline"]
            campos.append("fecha_limite")
        if "priority" in datos:
            vestido.prioridad = PRIORIDAD_CODIGO[datos["priority"]]
            campos.append("prioridad")
        if campos:
            vestido.save(update_fields=campos)
        return respuesta(vestido, "Vestido actualizado.")


class CompletarPasoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/completar-paso/"""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_completar_paso", tags=["produccion"], request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        try:
            paso, finalizado = completar_paso(vestido, request.user)
        except DjangoValidationError as exc:
            return error(exc)
        mensaje = "Vestido terminado." if finalizado else f"Proceso «{paso.nombre}» terminado."
        return respuesta(vestido, mensaje)


class PasoActualView(APIView):
    """POST /api/core/produccion/vestidos/<id>/paso-actual/  {index}"""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        index = serializers.IntegerField(min_value=0)

    @extend_schema(operation_id="produccion_paso_actual", tags=["produccion"], request=Entrada, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            cambiar_paso_actual(vestido, entrada.validated_data["index"])
        except DjangoValidationError as exc:
            return error(exc)
        return respuesta(vestido, "Proceso actual actualizado.")


class PasoView(APIView):
    """PATCH /api/core/produccion/vestidos/<id>/pasos/<index>/  {estHours}"""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        estHours = serializers.DecimalField(max_digits=9, decimal_places=2, min_value=Decimal("0"))

    @extend_schema(operation_id="produccion_editar_paso", tags=["produccion"], request=Entrada, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request, pk, index):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            cambiar_horas_estimadas(vestido, index, entrada.validated_data["estHours"])
        except DjangoValidationError as exc:
            return error(exc)
        return respuesta(vestido, "Horas estimadas actualizadas. Se reprogramó la capacidad del taller.")


class TrabajadoraPasoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/pasos/<index>/trabajadoras/  {workerId}  (alterna)"""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        workerId = serializers.IntegerField()

    @extend_schema(operation_id="produccion_trabajadora_paso", tags=["produccion"], request=Entrada, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk, index):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            _, agregada = alternar_trabajadora(vestido, index, entrada.validated_data["workerId"])
        except DjangoValidationError as exc:
            return error(exc)
        return respuesta(vestido, "Trabajadora asignada." if agregada else "Trabajadora retirada.")


class NotasVestidoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/notas/  {kind: observacion|incidencia, text}"""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        kind = serializers.ChoiceField(choices=["observacion", "incidencia"], default="observacion")
        text = serializers.CharField(max_length=2000)

    @extend_schema(operation_id="produccion_nota", tags=["produccion"], request=Entrada, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        NotaVestido.objects.create(
            vestido=vestido,
            tipo=NotaVestido.Tipo.INCIDENCIA if datos["kind"] == "incidencia" else NotaVestido.Tipo.OBSERVACION,
            texto=datos["text"].strip(),
            autor=request.user,
            autor_nombre=request.user.get_full_name() or request.user.username,
        )
        mensaje = "Incidencia registrada." if datos["kind"] == "incidencia" else "Observación agregada."
        return respuesta(vestido, mensaje, status.HTTP_201_CREATED)


class TrabajadorasProduccionView(APIView):
    """GET /api/core/produccion/trabajadoras/  (para asignar en cada proceso)"""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_trabajadoras", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        trabajadoras = Trabajadora.objects.filter(activa=True).prefetch_related("habilidades").order_by("nombre")
        datos = []
        for t in trabajadoras:
            areas = {t.area: 1}
            for operacion in t.habilidades.all():
                areas[operacion.area_responsable] = 1
            datos.append({
                "id": str(t.id),
                "name": t.nombre,
                "role": t.get_area_display(),
                "area": t.area,
                "areas": areas,
                "skills": [op.nombre for op in t.habilidades.all()],
            })
        return Response(datos)
