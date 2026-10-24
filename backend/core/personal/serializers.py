
from decimal import Decimal
from django.contrib.auth import get_user_model

from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from core.models import (
    Trabajadora,
    Operacion,
    DisponibilidadSemanal,
    AusenciaTrabajadora,
    ReservaOperacion,
)

Usuario = get_user_model()

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

    # Datos de acceso: se reciben en POST/PATCH/PUT.
    username = serializers.CharField(
        required=False,
        trim_whitespace=True,
    )

    email = serializers.EmailField(
        required=False,
        allow_blank=False,
    )

    password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        trim_whitespace=False,
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
            "username",
            "email",
            "password",
        ]

    def to_representation(self, instance):
        """
        Incluye username y email del usuario relacionado en las
        respuestas GET, sin modificar los campos de entrada.
        """
        data = super().to_representation(instance)

        usuario = getattr(instance, "usuario", None)

        data["username"] = usuario.username if usuario else None
        data["email"] = usuario.email if usuario else None

        return data

    def validate_username(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "El nombre de usuario no puede estar vacío."
            )

        usuarios = Usuario.objects.filter(username__iexact=value)

        if self.instance and self.instance.usuario_id:
            usuarios = usuarios.exclude(
                pk=self.instance.usuario_id
            )

        if usuarios.exists():
            raise serializers.ValidationError(
                "Este nombre de usuario ya está registrado."
            )

        return value

    def validate_email(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "El correo electrónico no puede estar vacío."
            )

        usuarios = Usuario.objects.filter(email__iexact=value)

        if self.instance and self.instance.usuario_id:
            usuarios = usuarios.exclude(
                pk=self.instance.usuario_id
            )

        if usuarios.exists():
            raise serializers.ValidationError(
                "Este correo electrónico ya está registrado."
            )

        return value

    def validate(self, attrs):
        # Para crear una trabajadora, se requieren sus credenciales.
        if self.instance is None:
            campos_requeridos = ["username", "email", "password"]

            for campo in campos_requeridos:
                if not attrs.get(campo):
                    raise serializers.ValidationError({
                        campo: "Este campo es obligatorio."
                    })

        # Si no tiene un usuario asociado, debe proporcionar
        # todas las credenciales para crear uno.
        elif self.instance.usuario_id is None:
            campos_credenciales = ["username", "email", "password"]

            if any(campo in attrs for campo in campos_credenciales):
                for campo in campos_credenciales:
                    if not attrs.get(campo):
                        raise serializers.ValidationError({
                            campo: (
                                "Este campo es obligatorio para "
                                "crear el usuario asociado."
                            )
                        })

        password = attrs.get("password", "")

        if password and len(password) < 8:
            raise serializers.ValidationError({
                "password": (
                    "La contraseña debe tener al menos 8 caracteres."
                )
            })

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        username = validated_data.pop("username")
        email = validated_data.pop("email")
        password = validated_data.pop("password")

        habilidades = validated_data.pop("habilidades", [])

        usuario = Usuario.objects.create_user(
            username=username,
            email=email,
            password=password,
            rol="taller",
        )

        trabajadora = Trabajadora.objects.create(
            usuario=usuario,
            **validated_data,
        )

        trabajadora.habilidades.set(habilidades)

        return trabajadora

    @transaction.atomic
    def update(self, instance, validated_data):
        username = validated_data.pop("username", None)
        email = validated_data.pop("email", None)
        password = validated_data.pop("password", "")

        habilidades = validated_data.pop("habilidades", None)

        usuario = instance.usuario

        if usuario is not None:
            if username is not None:
                usuario.username = username

            if email is not None:
                usuario.email = email

            if password:
                usuario.set_password(password)

            if (
                username is not None
                or email is not None
                or password
            ):
                usuario.save()

        elif username is not None and email is not None and password:
            usuario = Usuario.objects.create_user(
                username=username,
                email=email,
                password=password,
                rol="taller",
            )

            instance.usuario = usuario
            instance.save(update_fields=["usuario"])

        instance = super().update(instance, validated_data)

        if habilidades is not None:
            instance.habilidades.set(habilidades)

        return instance


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
