
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    TrabajadoraViewSet,
    AusenciaViewSet,
    OperacionViewSet,
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
]



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
)

router = DefaultRouter()
router.register(
    r"trabajadoras",
    TrabajadoraViewSet,
    basename="trabajadora",
)
router.register(
    r"ausencias",
    AusenciaViewSet,
    basename="ausencia",
)
router.register(
    r"operaciones",
    OperacionViewSet,
    basename="operacion",
)

urlpatterns = [
    # Rutas existentes de gerencia
    path("", include(router.urls)),

    # Módulo del personal de taller
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
]
