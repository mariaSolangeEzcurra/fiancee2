
from decimal import Decimal

from django.db import transaction

from core.models import (
    Trabajadora,
    DisponibilidadSemanal,
    Operacion,
)

# =========================================================
# CONFIGURACIÓN DE DATOS DE PRUEBA
# Reemplazar estos registros por los datos reales del taller.
# Horario ilustrativo: lunes a viernes, 8 horas diarias.
# Sábados y domingos: 0 horas.
# =========================================================

DIAS_HORARIO = {
    0: Decimal("8"),  # Lunes
    1: Decimal("8"),  # Martes
    2: Decimal("8"),  # Miércoles
    3: Decimal("8"),  # Jueves
    4: Decimal("8"),  # Viernes
    5: Decimal("0"),  # Sábado
    6: Decimal("0"),  # Domingo
}

TRABAJADORAS = [
    {
        "nombre": "DEMO - Confeccionista 01",
        "area": "CONFECCION",
        "habilidades": ["patronaje", "corte de tela", "confección", "entalle"],
    },
    {
        "nombre": "DEMO - Confeccionista 02",
        "area": "CONFECCION",
        "habilidades": ["corte de tela", "confección", "entalle"],
    },
    {
        "nombre": "DEMO - Confeccionista 03",
        "area": "CONFECCION",
        "habilidades": ["confección", "entalle", "acabados", "basta"],
    },
    {
        "nombre": "DEMO - Confeccionista 04",
        "area": "CONFECCION",
        "habilidades": ["patronaje", "corte de tela", "confección"],
    },
    {
        "nombre": "DEMO - Bordadora 01",
        "area": "BORDADO",
        "habilidades": ["bordado"],
    },
    {
        "nombre": "DEMO - Bordadora 02",
        "area": "BORDADO",
        "habilidades": ["bordado"],
    },
    {
        "nombre": "DEMO - Encargada de compras 01",
        "area": "COMPRAS",
        "habilidades": ["compra materiales"],
    },
    {
        "nombre": "DEMO - Encargada de pruebas 01",
        "area": "PRUEBAS",
        "habilidades": ["prueba 1", "prueba 2", "prueba 3"],
    },
    {
        "nombre": "DEMO - Acabados 01",
        "area": "ACABADOS",
        "habilidades": ["acabados", "basta"],
    },
    {
        "nombre": "DEMO - Lavandería 01",
        "area": "LAVANDERIA",
        "habilidades": ["lavandería"],
    },
]


@transaction.atomic
def generar_datos():
    creadas = 0
    actualizadas = 0

    for datos in TRABAJADORAS:
        trabajadora, creada = Trabajadora.objects.update_or_create(
            nombre=datos["nombre"],
            defaults={
                "area": datos["area"],
                "activa": True,
                "observaciones": (
                    "REGISTRO DEMO. Reemplazar por datos reales "
                    "antes de utilizar el simulador en producción."
                ),
            },
        )

        if creada:
            creadas += 1
        else:
            actualizadas += 1

        # Crear o actualizar las siete disponibilidades semanales.
        for dia, horas in DIAS_HORARIO.items():
            DisponibilidadSemanal.objects.update_or_create(
                trabajadora=trabajadora,
                dia_semana=dia,
                defaults={"horas_disponibles": horas},
            )

        # Crear las operaciones necesarias si todavía no existen.
        operaciones_habilitadas = []

        for nombre_operacion in datos["habilidades"]:
            operacion, _ = Operacion.objects.get_or_create(
                nombre=nombre_operacion,
                defaults={
                    "area_responsable": datos["area"],
                    "activa": True,
                },
            )
            operaciones_habilitadas.append(operacion)

        trabajadora.habilidades.set(operaciones_habilitadas)

        total_semanal = sum(DIAS_HORARIO.values())

        print(
            f"{'CREADA' if creada else 'ACTUALIZADA'}: "
            f"{trabajadora.nombre} | "
            f"{trabajadora.get_area_display()} | "
            f"{len(operaciones_habilitadas)} habilidades | "
            f"{total_semanal} h/semana"
        )

    print("\n===================================")
    print("GENERACIÓN COMPLETADA")
    print(f"Trabajadoras creadas: {creadas}")
    print(f"Trabajadoras actualizadas: {actualizadas}")
    print(f"Total configurado: {len(TRABAJADORAS)}")
    print("Cada trabajadora tiene 7 horarios.")
    print("Los registros DEMO se pueden editar en Django Admin.")
    print("===================================")


generar_datos()
