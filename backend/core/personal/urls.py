
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from core.personal.views import (
    TrabajadoraViewSet,
    AusenciaViewSet,
    OperacionViewSet,
)

from core.personal.trabajadora_views import (
    MiPanelTallerView,
    IniciarJornadaView,
    FinalizarJornadaView,
    MisTrabajosView,
    IniciarSesionTrabajoView,
    FinalizarSesionTrabajoView,
    MiResumenTallerView,
    VestidosDisponiblesView,
    IniciarSesionVestidoView,
    PausarSesionVestidoView,
    ReanudarSesionVestidoView,
    FinalizarSesionVestidoView,
    MiResumenDiarioVestidosView,
)

router = DefaultRouter()

router.register(
    r"trabajadoras",
    TrabajadoraViewSet,
    basename="personal-trabajadoras",
)

router.register(
    r"ausencias",
    AusenciaViewSet,
    basename="personal-ausencias",
)

router.register(
    r"operaciones",
    OperacionViewSet,
    basename="personal-operaciones",
)

urlpatterns = [
    path("", include(router.urls)),

    # Panel y jornada
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

    # Operaciones anteriores
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

    # Trabajo por vestidos
    path(
        "vestidos-disponibles/",
        VestidosDisponiblesView.as_view(),
        name="vestidos-disponibles",
    ),
    path(
        "sesiones-vestido/iniciar/",
        IniciarSesionVestidoView.as_view(),
        name="iniciar-sesion-vestido",
    ),
    path(
        "sesiones-vestido/<int:pk>/pausar/",
        PausarSesionVestidoView.as_view(),
        name="pausar-sesion-vestido",
    ),
    path(
        "sesiones-vestido/<int:pk>/reanudar/",
        ReanudarSesionVestidoView.as_view(),
        name="reanudar-sesion-vestido",
    ),
    path(
        "sesiones-vestido/<int:pk>/finalizar/",
        FinalizarSesionVestidoView.as_view(),
        name="finalizar-sesion-vestido",
    ),
    path(
        "mi-resumen-diario/",
        MiResumenDiarioVestidosView.as_view(),
        name="mi-resumen-diario-vestidos",
    ),
]
