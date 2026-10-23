
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)

urlpatterns = [
    path("admin/", admin.site.urls),

    # Autenticación
    path("api/auth/", include("accounts.urls")),

    # Módulo principal
    path("api/core/", include("core.urls")),

    # Módulo Personal - Gerencia
    path(
        "api/gerencia/personal/",
        include("core.personal.urls"),
    ),

    # Documentación de la API
    path(
        "api/schema/",
        SpectacularAPIView.as_view(),
        name="schema",
    ),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),

path("api/taller/", include("core.personal.urls_taller")),

]
