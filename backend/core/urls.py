
from django.urls import path, include
from core.comercial_views import IngresosComercialView, InicioComercialView
from core.gerencia_views import (
    CategoriasView, CategoriaView, ConfiguracionView, FijosView, FijoView, FinanzasResumenView,
    GastosView, GastoView, HorasPersonalView, IndicadoresView, MetasView, PagarFijoView,
)
from core.notificaciones_views import LeerNotificacionView, LeerTodasView, NotificacionesView
from core.simulador_views import SimuladorView
from core.importacion.views import EsquemaView, HistorialView, ImportarView, PlantillaView, ResumenTIView

from .views import (
    CapacidadProduccionView,
    CatalogoSimuladorView,
)

urlpatterns = [
    path(
        "catalogo/",
        CatalogoSimuladorView.as_view(),
        name="catalogo-simulador",
    ),
    path(
        "capacidad/",
        CapacidadProduccionView.as_view(),
        name="capacidad-produccion",
    ),
    path("contratos/", include("core.contratos.urls")),
    path("produccion/", include("core.produccion.urls")),
    path("simulador/", SimuladorView.as_view(), name="simulador"),
    path("comercial/inicio/", InicioComercialView.as_view(), name="comercial-inicio"),
    path("comercial/ingresos/", IngresosComercialView.as_view(), name="comercial-ingresos"),
    path("gerencia/finanzas/", FinanzasResumenView.as_view()),
    path("gerencia/gastos/", GastosView.as_view()),
    path("gerencia/gastos/<int:pk>/", GastoView.as_view()),
    path("gerencia/fijos/", FijosView.as_view()),
    path("gerencia/fijos/<int:pk>/", FijoView.as_view()),
    path("gerencia/fijos/<int:pk>/pagar/", PagarFijoView.as_view()),
    path("gerencia/categorias/", CategoriasView.as_view()),
    path("gerencia/categorias/<int:pk>/", CategoriaView.as_view()),
    path("gerencia/configuracion/", ConfiguracionView.as_view()),
    path("gerencia/metas/", MetasView.as_view()),
    path("gerencia/horas/", HorasPersonalView.as_view()),
    path("gerencia/indicadores/", IndicadoresView.as_view()),
    path("ti/resumen/", ResumenTIView.as_view(), name="ti-resumen"),
    path("ti/esquema/", EsquemaView.as_view(), name="ti-esquema"),
    path("ti/plantilla/", PlantillaView.as_view(), name="ti-plantilla"),
    path("ti/importar/", ImportarView.as_view(), name="ti-importar"),
    path("ti/historial/", HistorialView.as_view(), name="ti-historial"),
    path("notificaciones/", NotificacionesView.as_view(), name="notificaciones"),
    path("notificaciones/leer-todas/", LeerTodasView.as_view(), name="notificaciones-leer-todas"),
    path("notificaciones/<int:pk>/leer/", LeerNotificacionView.as_view(), name="notificacion-leer"),
]
