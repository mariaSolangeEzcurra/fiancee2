
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import InicioSesionView, PerfilUsuarioView, CerrarSesionView

urlpatterns = [
    path("login/", InicioSesionView.as_view(), name="login"),
    path("me/", PerfilUsuarioView.as_view(), name="perfil"),
    path("refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout/", CerrarSesionView.as_view(), name="logout"),
]
