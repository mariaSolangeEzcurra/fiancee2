from django.db import migrations, models


def asignar_area(apps, schema_editor):
    Gasto = apps.get_model("core", "Gasto")
    Gasto.objects.filter(registrado_por__rol="comercial").update(area="TIENDA")
    Gasto.objects.filter(registrado_por__rol="jefa_taller").update(area="TALLER")


class Migration(migrations.Migration):
    dependencies = [("core", "0019_notificacion_gasto")]

    operations = [
        migrations.AddField(
            model_name="gasto",
            name="area",
            field=models.CharField(
                choices=[("TIENDA", "Comercial (tienda)"), ("TALLER", "Taller"), ("GERENCIA", "Gerencia")],
                db_index=True, default="GERENCIA", max_length=10,
            ),
        ),
        migrations.RunPython(asignar_area, migrations.RunPython.noop),
    ]
