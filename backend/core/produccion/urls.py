from django.urls import path

from .views import (
    CargosVestidoView,
    CargoVestidoView,
    CompletarPasoView,
    IniciarProcesoView,
    NotasVestidoView,
    OperacionesView,
    PagosVestidoView,
    PasoActualView,
    PasosView,
    PasoView,
    RecordatoriosView,
    TrabajadoraPasoView,
    TrabajadorasProduccionView,
    VestidoProduccionDetailView,
    VestidosProduccionView,
)

urlpatterns = [
    path("vestidos/", VestidosProduccionView.as_view(), name="produccion-vestidos"),
    path("vestidos/<int:pk>/", VestidoProduccionDetailView.as_view(), name="produccion-vestido"),
    path("vestidos/<int:pk>/iniciar-proceso/", IniciarProcesoView.as_view(), name="produccion-iniciar-proceso"),
    path("vestidos/<int:pk>/completar-paso/", CompletarPasoView.as_view(), name="produccion-completar-paso"),
    path("vestidos/<int:pk>/paso-actual/", PasoActualView.as_view(), name="produccion-paso-actual"),
    path("vestidos/<int:pk>/pasos/", PasosView.as_view(), name="produccion-pasos"),
    path("vestidos/<int:pk>/pasos/<int:index>/", PasoView.as_view(), name="produccion-paso"),
    path("vestidos/<int:pk>/pasos/<int:index>/trabajadoras/", TrabajadoraPasoView.as_view(), name="produccion-paso-trabajadoras"),
    path("vestidos/<int:pk>/pagos/", PagosVestidoView.as_view(), name="produccion-pagos"),
    path("vestidos/<int:pk>/cargos/", CargosVestidoView.as_view(), name="produccion-cargos"),
    path("vestidos/<int:pk>/cargos/<int:cargo_id>/", CargoVestidoView.as_view(), name="produccion-cargo"),
    path("vestidos/<int:pk>/notas/", NotasVestidoView.as_view(), name="produccion-notas"),
    path("recordatorios/", RecordatoriosView.as_view(), name="produccion-recordatorios"),
    path("operaciones/", OperacionesView.as_view(), name="produccion-operaciones"),
    path("trabajadoras/", TrabajadorasProduccionView.as_view(), name="produccion-trabajadoras"),
]
