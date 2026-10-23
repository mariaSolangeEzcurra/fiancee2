from django.shortcuts import render
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken

from .serializers import InicioSesionSerializer, PerfilUsuarioSerializer


class InicioSesionView(TokenObtainPairView):
    serializer_class = InicioSesionSerializer


class PerfilUsuarioView(generics.RetrieveAPIView):
    serializer_class = PerfilUsuarioSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class CerrarSesionView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        refresh = request.data.get("refresh")

        if not refresh:
            from rest_framework.response import Response
            from rest_framework import status

            return Response(
                {"detail": "Se requiere el token de renovación."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            RefreshToken(refresh).blacklist()
        except Exception:
            from rest_framework.response import Response
            from rest_framework import status

            return Response(
                {"detail": "El token de renovación no es válido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from rest_framework.response import Response
        from rest_framework import status

        return Response(status=status.HTTP_205_RESET_CONTENT)
