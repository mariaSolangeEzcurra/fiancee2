from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone

from core.models import (
    SimulacionContrato,
    Contrato,
    VestidoContrato,
)


@transaction.atomic
def aceptar_simulacion(
    simulacion_id,
    numero,
    fecha_entrega,
    condiciones_pago="",
    observaciones="",
):
    simulacion = (
        SimulacionContrato.objects
        .select_for_update()
        .get(pk=simulacion_id)
    )

    if hasattr(simulacion, "contrato"):
        raise ValidationError(
            "Esta simulación ya fue convertida en contrato."
        )

    if simulacion.estado != SimulacionContrato.Estado.VIABLE:
        raise ValidationError(
            "Solo se pueden aceptar simulaciones viables."
        )

    if not numero or not numero.strip():
        raise ValidationError("El número de contrato es obligatorio.")

    if fecha_entrega < timezone.localdate():
        raise ValidationError(
            "La fecha de entrega no puede estar en el pasado."
        )

    contrato = Contrato.objects.create(
        simulacion=simulacion,
        numero=numero.strip(),
        fecha_firma=timezone.localdate(),
        fecha_entrega=fecha_entrega,
        precio_total=simulacion.importe_total,
        condiciones_pago=condiciones_pago,
        observaciones=observaciones,
    )

    VestidoContrato.objects.bulk_create([
        VestidoContrato(
            contrato=contrato,
            numero=i,
            codigo=f"{numero.strip()}-V{i:03d}",
        )
        for i in range(1, simulacion.cantidad + 1)
    ])

    simulacion.estado = SimulacionContrato.Estado.ACEPTADA
    simulacion.save(update_fields=["estado"])

    return contrato