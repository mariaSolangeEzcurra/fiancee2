from django.contrib import admin
from .models import (
    Trabajadora,
    DisponibilidadSemanal,
    AusenciaTrabajadora,
    TipoVestido,
    Operacion,
    RutaProduccion,
    PlantillaOperacion,
    Cliente,
    SimulacionContrato,
    DetalleSimulacion,
    Contrato,
    VestidoContrato,
    ProcesoVestidoContrato,
    ReservaOperacion,
    CategoriaFinanciera,
    Pago,
    MovimientoFinanciero,
    CostoOperativo,
)


@admin.register(PlantillaOperacion)
class PlantillaOperacionAdmin(admin.ModelAdmin):
    list_display = (
        "ruta",
        "operacion",
        "orden",
        "tipo_tiempo",
        "horas_estimadas",
        "activa",
    )
    list_filter = ("ruta__taller", "tipo_tiempo", "activa")
    search_fields = ("ruta__tipo_vestido__nombre", "operacion__nombre")
    list_editable = ("horas_estimadas", "activa")
    ordering = ("ruta__tipo_vestido__nombre", "ruta__taller", "orden")


admin.site.register([
    Trabajadora,
    DisponibilidadSemanal,
    AusenciaTrabajadora,
    TipoVestido,
    Operacion,
    RutaProduccion,
    Cliente,
    SimulacionContrato,
    DetalleSimulacion,
    Contrato,
    VestidoContrato,
    ProcesoVestidoContrato,
    ReservaOperacion,
    CategoriaFinanciera,
    Pago,
    MovimientoFinanciero,
    CostoOperativo,
])


from .models import ImportacionDatos  # noqa: E402


@admin.register(ImportacionDatos)
class ImportacionDatosAdmin(admin.ModelAdmin):
    list_display = ("archivo", "estado", "usuario", "creado_en")
    list_filter = ("estado",)
    readonly_fields = ("archivo", "estado", "usuario", "resumen", "errores", "creado_en")
