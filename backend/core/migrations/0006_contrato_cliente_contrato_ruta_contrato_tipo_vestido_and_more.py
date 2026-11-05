# Reconstruida a partir del .pyc compilado (el .py no venía en el proyecto).
# La base de datos ya la tiene aplicada.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_sesionvestido_pausasesionvestido_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="contrato",
            name="cliente",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="contratos",
                to="core.cliente",
            ),
        ),
        migrations.AddField(
            model_name="contrato",
            name="ruta",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="contratos",
                to="core.rutaproduccion",
            ),
        ),
        migrations.AddField(
            model_name="contrato",
            name="tipo_vestido",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="contratos",
                to="core.tipovestido",
            ),
        ),
        migrations.AlterField(
            model_name="contrato",
            name="simulacion",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="contrato",
                to="core.simulacioncontrato",
            ),
        ),
    ]
