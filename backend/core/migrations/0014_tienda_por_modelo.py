"""
"Vestido en tienda" pasa a ser por modelo: cada modelo con Taller C recibe
su ruta Tienda (T), con las horas de confección del Taller A y de bordado
del Taller C de ese mismo modelo. El tipo genérico queda inactivo, pero los
contratos antiguos que lo usan siguen funcionando.
"""

from collections import Counter
from decimal import Decimal

from django.db import migrations

VESTIDO_EN_TIENDA = "Vestido en tienda"
TIEMPOS = [
    ("confección", None), ("prueba 1", 2), ("entalle", 8), ("prueba 2", 2),
    ("acabados", 8), ("basta", 4), ("bordado", None), ("lavandería", 24), ("prueba 3", 2),
]
ORIGEN = {"confección": "A", "bordado": "C"}


def crear_rutas_tienda(apps, schema_editor):
    TipoVestido = apps.get_model("core", "TipoVestido")
    RutaProduccion = apps.get_model("core", "RutaProduccion")
    Operacion = apps.get_model("core", "Operacion")
    PlantillaOperacion = apps.get_model("core", "PlantillaOperacion")

    if not Operacion.objects.exists():
        return  # Base nueva: cargar_catalogo_inicial() lo hace.

    # Horas de la ruta genérica (si alguien las editó, se respetan).
    generica = {
        p.operacion.nombre.lower(): p
        for p in PlantillaOperacion.objects.filter(
            ruta__tipo_vestido__nombre=VESTIDO_EN_TIENDA, ruta__taller="T"
        ).select_related("operacion")
    }

    for vestido in TipoVestido.objects.exclude(nombre=VESTIDO_EN_TIENDA):
        if not RutaProduccion.objects.filter(tipo_vestido=vestido, taller="C").exists():
            continue
        ruta, _ = RutaProduccion.objects.get_or_create(
            tipo_vestido=vestido, taller="T",
            defaults={"descripcion": "Vestido de tienda: solo modificaciones"},
        )
        orden = 0
        for nombre, horas in TIEMPOS:
            operacion = Operacion.objects.filter(nombre__iexact=nombre).first()
            if operacion is None:
                continue
            base = None
            if nombre in ORIGEN:
                base = PlantillaOperacion.objects.filter(
                    ruta__tipo_vestido=vestido, ruta__taller=ORIGEN[nombre], operacion=operacion
                ).first()
                if base is None:
                    continue
                horas = base.horas_estimadas
            elif nombre in generica:
                horas = generica[nombre].horas_estimadas
            tipos = Counter(
                PlantillaOperacion.objects.filter(operacion=operacion)
                .exclude(ruta__taller="T").values_list("tipo_tiempo", flat=True)
            )
            orden += 1
            PlantillaOperacion.objects.get_or_create(
                ruta=ruta, operacion=operacion,
                defaults={
                    "orden": orden,
                    "horas_estimadas": Decimal(str(horas)),
                    "tipo_tiempo": tipos.most_common(1)[0][0] if tipos else "TRABAJO",
                    "obligatoria": base.obligatoria if base else True,
                    "activa": True,
                },
            )

    TipoVestido.objects.filter(nombre=VESTIDO_EN_TIENDA).update(activo=False)


def deshacer(apps, schema_editor):
    # Las rutas nuevas se dejan (pueden estar en uso); solo se reactiva el genérico.
    TipoVestido = apps.get_model("core", "TipoVestido")
    TipoVestido.objects.filter(nombre=VESTIDO_EN_TIENDA).update(activo=True)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_importacion_datos"),
    ]

    operations = [
        migrations.RunPython(crear_rutas_tienda, deshacer),
    ]
