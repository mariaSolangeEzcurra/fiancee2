
from decimal import Decimal

from rest_framework import serializers

from core.models import (
    Trabajadora,
    Operacion,
    DisponibilidadSemanal,
    AusenciaTrabajadora,
    ReservaOperacion,
)


class OperacionSerializer(serializers.ModelSerializer):
    area_nombre = serializers.CharField(
        source="get_area_responsable_display",
        read_only=True,
    )

    class Meta:
        model = Operacion
        fields = [
            "id",
            "nombre",
            "area_responsable",
            "area_nombre",
            "descripcion",
            "activa",
        ]
        read_only_fields = fields


class DisponibilidadSerializer(serializers.ModelSerializer):
    dia_nombre = serializers.CharField(
        source="get_dia_semana_display",
        read_only=True,
    )

    class Meta:
        model = DisponibilidadSemanal
        fields = [
            "id",
            "dia_semana",
            "dia_nombre",
            "horas_disponibles",
        ]

    def validate_horas_disponibles(self, value):
        if value < 0 or value > 24:
            raise serializers.ValidationError(
                "Las horas deben estar entre 0 y 24."
            )
        return value


class AusenciaSerializer(serializers.ModelSerializer):
    trabajadora_nombre = serializers.CharField(
        source="trabajadora.nombre",
        read_only=True,
    )

    class Meta:
        model = AusenciaTrabajadora
        fields = [
            "id",
            "trabajadora",
            "trabajadora_nombre",
            "fecha_inicio",
            "fecha_fin",
            "horas_no_disponibles",
            "motivo",
        ]

    def validate(self, attrs):
        inicio = attrs.get(
            "fecha_inicio",
            getattr(self.instance, "fecha_inicio", None),
        )
        fin = attrs.get(
            "fecha_fin",
            getattr(self.instance, "fecha_fin", None),
        )
        horas = attrs.get(
            "horas_no_disponibles",
            getattr(self.instance, "horas_no_disponibles", Decimal("0")),
        )

        if inicio and fin and fin < inicio:
            raise serializers.ValidationError({
                "fecha_fin": "No puede ser anterior al inicio."
            })

        # Interpretamos estas horas como descuento por día.
        if horas < 0 or horas > 24:
            raise serializers.ValidationError({
                "horas_no_disponibles": "Debe estar entre 0 y 24."
            })

        return attrs


class TrabajadoraSerializer(serializers.ModelSerializer):
    habilidades = serializers.PrimaryKeyRelatedField(
        queryset=Operacion.objects.filter(activa=True),
        many=True,
        required=False,
    )

    area_nombre = serializers.CharField(
        source="get_area_display",
        read_only=True,
    )

    habilidades_detalle = OperacionSerializer(
        source="habilidades",
        many=True,
        read_only=True,
    )

    horarios = DisponibilidadSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Trabajadora
        fields = [
            "id",
            "nombre",
            "area",
            "area_nombre",
            "activa",
            "observaciones",
            "habilidades",
            "habilidades_detalle",
            "horarios",
        ]

    def validate_nombre(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(
                "El nombre es obligatorio."
            )
        return value


class ReservaPersonalSerializer(serializers.ModelSerializer):
    contrato_numero = serializers.CharField(
        source="contrato.numero",
        read_only=True,
    )
    operacion_nombre = serializers.CharField(
        source="plantilla.operacion.nombre",
        read_only=True,
    )
    horas_pendientes = serializers.DecimalField(
        max_digits=8,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = ReservaOperacion
        fields = [
            "id",
            "contrato",
            "contrato_numero",
            "plantilla",
            "operacion_nombre",
            "fecha",
            "horas_reservadas",
            "horas_realizadas",
            "horas_pendientes",
            "estado",
            "observaciones",
        ]
        read_only_fields = fields


class HorarioDiaEntradaSerializer(serializers.Serializer):
    dia_semana = serializers.IntegerField(
        min_value=0,
        max_value=6,
    )
    horas_disponibles = serializers.DecimalField(
        max_digits=6,
        decimal_places=2,
        min_value=Decimal("0"),
        max_value=Decimal("24"),
    )


class HorarioSemanalEntradaSerializer(serializers.Serializer):
    horarios = HorarioDiaEntradaSerializer(many=True)

    def validate_horarios(self, value):
        dias = [item["dia_semana"] for item in value]

        if len(dias) != 7 or set(dias) != set(range(7)):
            raise serializers.ValidationError(
                "Debes enviar los siete días, del 0 al 6, "
                "sin repetir ninguno."
            )

        return value
