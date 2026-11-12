"""
Cierre automático de la jornada.

Si una trabajadora no marca su salida, su jornada se cierra sola con
las horas de su horario de ese día (Gerencia → Personal → Horario).
Sus sesiones de trabajo abiertas se cierran a la misma hora.
Las horas extra se registran aparte, con su motivo.
"""

from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from core.models import (
    DisponibilidadSemanal,
    Notificacion,
    RegistroAsistencia,
    SesionTrabajo,
    SesionVestido,
)

HORAS_SIN_HORARIO = Decimal("8")


def horas_programadas(trabajadora, fecha):
    """Horas de su horario para ese día (0 = día libre)."""
    registro = DisponibilidadSemanal.objects.filter(
        trabajadora=trabajadora, dia_semana=fecha.weekday()
    ).first()
    return registro.horas_disponibles if registro else Decimal("0")


def horas_para_cierre(trabajadora, fecha):
    """
    Con cuántas horas se cierra una jornada olvidada: las de su horario;
    si vino en su día libre, una jornada estándar.
    """
    horas = horas_programadas(trabajadora, fecha)
    return horas if horas > 0 else HORAS_SIN_HORARIO


def _fin_del_dia(fecha):
    return timezone.make_aware(datetime.combine(fecha, time(23, 59)))


def _cerrar_sesion(sesion, hasta, motivo):
    fin = max(sesion.inicio, min(hasta, timezone.now()))
    for pausa in sesion.pausas.filter(fin__isnull=True):
        pausa.fin = max(pausa.inicio, fin)
        pausa.save(update_fields=["fin"])
    sesion.fin = fin
    sesion.estado = SesionVestido.Estado.FINALIZADA
    sesion.observaciones = (sesion.observaciones + "\n" if sesion.observaciones else "") + motivo
    sesion.save(update_fields=["fin", "estado", "observaciones"])


def cerrar_sesiones_abiertas(trabajadora, hasta, motivo):
    """Cierra las sesiones de vestido (y antiguas) abiertas a la hora `hasta`."""
    for sesion in SesionVestido.objects.filter(
        trabajadora=trabajadora,
        estado__in=[SesionVestido.Estado.EN_CURSO, SesionVestido.Estado.PAUSADA],
        inicio__lte=hasta,
    ):
        _cerrar_sesion(sesion, hasta, motivo)

    for sesion in SesionTrabajo.objects.filter(
        reserva__trabajadora=trabajadora, fin__isnull=True, inicio__lte=hasta
    ):
        sesion.fin = max(sesion.inicio, min(hasta, timezone.now()))
        sesion.observaciones_fin = motivo
        sesion.save(update_fields=["fin", "observaciones_fin"])


@transaction.atomic
def cerrar_jornadas_vencidas(trabajadora=None):
    """
    Cierra las jornadas de días anteriores que quedaron abiertas, con las
    horas del horario de ese día. También cierra sesiones que quedaron
    abiertas aunque su jornada ya se cerró. Devuelve cuántas cerró.
    """
    from core.services.notificaciones import ROL_JEFA, notificar, usuarios_con_rol

    hoy = timezone.localdate()
    pendientes = RegistroAsistencia.objects.filter(salida__isnull=True, fecha__lt=hoy).select_related(
        "trabajadora", "trabajadora__usuario"
    )
    if trabajadora is not None:
        pendientes = pendientes.filter(trabajadora=trabajadora)

    cerradas = 0
    jefas = None
    for registro in pendientes:
        horas = horas_para_cierre(registro.trabajadora, registro.fecha)
        salida = min(registro.entrada + timedelta(hours=float(horas)), _fin_del_dia(registro.fecha))
        registro.salida = salida
        registro.cierre_automatico = True
        registro.observaciones_salida = (
            f"Cerrada automáticamente con su horario ({horas} h). No marcó su salida."
        )
        registro.save(update_fields=["salida", "cierre_automatico", "observaciones_salida", "actualizado_en"])
        cerrar_sesiones_abiertas(
            registro.trabajadora, salida, "Cerrada automáticamente al terminar su horario."
        )
        cerradas += 1

        jefas = jefas if jefas is not None else list(usuarios_con_rol(ROL_JEFA))
        destinatarios = list(jefas)
        if registro.trabajadora.usuario_id:
            destinatarios.append(registro.trabajadora.usuario)
        notificar(
            destinatarios,
            Notificacion.Tipo.JORNADA,
            f"Jornada cerrada automáticamente · {registro.trabajadora.nombre}",
            f"El {registro.fecha:%d/%m/%Y} no se marcó la salida. Se registraron {horas} h según su horario. "
            "Si se quedó más tiempo, se pueden anotar horas extra.",
            clave=f"JORNADA:{registro.id}",
        )

    # Sesiones abiertas cuya jornada ya se cerró (datos antiguos).
    for sesion in SesionVestido.objects.filter(
        estado__in=[SesionVestido.Estado.EN_CURSO, SesionVestido.Estado.PAUSADA],
        jornada__salida__isnull=False,
    ).select_related("jornada", "trabajadora"):
        if trabajadora is not None and sesion.trabajadora_id != trabajadora.id:
            continue
        _cerrar_sesion(sesion, sesion.jornada.salida, "Cerrada al terminar su jornada.")

    return cerradas
