"""
python manage.py carga_prueba --contratos 8
python manage.py carga_prueba --borrar

Crea contratos de PRUEBA (número PRUEBA-001…, clienta "Prueba N") con
vestidos reales del catálogo y fechas repartidas en los próximos meses,
para llenar el taller y probar el simulador (temporada alta, cuellos de
botella, "no factible"). Con --borrar se eliminan todos, con sus
reservas, sin tocar los contratos reales.
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import (
    Cliente, Contrato, NotaVestido, Pago, PasoVestido, ReservaOperacion,
    RutaProduccion, SesionVestido, VestidoContrato,
)
from core.services.contratos import crear_contrato

PREFIJO = "PRUEBA-"


class Command(BaseCommand):
    help = "Crea o borra contratos de prueba para probar el simulador."

    def add_arguments(self, parser):
        parser.add_argument("--contratos", type=int, default=8, help="Cuántos contratos crear (1-60).")
        parser.add_argument("--desde", type=int, default=30, help="Días desde hoy de la primera entrega.")
        parser.add_argument("--hasta", type=int, default=150, help="Días desde hoy de la última entrega.")
        parser.add_argument("--vestidos", type=int, default=1, help="Vestidos por contrato (1-4).")
        parser.add_argument("--borrar", action="store_true", help="Borra todos los contratos de prueba.")
        parser.add_argument("--semilla", type=int, default=7)

    @transaction.atomic
    def handle(self, *args, **o):
        if o["borrar"]:
            return self.borrar()

        n = o["contratos"]
        if not 1 <= n <= 60:
            raise CommandError("--contratos debe estar entre 1 y 60.")
        rutas = list(RutaProduccion.objects.filter(activa=True, tipo_vestido__activo=True).select_related("tipo_vestido"))
        if not rutas:
            raise CommandError("No hay rutas activas en el catálogo.")

        azar = random.Random(o["semilla"])
        hoy = timezone.localdate()
        existentes = Contrato.objects.filter(numero__startswith=PREFIJO).count()

        for i in range(1, n + 1):
            dias = o["desde"] + round((o["hasta"] - o["desde"]) * (i - 1) / max(n - 1, 1))
            entrega = hoy + timedelta(days=dias)
            items = []
            for _ in range(max(1, min(o["vestidos"], 4))):
                ruta = azar.choice(rutas)
                items.append({
                    "tipo_vestido": ruta.tipo_vestido,
                    "taller": ruta.taller,
                    "modalidad": "VENTA",
                    "precio": Decimal(azar.choice([1800, 2500, 3200, 4500])),
                    "descripcion": f"{ruta.tipo_vestido} (prueba)",
                })
            numero = f"{PREFIJO}{existentes + i:03d}"
            contrato, resultado = crear_contrato(
                vestidos=items,
                fecha_entrega=entrega,
                fecha_evento=entrega + timedelta(days=7),
                datos_cliente={"nombre": f"Prueba {existentes + i}", "documento": f"PRUEBA{existentes + i:04d}"},
                numero=numero,
                observaciones="Contrato de prueba para el simulador. Se borra con: python manage.py carga_prueba --borrar",
            )
            a_tiempo = all(p.get("a_tiempo") for p in resultado["planificacion"] if p.get("planificado"))
            self.stdout.write(
                f"  {numero}: entrega {entrega:%d/%m/%Y} · "
                + ", ".join(f"{it['tipo_vestido']} {it['taller']}" for it in items)
                + ("" if a_tiempo else "  ⚠ no llega a tiempo")
            )
        self.stdout.write(self.style.SUCCESS(f"Se crearon {n} contratos de prueba."))

    def borrar(self):
        contratos = Contrato.objects.filter(numero__startswith=PREFIJO)
        vestidos = VestidoContrato.objects.filter(contrato__in=contratos)
        ReservaOperacion.objects.filter(contrato__in=contratos).delete()
        SesionVestido.objects.filter(vestido__in=vestidos).delete()
        for pago in Pago.objects.filter(contrato__in=contratos):
            pago.confirmado = False
            pago.save()
            pago.delete()
        for modelo in ("cargos_adicionales",):
            for c in contratos:
                getattr(c, modelo).all().delete()
        NotaVestido.objects.filter(vestido__in=vestidos).delete()
        PasoVestido.objects.filter(vestido__in=vestidos).delete()
        total = contratos.count()
        clientes = list(Cliente.objects.filter(contratos__in=contratos).distinct().values_list("id", flat=True))
        vestidos.delete()
        contratos.delete()
        Cliente.objects.filter(id__in=clientes, documento__startswith="PRUEBA", contratos__isnull=True).delete()
        self.stdout.write(self.style.SUCCESS(f"Se borraron {total} contratos de prueba."))
