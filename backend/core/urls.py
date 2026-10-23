
from django.urls import path

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
]
