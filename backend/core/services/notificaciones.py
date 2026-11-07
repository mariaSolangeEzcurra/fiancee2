"""
Notificaciones para cada usuario.

Se generan en los momentos importantes (asignación, inicio de proceso,
contrato nuevo, pagos, cobros adicionales, cierre automático de jornada)
y los recordatorios del taller (primera prueba, bordado, atrasos).
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.models import Notificacion, VestidoContrato

ROL_COMERCIAL = "comercial"
ROL_GERENCIA = "gerencia"
ROL_JEFA = "jefa_taller"


def usuarios_con_rol(*roles):
    return get_user_model().objects.filter(rol__in=roles, is_active=True)


def notificar(usuarios, tipo, titulo, mensaje="", vestido=None, contrato=None, clave=""):
    """Crea la notificación para cada usuario. Con clave no se repite."""
    creadas = 0
    for usuario in usuarios:
        if usuario is None:
            continue
        if clave and Notificacion.objects.filter(usuario=usuario, clave=clave).exists():
            continue
        try:
            with transaction.atomic():
                Notificacion.objects.create(
                    usuario=usuario,
                    tipo=tipo,
                    titulo=titulo[:150],
                    mensaje=mensaje,
                    vestido=vestido,
                    contrato=contrato or (vestido.contrato if vestido else None),
                    clave=clave,
                )
                creadas += 1
        except IntegrityError:
            pass
    return creadas


def cliente_de(contrato):
    return contrato.cliente.nombre if contrato and contrato.cliente_id else "sin nombre"


def sincronizar_avisos_taller():
    """
    Recordatorios automáticos para la jefa de taller (una sola vez cada uno):
    - primera prueba al mes y medio del contrato,
    - inicio del bordado (15 días antes de la entrega),
    - vestido atrasado.
    """
    from core.services.produccion import recordatorios_vestido

    jefas = list(usuarios_con_rol(ROL_JEFA))
    if not jefas:
        return
    hoy = timezone.localdate()
    vestidos = (
        VestidoContrato.objects.filter(ruta__isnull=False, contrato__estado__in=["ACTIVO", "EN_PRODUCCION"])
        .exclude(estado=VestidoContrato.Estado.FINALIZADO)
        .select_related("contrato", "contrato__cliente")
        .prefetch_related("pasos")
    )
    for vestido in vestidos:
        pasos = sorted(vestido.pasos.all(), key=lambda p: p.orden)
        for aviso in recordatorios_vestido(vestido, pasos, hoy):
            if not aviso["due"]:
                continue
            notificar(
                jefas,
                Notificacion.Tipo.RECORDATORIO,
                f"{aviso['title']} · {vestido.codigo}",
                f"{cliente_de(vestido.contrato)}. {aviso['message']}",
                vestido=vestido,
                clave=f"{aviso['type']}:{vestido.id}",
            )
        limite = vestido.fecha_limite_efectiva
        if limite < hoy:
            notificar(
                jefas,
                Notificacion.Tipo.ATRASO,
                f"Vestido atrasado · {vestido.codigo}",
                f"{cliente_de(vestido.contrato)}. Debía estar listo el {limite:%d/%m/%Y} y aún no se termina.",
                vestido=vestido,
                clave=f"ATRASO:{vestido.id}:{limite.isoformat()}",
            )
        elif limite - hoy <= timedelta(days=3):
            notificar(
                jefas,
                Notificacion.Tipo.ATRASO,
                f"Entrega por vencer · {vestido.codigo}",
                f"{cliente_de(vestido.contrato)}. Se entrega el {limite:%d/%m/%Y} y aún no se termina.",
                vestido=vestido,
                clave=f"POR_VENCER:{vestido.id}:{limite.isoformat()}",
            )
