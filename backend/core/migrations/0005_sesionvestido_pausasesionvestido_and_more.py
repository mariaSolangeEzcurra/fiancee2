# Reconstruida a partir del .pyc compilado (el .py no venía en el proyecto).
# La base de datos ya la tiene aplicada.

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_vestidocontrato"),
    ]

    operations = [
        migrations.CreateModel(
            name="SesionVestido",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("inicio", models.DateTimeField(default=django.utils.timezone.now)),
                ("fin", models.DateTimeField(blank=True, null=True)),
                (
                    "estado",
                    models.CharField(
                        choices=[
                            ("EN_CURSO", "En curso"),
                            ("PAUSADA", "Pausada"),
                            ("FINALIZADA", "Finalizada"),
                        ],
                        default="EN_CURSO",
                        max_length=12,
                    ),
                ),
                ("observaciones", models.TextField(blank=True)),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                (
                    "jornada",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sesiones_vestidos",
                        to="core.registroasistencia",
                    ),
                ),
                (
                    "trabajadora",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sesiones_vestidos",
                        to="core.trabajadora",
                    ),
                ),
                (
                    "vestido",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sesiones_trabajo",
                        to="core.vestidocontrato",
                    ),
                ),
            ],
            options={
                "ordering": ["-inicio"],
            },
        ),
        migrations.CreateModel(
            name="PausaSesionVestido",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("inicio", models.DateTimeField(default=django.utils.timezone.now)),
                ("fin", models.DateTimeField(blank=True, null=True)),
                ("motivo", models.CharField(blank=True, max_length=200)),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                (
                    "sesion",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pausas",
                        to="core.sesionvestido",
                    ),
                ),
            ],
            options={
                "ordering": ["inicio"],
            },
        ),
        migrations.AddConstraint(
            model_name="sesionvestido",
            constraint=models.UniqueConstraint(
                condition=models.Q(("estado__in", ["EN_CURSO", "PAUSADA"])),
                fields=("trabajadora",),
                name="una_sesion_abierta_por_trabajadora",
            ),
        ),
        migrations.AddConstraint(
            model_name="sesionvestido",
            constraint=models.UniqueConstraint(
                condition=models.Q(("estado__in", ["EN_CURSO", "PAUSADA"])),
                fields=("vestido",),
                name="una_sesion_abierta_por_vestido",
            ),
        ),
        migrations.AddConstraint(
            model_name="pausasesionvestido",
            constraint=models.UniqueConstraint(
                condition=models.Q(("fin__isnull", True)),
                fields=("sesion",),
                name="una_pausa_abierta_por_sesion",
            ),
        ),
    ]
