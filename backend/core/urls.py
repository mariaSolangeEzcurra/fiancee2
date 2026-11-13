
from django.urls import path, include
from core.comercial_views import IngresosComercialView, InicioComercialView
from core.gerencia_views import (
    CategoriasView, CategoriaView, ConfiguracionView, FijosView, FijoView, FinanzasResumenView,
    GastosView, GastoView, HorasPersonalView, IndicadoresView, MetasView, PagarFijoView,
)
from core.notificaciones_views import LeerNotificacionView, LeerTodasView, NotificacionesView
from core.simulador_views import SimuladorView
from core.gerencia_analisis import RentabilidadView, TiemposPersonalView
from core.estado_resultados import EstadoResultadosView
from core.operaciones_views import (
    ArchivosVestidoView,
    ArchivoVestidoView,
    CalendarioView,
    ContratoPagosView,
    FichaTecnicaView,
    GastosAreaView,
)
from core.gerencia_dashboard import CapacidadDashboardView, DashboardView, FinanzasDashboardView, ReporteView
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
    path("gerencia/indicadores/rentabilidad/", RentabilidadView.as_view()),
    path("gerencia/dashboard/", DashboardView.as_view()),
    path("contratos/<int:pk>/pagos/", ContratoPagosView.as_view()),
    path("vestidos/<int:pk>/archivos/", ArchivosVestidoView.as_view()),
    path("vestidos/<int:pk>/archivos/<int:aid>/", ArchivoVestidoView.as_view()),
    path("vestidos/<int:pk>/ficha/", FichaTecnicaView.as_view()),
    path("gastos-area/", GastosAreaView.as_view()),
    path("calendario/", CalendarioView.as_view()),
    path("gerencia/estado-resultados/", EstadoResultadosView.as_view()),
    path("gerencia/dashboard/capacidad/", CapacidadDashboardView.as_view()),
    path("gerencia/dashboard/finanzas/", FinanzasDashboardView.as_view()),
    path("gerencia/dashboard/reporte/", ReporteView.as_view()),
    path("gerencia/indicadores/personal/", TiemposPersonalView.as_view()),
    path("ti/resumen/", ResumenTIView.as_view(), name="ti-resumen"),
    path("ti/esquema/", EsquemaView.as_view(), name="ti-esquema"),
    path("ti/plantilla/", PlantillaView.as_view(), name="ti-plantilla"),
    path("ti/importar/", ImportarView.as_view(), name="ti-importar"),
    path("ti/historial/", HistorialView.as_view(), name="ti-historial"),
    path("notificaciones/", NotificacionesView.as_view(), name="notificaciones"),
    path("notificaciones/leer-todas/", LeerTodasView.as_view(), name="notificaciones-leer-todas"),
    path("notificaciones/<int:pk>/leer/", LeerNotificacionView.as_view(), name="notificacion-leer"),
]
