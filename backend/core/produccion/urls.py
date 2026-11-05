from django.urls import path

from .views import (
    CompletarPasoView,
    NotasVestidoView,
    PasoActualView,
    PasoView,
    TrabajadoraPasoView,
    TrabajadorasProduccionView,
    VestidoProduccionDetailView,
    VestidosProduccionView,
)

urlpatterns = [
    path("vestidos/", VestidosProduccionView.as_view(), name="produccion-vestidos"),
    path("vestidos/<int:pk>/", VestidoProduccionDetailView.as_view(), name="produccion-vestido"),
    path("vestidos/<int:pk>/completar-paso/", CompletarPasoView.as_view(), name="produccion-completar-paso"),
    path("vestidos/<int:pk>/paso-actual/", PasoActualView.as_view(), name="produccion-paso-actual"),
    path("vestidos/<int:pk>/pasos/<int:index>/", PasoView.as_view(), name="produccion-paso"),
    path("vestidos/<int:pk>/pasos/<int:index>/trabajadoras/", TrabajadoraPasoView.as_view(), name="produccion-paso-trabajadoras"),
    path("vestidos/<int:pk>/notas/", NotasVestidoView.as_view(), name="produccion-notas"),
    path("trabajadoras/", TrabajadorasProduccionView.as_view(), name="produccion-trabajadoras"),
]
