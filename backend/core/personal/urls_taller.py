
from django.urls import path

from core.personal.trabajadora_views import (
    MiPanelTallerView,
    IniciarJornadaView,
    FinalizarJornadaView,
    MisTrabajosView,
    IniciarSesionTrabajoView,
    FinalizarSesionTrabajoView,
    MiResumenTallerView,
)

urlpatterns = [
    path("mi-panel/", MiPanelTallerView.as_view()),
    path("mi-jornada/iniciar/", IniciarJornadaView.as_view()),
    path("mi-jornada/finalizar/", FinalizarJornadaView.as_view()),
    path("mis-trabajos/", MisTrabajosView.as_view()),
    path("sesiones/iniciar/", IniciarSesionTrabajoView.as_view()),
    path(
        "sesiones/<int:pk>/finalizar/",
        FinalizarSesionTrabajoView.as_view(),
    ),
    path("mi-resumen/", MiResumenTallerView.as_view()),
]
