"""
python manage.py reprogramar_taller

Reserva en el taller las horas que les faltan a los vestidos activos
(contratos ACTIVO o EN_PRODUCCION, vestidos no terminados).

Úsalo una vez después de actualizar, o cuando el simulador diga que el
taller está libre aunque haya vestidos en producción.
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import F
from django.db.models.functions import Coalesce
from django.utils import timezone

from core.models import VestidoContrato
from core.services.planificacion import CapacidadTaller
from core.services.produccion import reprogramar_pendientes


class Command(BaseCommand):
    help = "Reserva las horas pendientes de los vestidos activos en la capacidad del taller."

    def add_arguments(self, parser):
        parser.add_argument("--simular", action="store_true", help="Muestra lo que haría, sin guardar.")

    def handle(self, *args, **opciones):
        vestidos = (
            VestidoContrato.objects.filter(ruta__isnull=False, contrato__estado__in=["ACTIVO", "EN_PRODUCCION"])
            .exclude(estado=VestidoContrato.Estado.FINALIZADO)
            .select_related("contrato")
            .annotate(limite=Coalesce("fecha_limite", F("contrato__fecha_entrega")))
            .order_by("limite", "id")  # primero lo que se entrega antes
        )
        with transaction.atomic():
            capacidad = CapacidadTaller(timezone.localdate())
            total = 0
            for vestido in vestidos:
                horas = reprogramar_pendientes(vestido, capacidad)
                total += horas
                self.stdout.write(f"  {vestido.codigo}: {horas} h reservadas")
            if opciones["simular"]:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING(f"Simulación: se reservarían {total} h. No se guardó nada."))
            else:
                self.stdout.write(self.style.SUCCESS(f"Listo: {total} h reservadas en {vestidos.count()} vestidos."))
