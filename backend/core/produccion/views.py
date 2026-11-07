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
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    CargoAdicional,
    NotaVestido,
    Operacion,
    Pago,
    PasoVestido,
    SesionVestido,
    Trabajadora,
    VestidoContrato,
)
from core.services.jornada import cerrar_jornadas_vencidas
from core.services.notificaciones import sincronizar_avisos_taller
from core.services.produccion import (
    ORDINALES_PAGO,
    elegibles_por_operacion,
    operacion_del_paso,
    siguiente_numero_pago,
    agregar_cargo,
    agregar_nota,
    agregar_paso,
    alternar_trabajadora,
    asegurar_pasos,
    cambiar_horas_estimadas,
    cambiar_paso_actual,
    completar_paso,
    eliminar_cargo,
    eliminar_paso,
    iniciar_proceso,
    recordatorios_vestido,
    registrar_pago,
)

ROLES_LECTURA = ("jefa_taller", "gerencia", "comercial")
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


def url_archivo(request, archivo):
    if not archivo:
        return None
    return request.build_absolute_uri(archivo.url) if request else archivo.url


# ============================================================
# SERIALIZACIÓN (forma del frontend)
# ============================================================

def estado_frontend(vestido, pasos):
    if vestido.estado == VestidoContrato.Estado.FINALIZADO:
        return "Terminado"
    if all(p.estado == PasoVestido.Estado.PENDIENTE for p in pasos) and not vestido.sesiones_trabajo.all():
        return "Sin iniciar"
    return "En proceso"


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
        "shift": {
            "date": jornada.fecha,
            "checkIn": jornada.entrada,
            "checkOut": jornada.salida,
        } if jornada else None,
    }


def _nombre(texto):
    return texto[:1].upper() + texto[1:]


def _usuario(u):
    return (u.get_full_name() or u.username) if u else None


def serializar_vestido(vestido, request=None, elegibles=None):
    elegibles = elegibles if elegibles is not None else elegibles_por_operacion()
    contrato = vestido.contrato
    cliente = contrato.cliente
    pasos = sorted(vestido.pasos.all(), key=lambda p: p.orden)
    ahora = timezone.now()

    sesiones = sorted(vestido.sesiones_trabajo.all(), key=lambda x: x.inicio, reverse=True)
    sesion_abierta = next(
        (x for x in sesiones if x.estado in (SesionVestido.Estado.EN_CURSO, SesionVestido.Estado.PAUSADA)),
        None,
    )

    pasos_por_id = {paso.id: {"index": i, "name": _nombre(paso.nombre)} for i, paso in enumerate(pasos)}
    registro = [serializar_sesion(x, pasos_por_id) for x in sesiones]

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
        trabajadas = sum((x["hours"] for x in registro if x["stepIndex"] == indice), 0.0)
        trabajadoras = list(paso.trabajadoras.all())
        fin = paso.completado_en or (ahora if paso.estado == PasoVestido.Estado.EN_CURSO else None)
        duracion = (fin - paso.iniciado_en).total_seconds() / 3600 if (paso.iniciado_en and fin) else None
        steps.append({
            "id": paso.id,
            "index": indice,
            "process": paso.nombre,
            "name": _nombre(paso.nombre),
            "operationId": paso.operacion_id,
            "area": paso.area,
            "timeType": paso.tipo_tiempo,
            "isDelivery": paso.es_entrega,
            "isExtra": paso.es_adicional,
            "status": paso.estado,
            "estHours": float(paso.horas_estimadas),
            "workedHours": round(trabajadas, 2),
            "done": paso.estado == PasoVestido.Estado.COMPLETADO,
            "inProgress": paso.estado == PasoVestido.Estado.EN_CURSO,
            "startedAt": paso.iniciado_en,
            "startedBy": _usuario(paso.iniciado_por),
            "completedAt": paso.completado_en,
            "completedBy": _usuario(paso.completado_por),
            # Tiempo real desde que la jefa lo inició (horas de reloj).
            "elapsedHours": round(duracion, 2) if duracion is not None else None,
            "workerIds": [str(t.id) for t in trabajadoras],
            # Solo quienes tienen la habilidad de este proceso.
            "eligibleWorkerIds": [
                str(i) for i in sorted(
                    elegibles.get(operacion_del_paso(paso).id, set()) if operacion_del_paso(paso) else set()
                )
            ],
            "workers": [t.nombre for t in trabajadoras],
            "sessions": [x for x in registro if x["stepIndex"] == indice],
        })

    notas = []
    for n in vestido.notas.all():
        cargo = next(iter(n.cargos.all()), None)
        notas.append({
            "id": str(n.id),
            "kind": "incidencia" if n.tipo == NotaVestido.Tipo.INCIDENCIA else "observacion",
            "author": n.autor_nombre or "—",
            "date": timezone.localtime(n.creado_en).date().isoformat(),
            "createdAt": n.creado_en,
            "text": n.texto,
            "images": [
                {"id": img.id, "url": url_archivo(request, img.archivo)} for img in n.imagenes.all()
            ],
            "extraCharge": {"id": cargo.id, "concept": cargo.concepto, "amount": float(cargo.monto)} if cargo else None,
        })

    # Dinero del vestido y del contrato.
    cargos_vestido = list(vestido.cargos_adicionales.all())
    pagos_contrato = [p for p in contrato.pagos.all() if p.confirmado]
    extras_vestido = sum((c.monto for c in cargos_vestido), Decimal("0"))
    pagado = sum((p.importe for p in pagos_contrato), Decimal("0"))
    finance = {
        "dressPrice": float(vestido.precio_total),
        "dressExtras": float(extras_vestido),
        "dressTotal": float(vestido.precio_total + extras_vestido),
        "contractTotal": float(contrato.precio_total),
        "contractPaid": float(pagado),
        "contractBalance": float(contrato.precio_total - pagado),
        "charges": [
            {
                "id": c.id, "concept": c.concepto, "description": c.descripcion,
                "amount": float(c.monto), "date": c.fecha, "by": _usuario(c.registrado_por),
                "noteId": str(c.nota_id) if c.nota_id else None,
            }
            for c in cargos_vestido
        ],
        "payments": [
            {
                "id": p.id, "amount": float(p.importe), "date": p.fecha, "method": p.get_metodo_display(),
                "concept": p.concepto, "reference": p.referencia, "notes": p.observaciones,
                "number": p.orden_adelanto,
                "dressCode": p.vestido.codigo if p.vestido_id else None,
                "fromWorkshop": bool(p.vestido_id),
            }
            for p in sorted(pagos_contrato, key=lambda p: (p.orden_adelanto or 999, p.fecha, p.id))
        ],
        "usedPaymentNumbers": sorted(p.orden_adelanto for p in pagos_contrato if p.orden_adelanto),
    }

    return {
        "id": str(vestido.id),
        "vestidoId": vestido.id,
        "code": vestido.codigo,
        "contractId": contrato.id,
        "contract": contrato.numero,
        "contractDate": contrato.fecha_firma,
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
        "finance": finance,
        "reminders": recordatorios_vestido(vestido, pasos),
        "activeSession": (
            next(x for x in registro if x["id"] == sesion_abierta.id) if sesion_abierta else None
        ),
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
            Prefetch("pasos", queryset=PasoVestido.objects.select_related(
                "iniciado_por", "completado_por"
            ).prefetch_related("trabajadoras")),
            Prefetch(
                "sesiones_trabajo",
                queryset=SesionVestido.objects.select_related("trabajadora", "jornada").prefetch_related("pausas"),
            ),
            Prefetch("notas", queryset=NotaVestido.objects.prefetch_related("imagenes", "cargos")),
            Prefetch("cargos_adicionales", queryset=CargoAdicional.objects.select_related("registrado_por")),
            Prefetch("contrato__pagos", queryset=Pago.objects.select_related("vestido")),
        )
    )


PRIORIDAD_ORDEN = {"ALTA": 0, "MEDIA": 1, "BAJA": 2}


def respuesta(request, vestido, mensaje=None, codigo=status.HTTP_200_OK):
    vestido = vestidos_queryset().get(pk=vestido.pk)
    data = {"dress": serializar_vestido(vestido, request)}
    if mensaje:
        data["detail"] = mensaje
    return Response(data, status=codigo)


def vestido_o_404(pk):
    vestido = get_object_or_404(VestidoContrato.objects.select_related("contrato"), pk=pk, ruta__isnull=False)
    asegurar_pasos(vestido)
    return vestido


def accion(request, vestido, fn, mensaje, codigo=status.HTTP_200_OK):
    try:
        resultado = fn()
    except DjangoValidationError as exc:
        return error(exc)
    texto = mensaje(resultado) if callable(mensaje) else mensaje
    return respuesta(request, vestido, texto, codigo)


# ============================================================
# VISTAS
# ============================================================

class VestidosProduccionView(APIView):
    """GET /api/core/produccion/vestidos/?q=&taller=A|C|T&estado=PENDIENTE|EN_PROCESO|FINALIZADO"""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_vestidos", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        cerrar_jornadas_vencidas()
        sincronizar_avisos_taller()
        for vestido in VestidoContrato.objects.filter(ruta__isnull=False, pasos__isnull=True):
            asegurar_pasos(vestido)

        vestidos = vestidos_queryset()
        params = request.query_params
        if q := params.get("q", "").strip():
            vestidos = vestidos.filter(Q(codigo__icontains=q) | Q(contrato__cliente__nombre__icontains=q))
        if taller := params.get("taller"):
            vestidos = vestidos.filter(ruta__taller=taller)
        if estado := params.get("estado"):
            vestidos = vestidos.filter(estado=estado)

        elegibles = elegibles_por_operacion()
        # Primero lo urgente: prioridad alta y fecha límite más cercana.
        vestidos = sorted(
            vestidos,
            key=lambda v: (
                v.estado == VestidoContrato.Estado.FINALIZADO,
                PRIORIDAD_ORDEN.get(v.prioridad, 1),
                v.fecha_limite_efectiva,
                v.codigo,
            ),
        )
        return Response([serializar_vestido(v, request, elegibles) for v in vestidos])


class RecordatoriosView(APIView):
    """GET /api/core/produccion/recordatorios/ — avisos de seguimiento para la jefa."""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_recordatorios", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        avisos = []
        vestidos = (
            VestidoContrato.objects.filter(ruta__isnull=False, contrato__estado__in=["ACTIVO", "EN_PRODUCCION"])
            .exclude(estado=VestidoContrato.Estado.FINALIZADO)
            .select_related("contrato", "contrato__cliente")
            .prefetch_related("pasos")
        )
        for vestido in vestidos:
            for aviso in recordatorios_vestido(vestido, sorted(vestido.pasos.all(), key=lambda p: p.orden)):
                avisos.append({
                    **aviso,
                    "dressId": str(vestido.id),
                    "code": vestido.codigo,
                    "client": vestido.contrato.cliente.nombre if vestido.contrato.cliente_id else "",
                    "contract": vestido.contrato.numero,
                })
        avisos.sort(key=lambda a: (not a["due"], a["date"]))
        return Response(avisos)


class OperacionesView(APIView):
    """GET /api/core/produccion/operaciones/ — procesos que se pueden agregar."""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_operaciones", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response([
            {"id": op.id, "name": _nombre(op.nombre), "area": op.area_responsable}
            for op in Operacion.objects.filter(activa=True).order_by("nombre")
        ])


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
        return respuesta(request, vestido_o_404(pk))

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
        return respuesta(request, vestido, "Vestido actualizado.")


class IniciarProcesoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/iniciar-proceso/ — la jefa inicia el proceso actual."""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_iniciar_proceso", tags=["produccion"], request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        return accion(
            request, vestido,
            lambda: iniciar_proceso(vestido, request.user),
            lambda paso: f"Proceso «{paso.nombre}» iniciado. Desde ahora corre el tiempo.",
        )


class CompletarPasoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/completar-paso/"""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_completar_paso", tags=["produccion"], request=None, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        return accion(
            request, vestido,
            lambda: completar_paso(vestido, request.user),
            lambda r: "Vestido terminado." if r[1] else f"Proceso «{r[0].nombre}» terminado.",
        )


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
        return accion(
            request, vestido,
            lambda: cambiar_paso_actual(vestido, entrada.validated_data["index"], request.user),
            "Proceso actual actualizado.",
        )


class PasosView(APIView):
    """POST /api/core/produccion/vestidos/<id>/pasos/  {operationId, hours, after?, name?} — agrega un proceso."""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        operationId = serializers.IntegerField()
        hours = serializers.DecimalField(max_digits=9, decimal_places=2, min_value=Decimal("0"))
        after = serializers.IntegerField(required=False, allow_null=True, min_value=0)
        name = serializers.CharField(required=False, allow_blank=True, max_length=120)

    @extend_schema(operation_id="produccion_agregar_paso", tags=["produccion"], request=Entrada, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        d = entrada.validated_data
        return accion(
            request, vestido,
            lambda: agregar_paso(vestido, d["operationId"], d["hours"], d.get("after"), d.get("name", ""), request.user),
            lambda paso: f"Proceso «{paso.nombre}» agregado a la cola.",
            status.HTTP_201_CREATED,
        )


class PasoView(APIView):
    """
    PATCH  /api/core/produccion/vestidos/<id>/pasos/<index>/  {estHours}
    DELETE /api/core/produccion/vestidos/<id>/pasos/<index>/  (solo procesos agregados)
    """

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        estHours = serializers.DecimalField(max_digits=9, decimal_places=2, min_value=Decimal("0"))

    @extend_schema(operation_id="produccion_editar_paso", tags=["produccion"], request=Entrada, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request, pk, index):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        return accion(
            request, vestido,
            lambda: cambiar_horas_estimadas(vestido, index, entrada.validated_data["estHours"]),
            "Horas estimadas actualizadas. Se reprogramó la capacidad del taller.",
        )

    @extend_schema(operation_id="produccion_quitar_paso", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def delete(self, request, pk, index):
        vestido = vestido_o_404(pk)
        return accion(request, vestido, lambda: eliminar_paso(vestido, index), "Proceso quitado.")


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
        return accion(
            request, vestido,
            lambda: alternar_trabajadora(vestido, index, entrada.validated_data["workerId"]),
            lambda r: "Trabajadora asignada." if r[1] else "Trabajadora retirada.",
        )


class PagosVestidoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/pagos/  {amount, method?, date?, reference?, concept?}"""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
        method = serializers.ChoiceField(choices=Pago.Metodo.choices, required=False)
        date = serializers.DateField(required=False)
        reference = serializers.CharField(required=False, allow_blank=True, max_length=100)
        concept = serializers.CharField(required=False, allow_blank=True, max_length=150)
        # 1 = primer pago, 2 = segundo pago… (vacío = otro pago)
        number = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=20)
        notes = serializers.CharField(required=False, allow_blank=True)

    @extend_schema(operation_id="produccion_pago", tags=["produccion"], request=Entrada, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        d = entrada.validated_data
        return accion(
            request, vestido,
            lambda: registrar_pago(
                vestido, d["amount"], request.user, d.get("method"), d.get("date"),
                d.get("reference", ""), d.get("concept", ""), d.get("number"), d.get("notes", ""),
            ),
            lambda p: f"{p.concepto} de S/ {p.importe} registrado.",
            status.HTTP_201_CREATED,
        )


class CargosVestidoView(APIView):
    """POST /api/core/produccion/vestidos/<id>/cargos/  {concept, amount, description?}"""

    permission_classes = [PermisoProduccion]

    class Entrada(serializers.Serializer):
        concept = serializers.CharField(max_length=200)
        amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
        description = serializers.CharField(required=False, allow_blank=True)

    @extend_schema(operation_id="produccion_cargo", tags=["produccion"], request=Entrada, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        d = entrada.validated_data
        return accion(
            request, vestido,
            lambda: agregar_cargo(vestido, d["concept"], d["amount"], request.user, d.get("description", "")),
            lambda c: f"Cobro extra de S/ {c.monto} agregado al vestido.",
            status.HTTP_201_CREATED,
        )


class CargoVestidoView(APIView):
    """DELETE /api/core/produccion/vestidos/<id>/cargos/<cargo_id>/"""

    permission_classes = [PermisoProduccion]

    @extend_schema(operation_id="produccion_quitar_cargo", tags=["produccion"], responses={200: OpenApiTypes.OBJECT})
    def delete(self, request, pk, cargo_id):
        vestido = vestido_o_404(pk)
        return accion(request, vestido, lambda: eliminar_cargo(vestido, cargo_id), "Cobro extra quitado.")


class NotasVestidoView(APIView):
    """
    POST /api/core/produccion/vestidos/<id>/notas/  (multipart o JSON)
      kind: observacion | incidencia
      text: texto
      images: una o varias fotos (campo repetido)
      extraAmount / extraConcept: cobro extra por la modificación (opcional)
    """

    permission_classes = [PermisoProduccion]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    class Entrada(serializers.Serializer):
        kind = serializers.ChoiceField(choices=["observacion", "incidencia"], default="observacion")
        text = serializers.CharField(max_length=2000, required=False, allow_blank=True)
        extraAmount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True)
        extraConcept = serializers.CharField(max_length=200, required=False, allow_blank=True)

    @extend_schema(operation_id="produccion_nota", tags=["produccion"], request=Entrada, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        vestido = vestido_o_404(pk)
        entrada = self.Entrada(data=request.data)
        entrada.is_valid(raise_exception=True)
        d = entrada.validated_data
        imagenes = request.FILES.getlist("images")
        tipo = NotaVestido.Tipo.INCIDENCIA if d["kind"] == "incidencia" else NotaVestido.Tipo.OBSERVACION
        return accion(
            request, vestido,
            lambda: agregar_nota(
                vestido, tipo, d.get("text", ""), request.user, imagenes,
                d.get("extraAmount") or None, d.get("extraConcept", ""),
            ),
            "Incidencia registrada." if d["kind"] == "incidencia" else "Observación agregada.",
            status.HTTP_201_CREATED,
        )


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
                "skillIds": [op.id for op in t.habilidades.all()],
            })
        return Response(datos)
