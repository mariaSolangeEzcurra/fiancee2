
from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

Usuario = get_user_model()


class InicioSesionSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["rol"] = user.rol
        token["username"] = user.username
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user

        data["usuario"] = {
            "id": user.pk,
            "username": user.username,
            "nombre": user.get_full_name() or user.username,
            "rol": user.rol,
        }

        return data


class PerfilUsuarioSerializer(serializers.ModelSerializer):
    nombre = serializers.SerializerMethodField()

    class Meta:
        model = Usuario
        fields = ["id", "username", "nombre", "email", "rol"]

    def get_nombre(self, obj):
        return obj.get_full_name() or obj.username
