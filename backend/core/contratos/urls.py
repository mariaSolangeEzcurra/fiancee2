from django.urls import path

from .views import (
    AceptarSimulacionView,
    ClientesView,
    ContratoDetailView,
    ContratoListCreateView,
    PlanificacionContratoView,
    PrevisualizarContratoView,
)

urlpatterns = [
    path("", ContratoListCreateView.as_view(), name="contratos"),
    path("previsualizar/", PrevisualizarContratoView.as_view(), name="previsualizar-contrato"),
    path("aceptar-simulacion/", AceptarSimulacionView.as_view(), name="aceptar-simulacion"),
    path("clientes/", ClientesView.as_view(), name="contratos-clientes"),
    path("<int:pk>/", ContratoDetailView.as_view(), name="detalle-contrato"),
    path("<int:pk>/planificacion/", PlanificacionContratoView.as_view(), name="planificacion-contrato"),
]
