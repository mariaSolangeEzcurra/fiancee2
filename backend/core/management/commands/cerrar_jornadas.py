from django.core.management.base import BaseCommand

from core.services.jornada import cerrar_jornadas_vencidas
from core.services.notificaciones import sincronizar_avisos_taller


class Command(BaseCommand):
    help = "Cierra las jornadas que quedaron abiertas de días anteriores y genera los avisos del taller."

    def handle(self, *args, **options):
        cerradas = cerrar_jornadas_vencidas()
        sincronizar_avisos_taller()
        self.stdout.write(self.style.SUCCESS(f"Jornadas cerradas automáticamente: {cerradas}"))
