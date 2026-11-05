# Reconstruida a partir del .pyc compilado (el .py no venía en el proyecto).
# La base de datos ya la tiene aplicada.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_trabajadora_usuario_registroasistencia_sesiontrabajo"),
    ]

    operations = [
        migrations.CreateModel(
            name="VestidoContrato",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("numero", models.PositiveIntegerField()),
                ("codigo", models.CharField(max_length=60, unique=True)),
                (
                    "estado",
                    models.CharField(
                        choices=[
                            ("PENDIENTE", "Pendiente"),
                            ("EN_PROCESO", "En proceso"),
                            ("FINALIZADO", "Finalizado"),
                        ],
                        default="PENDIENTE",
                        max_length=15,
                    ),
                ),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                (
                    "contrato",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="vestidos",
                        to="core.contrato",
                    ),
                ),
            ],
            options={
                "ordering": ["contrato", "numero"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("contrato", "numero"),
                        name="vestido_unico_por_contrato",
                    )
                ],
            },
        ),
    ]
