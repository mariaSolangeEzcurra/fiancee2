
from django.urls import path

from core.personal.trabajadora_views import (
    MiPanelTallerView,
    IniciarJornadaView,
    FinalizarJornadaView,
    MisTrabajosView,
    IniciarSesionTrabajoView,
    FinalizarSesionTrabajoView,
    MiResumenTallerView,
    MiDisponibilidadTallerView,
    MisAusenciasTallerView,
    MiHistorialTallerView,
)

urlpatterns = [
    path(
        "mi-panel/",
        MiPanelTallerView.as_view(),
        name="taller-mi-panel",
    ),
    path(
        "mi-jornada/iniciar/",
        IniciarJornadaView.as_view(),
        name="taller-iniciar-jornada",
    ),
    path(
        "mi-jornada/finalizar/",
        FinalizarJornadaView.as_view(),
        name="taller-finalizar-jornada",
    ),
    path(
        "mis-trabajos/",
        MisTrabajosView.as_view(),
        name="taller-mis-trabajos",
    ),
    path(
        "sesiones/iniciar/",
        IniciarSesionTrabajoView.as_view(),
        name="taller-iniciar-sesion",
    ),
    path(
        "sesiones/<int:pk>/finalizar/",
        FinalizarSesionTrabajoView.as_view(),
        name="taller-finalizar-sesion",
    ),
    path(
        "mi-resumen/",
        MiResumenTallerView.as_view(),
        name="taller-mi-resumen",
    ),

    # Nuevas consultas personales
    path(
        "mi-disponibilidad/",
        MiDisponibilidadTallerView.as_view(),
        name="taller-mi-disponibilidad",
    ),
    path(
        "mis-ausencias/",
        MisAusenciasTallerView.as_view(),
        name="taller-mis-ausencias",
    ),
    path(
        "mi-historial/",
        MiHistorialTallerView.as_view(),
        name="taller-mi-historial",
    ),
]
