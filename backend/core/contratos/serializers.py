from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import (
    Cliente,
    Contrato,
    Pago,
    RutaProduccion,
    TipoVestido,
    VestidoContrato,
)

CERO = Decimal("0.00")


# ============================================================
# SALIDA
# ============================================================

class ClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = [
            "id",
            "nombre",
            "documento",
            "telefono",
            "correo",
            "direccion",
            "observaciones",
        ]


class ProcesoVestidoSerializer(serializers.Serializer):
    """Proceso de la ruta del vestido con su tiempo base y el aplicado."""

    plantilla = serializers.IntegerField()
    operacion = serializers.CharField()
    orden = serializers.IntegerField()
    tipo_tiempo = serializers.CharField()
    horas_base = serializers.DecimalField(max_digits=9, decimal_places=2)
    horas = serializers.DecimalField(max_digits=9, decimal_places=2)
    incluido = serializers.BooleanField()
    ajustado = serializers.BooleanField()


class VestidoContratoSerializer(serializers.ModelSerializer):
    tipo_vestido_nombre = serializers.CharField(
        source="tipo_vestido.nombre", read_only=True, default=None
    )
    taller = serializers.CharField(read_only=True, allow_null=True)
    taller_display = serializers.SerializerMethodField()
    modalidad_display = serializers.CharField(
        source="get_modalidad_display", read_only=True
    )
    estado_display = serializers.CharField(
        source="get_estado_display", read_only=True
    )
    # Columnas del contrato impreso.
    precio_alquiler = serializers.SerializerMethodField()
    precio_venta = serializers.SerializerMethodField()
    precio_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = VestidoContrato
        fields = [
            "id",
            "numero",
            "codigo",
            "tipo_vestido",
            "tipo_vestido_nombre",
            "ruta",
            "taller",
            "taller_display",
            "descripcion",
            "modalidad",
            "modalidad_display",
            "precio",
            "precio_alquiler",
            "precio_venta",
            "precio_otros",
            "precio_total",
            "estado",
            "estado_display",
            "fecha_fin_estimada",
            "horas_sin_asignar",
            "procesos",
            "observaciones",
        ]
        read_only_fields = fields

    procesos = serializers.SerializerMethodField()

    def get_procesos(self, obj):
        if not obj.ruta_id:
            return []
        ajustes = {a.plantilla_id: a for a in obj.procesos.all()}
        datos = []
        for plantilla in sorted(
            (p for p in obj.ruta.operaciones.all() if p.activa),
            key=lambda p: (p.orden, p.id),
        ):
            ajuste = ajustes.get(plantilla.id)
            datos.append({
                "plantilla": plantilla.id,
                "operacion": plantilla.operacion.nombre,
                "orden": plantilla.orden,
                "tipo_tiempo": plantilla.tipo_tiempo,
                "horas_base": plantilla.horas_estimadas,
                "horas": ajuste.horas if ajuste else plantilla.horas_estimadas,
                "incluido": ajuste.incluido if ajuste else True,
                "ajustado": ajuste is not None,
            })
        return ProcesoVestidoSerializer(datos, many=True).data

    def get_taller_display(self, obj):
        return obj.ruta.get_taller_display() if obj.ruta_id else "Sin taller"

    def get_precio_alquiler(self, obj):
        return str(obj.precio) if obj.modalidad == "ALQUILER" else "0.00"

    def get_precio_venta(self, obj):
        return str(obj.precio) if obj.modalidad == "VENTA" else "0.00"


class AdelantoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pago
        fields = [
            "id",
            "orden_adelanto",
            "concepto",
            "importe",
            "fecha",
            "metodo",
            "referencia",
            "confirmado",
        ]
        read_only_fields = fields


class CargoAdicionalSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    vestido = serializers.IntegerField(source="vestido_id")
    vestido_codigo = serializers.CharField(source="vestido.codigo")
    concepto = serializers.CharField()
    descripcion = serializers.CharField()
    monto = serializers.DecimalField(max_digits=12, decimal_places=2)
    fecha = serializers.DateField()


class PagoSerializer(serializers.ModelSerializer):
    vestido_codigo = serializers.CharField(source="vestido.codigo", default=None)

    class Meta:
        model = Pago
        fields = [
            "id", "orden_adelanto", "concepto", "importe", "fecha",
            "metodo", "referencia", "observaciones", "confirmado", "vestido", "vestido_codigo",
        ]
        read_only_fields = fields


class ContratoSerializer(serializers.ModelSerializer):
    cliente = ClienteSerializer(read_only=True)
    vestidos = VestidoContratoSerializer(many=True, read_only=True)
    adelantos = serializers.SerializerMethodField()
    pagos = PagoSerializer(many=True, read_only=True)
    cargos_adicionales = CargoAdicionalSerializer(many=True, read_only=True)
    total_cargos = serializers.SerializerMethodField()
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    tipo_evento_display = serializers.CharField(
        source="get_tipo_evento_display", read_only=True
    )
    origen = serializers.SerializerMethodField()
    asesora_nombre = serializers.SerializerMethodField()
    total_vestidos = serializers.SerializerMethodField()
    total_pagado = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    saldo_pendiente = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    fecha_fin_produccion_estimada = serializers.SerializerMethodField()

    class Meta:
        model = Contrato
        fields = [
            "id",
            "numero",
            "origen",
            "simulacion",
            "estado",
            "estado_display",
            "cliente",
            # Objeto del contrato
            "servicio_alquiler",
            "servicio_venta",
            "servicio_confeccion",
            "fecha_evento",
            "tipo_evento",
            "tipo_evento_display",
            "tipo_evento_detalle",
            "fecha_entrega",
            "fecha_devolucion",
            "fecha_recojo_fotos",
            "fecha_devolucion_fotos",
            "servicio_lavanderia",
            # Montos
            "precio_total",
            "total_cargos",
            "cargos_adicionales",
            "adelantos",
            "pagos",
            "total_pagado",
            "saldo_pendiente",
            "garantia",
            "garantia_detalle",
            # Ítems
            "vestidos",
            "total_vestidos",
            "fecha_fin_produccion_estimada",
            # Otros
            "fecha_firma",
            "asesora",
            "asesora_nombre",
            "condiciones_pago",
            "observaciones",
            "creado_en",
            "actualizado_en",
        ]
        read_only_fields = fields

    def get_origen(self, obj):
        return "SIMULADOR" if obj.simulacion_id else "MANUAL"

    def get_total_cargos(self, obj):
        return str(sum((c.monto for c in obj.cargos_adicionales.all()), CERO))

    def get_asesora_nombre(self, obj):
        if not obj.asesora_id:
            return None
        return obj.asesora.get_full_name() or obj.asesora.username

    def get_adelantos(self, obj):
        pagos = sorted(
            (p for p in obj.pagos.all() if p.orden_adelanto),
            key=lambda p: p.orden_adelanto,
        )
        return AdelantoSerializer(pagos, many=True).data

    def get_total_vestidos(self, obj):
        return len(obj.vestidos.all())

    def get_fecha_fin_produccion_estimada(self, obj):
        fechas = [v.fecha_fin_estimada for v in obj.vestidos.all() if v.fecha_fin_estimada]
        return max(fechas) if fechas else None


class ContratoListaSerializer(serializers.ModelSerializer):
    """Versión liviana para el listado."""

    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True, default=None)
    cliente_documento = serializers.CharField(source="cliente.documento", read_only=True, default=None)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    tipo_evento_display = serializers.CharField(source="get_tipo_evento_display", read_only=True)
    origen = serializers.SerializerMethodField()
    total_vestidos = serializers.SerializerMethodField()
    resumen_vestidos = serializers.SerializerMethodField()

    class Meta:
        model = Contrato
        fields = [
            "id",
            "numero",
            "origen",
            "estado",
            "estado_display",
            "cliente_nombre",
            "cliente_documento",
            "tipo_evento",
            "tipo_evento_display",
            "fecha_evento",
            "fecha_firma",
            "fecha_entrega",
            "precio_total",
            "total_vestidos",
            "resumen_vestidos",
        ]
        read_only_fields = fields

    def get_origen(self, obj):
        return "SIMULADOR" if obj.simulacion_id else "MANUAL"

    def get_total_vestidos(self, obj):
        return len(obj.vestidos.all())

    def get_resumen_vestidos(self, obj):
        return [
            {
                "codigo": v.codigo,
                "tipo_vestido": v.tipo_vestido.nombre if v.tipo_vestido_id else v.descripcion,
                "taller": v.taller,
                "estado": v.estado,
            }
            for v in obj.vestidos.all()
        ]


# ============================================================
# ENTRADA
# ============================================================

class DatosClienteSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=180, required=False, allow_blank=True)
    documento = serializers.CharField(max_length=30, required=False, allow_blank=True)
    telefono = serializers.CharField(max_length=30, required=False, allow_blank=True)
    correo = serializers.EmailField(required=False, allow_blank=True)
    direccion = serializers.CharField(max_length=250, required=False, allow_blank=True)


class ProcesoInputSerializer(serializers.Serializer):
    plantilla = serializers.IntegerField(help_text="id del proceso (PlantillaOperacion) de la ruta.")
    horas = serializers.DecimalField(max_digits=9, decimal_places=2, min_value=CERO)
    incluido = serializers.BooleanField(default=True)


class ItemContratoSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False, allow_null=True)
    tipo_vestido = serializers.PrimaryKeyRelatedField(
        queryset=TipoVestido.objects.filter(activo=True),
        required=False,
        allow_null=True,
    )
    taller = serializers.ChoiceField(
        choices=RutaProduccion.Tipo.choices,
        required=False,
        allow_null=True,
        allow_blank=True,
        help_text="A, C o T (tienda). Vacío = el ítem no pasa por el taller.",
    )
    procesos = ProcesoInputSerializer(
        many=True,
        required=False,
        help_text=(
            "Tiempos por proceso para este vestido. Si no se envía, "
            "se usan las horas de la plantilla (o los ajustes ya guardados)."
        ),
    )
    descripcion = serializers.CharField(max_length=250, required=False, allow_blank=True)
    modalidad = serializers.ChoiceField(
        choices=VestidoContrato.Modalidad.choices,
        default=VestidoContrato.Modalidad.VENTA,
    )
    precio = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=CERO, default=CERO
    )
    precio_otros = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=CERO, default=CERO
    )
    observaciones = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs.get("taller") and not attrs.get("tipo_vestido"):
            raise serializers.ValidationError(
                {"tipo_vestido": "Selecciona el tipo de vestido para enviarlo al taller."}
            )
        if not attrs.get("tipo_vestido") and not (attrs.get("descripcion") or "").strip():
            raise serializers.ValidationError(
                {"descripcion": "Indica el tipo de vestido o una descripción del ítem."}
            )
        return attrs


class AdelantoInputSerializer(serializers.Serializer):
    concepto = serializers.CharField(max_length=150, required=False, allow_blank=True)
    observaciones = serializers.CharField(required=False, allow_blank=True)
    importe = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=CERO,
        required=False, allow_null=True,
    )
    fecha = serializers.DateField(required=False, allow_null=True)
    metodo = serializers.ChoiceField(choices=Pago.Metodo.choices, required=False)
    referencia = serializers.CharField(max_length=100, required=False, allow_blank=True)


class ContratoEntradaSerializer(serializers.Serializer):
    """
    Crear (POST) y editar (PUT/PATCH) un contrato.

    Clienta: enviar "cliente" (id) o "datos_cliente". Si se envían
    datos y el DNI ya existe, se reutiliza esa clienta; si no, se crea.
    """

    numero = serializers.CharField(
        max_length=40, required=False, allow_blank=True,
        help_text="Vacío = se genera automáticamente (CT-AAAA-0001).",
    )
    cliente = serializers.PrimaryKeyRelatedField(
        queryset=Cliente.objects.all(), required=False, allow_null=True
    )
    datos_cliente = DatosClienteSerializer(required=False, allow_null=True)

    fecha_firma = serializers.DateField(required=False)
    fecha_entrega = serializers.DateField(
        help_text="Fecha de recojo del vestido (fecha límite del taller)."
    )

    servicio_alquiler = serializers.BooleanField(required=False)
    servicio_venta = serializers.BooleanField(required=False)
    servicio_confeccion = serializers.BooleanField(required=False)

    fecha_evento = serializers.DateField(required=False, allow_null=True)
    tipo_evento = serializers.ChoiceField(choices=Contrato.TipoEvento.choices, required=False)
    tipo_evento_detalle = serializers.CharField(max_length=120, required=False, allow_blank=True)

    fecha_devolucion = serializers.DateField(required=False, allow_null=True)
    fecha_recojo_fotos = serializers.DateField(required=False, allow_null=True)
    fecha_devolucion_fotos = serializers.DateField(required=False, allow_null=True)
    servicio_lavanderia = serializers.CharField(max_length=250, required=False, allow_blank=True)

    garantia = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=CERO, required=False)
    garantia_detalle = serializers.CharField(max_length=250, required=False, allow_blank=True)

    condiciones_pago = serializers.CharField(required=False, allow_blank=True)
    observaciones = serializers.CharField(required=False, allow_blank=True)
    asesora = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.filter(is_active=True),
        required=False, allow_null=True,
    )

    vestidos = ItemContratoSerializer(many=True)
    adelantos = AdelantoInputSerializer(many=True, required=False)

    # Solo en edición
    estado = serializers.ChoiceField(choices=Contrato.Estado.choices, required=False)
    replanificar = serializers.BooleanField(required=False, default=False)

    def validate_vestidos(self, value):
        if not value:
            raise serializers.ValidationError("Agrega al menos un vestido o ítem.")
        return value

    def validate_adelantos(self, value):
        if len(value) > 3:
            raise serializers.ValidationError("Se admiten como máximo tres adelantos.")
        return value

    def validate(self, attrs):
        if self.instance is None:
            if attrs.get("cliente") is None and not attrs.get("datos_cliente"):
                raise serializers.ValidationError(
                    {"cliente": "Selecciona una clienta o registra sus datos."}
                )
            datos = attrs.get("datos_cliente") or {}
            if attrs.get("cliente") is None and not (datos.get("nombre") or "").strip():
                raise serializers.ValidationError(
                    {"datos_cliente": "El nombre de la clienta es obligatorio."}
                )
            if attrs.get("estado"):
                raise serializers.ValidationError(
                    {"estado": "El estado solo se puede cambiar al editar."}
                )
        return attrs


class AceptarSimulacionSerializer(serializers.Serializer):
    simulacion_id = serializers.IntegerField(min_value=1)
    numero = serializers.CharField(max_length=40, required=False, allow_blank=True)
    fecha_entrega = serializers.DateField(required=False)
    modalidad = serializers.ChoiceField(
        choices=VestidoContrato.Modalidad.choices,
        default=VestidoContrato.Modalidad.VENTA,
    )
    fecha_evento = serializers.DateField(required=False, allow_null=True)
    tipo_evento = serializers.ChoiceField(choices=Contrato.TipoEvento.choices, required=False)
    tipo_evento_detalle = serializers.CharField(max_length=120, required=False, allow_blank=True)
    garantia = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=CERO, required=False)
    condiciones_pago = serializers.CharField(required=False, allow_blank=True)
    observaciones = serializers.CharField(required=False, allow_blank=True)
