"""
Pagos de contratos: un solo lugar para registrarlos desde Comercial o desde
el taller, así ambos ven exactamente lo mismo.

- Primer, segundo y tercer pago tienen su casilla fija.
- Los demás son «otros pagos» (abonos) y llevan una descripción.
- Cada pago guarda quién lo registró, desde dónde, fecha y hora, y su
  código de recibo (EFITA-000001 desde el taller, EFICO-… desde tienda).
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import Contrato, Pago

NOMBRES_PAGO = {1: "Primer pago", 2: "Segundo pago", 3: "Tercer pago"}


def _nombre_usuario(u):
    if not u:
        return ""
    return u.get_full_name() or u.username


def serializar_pago(p):
    return {
        "id": p.id,
        "code": p.codigo,
        "number": p.orden_adelanto,
        "label": p.concepto or NOMBRES_PAGO.get(p.orden_adelanto, "Pago"),
        "concept": p.concepto,
        "amount": float(p.importe),
        "date": p.fecha,
        "createdAt": p.creado_en,
        "method": p.metodo,
        "methodLabel": p.get_metodo_display(),
        "reference": p.referencia,
        "notes": p.observaciones,
        "origin": p.origen,
        "originLabel": p.get_origen_display(),
        "by": _nombre_usuario(p.registrado_por),
        "dressCode": p.vestido.codigo if p.vestido_id else None,
    }


def resumen_pagos(contrato):
    pagos = list(
        Pago.objects.filter(contrato=contrato, confirmado=True)
        .select_related("registrado_por", "vestido").order_by("fecha", "creado_en", "id")
    )
    pagado = sum((p.importe for p in pagos), Decimal("0"))
    return {
        "contractId": contrato.id,
        "contract": contrato.numero,
        "client": contrato.cliente.nombre if contrato.cliente_id else "",
        "clientPhone": contrato.cliente.telefono if contrato.cliente_id else "",
        "total": float(contrato.precio_total),
        "paid": float(pagado),
        "balance": float(contrato.precio_total - pagado),
        "slots": [
            {"number": n, "label": NOMBRES_PAGO[n], "payment": next((serializar_pago(p) for p in pagos if p.orden_adelanto == n), None)}
            for n in (1, 2, 3)
        ],
        "others": [serializar_pago(p) for p in pagos if not p.orden_adelanto or p.orden_adelanto > 3],
        "history": [serializar_pago(p) for p in sorted(pagos, key=lambda p: (p.creado_en, p.id), reverse=True)],
    }


@transaction.atomic
def registrar_abono(
    contrato, importe, usuario=None, metodo=None, fecha=None, referencia="",
    numero=None, descripcion="", observaciones="", vestido=None, origen=None,
):
    importe = Decimal(importe).quantize(Decimal("0.01"))
    if importe <= 0:
        raise ValidationError("El monto debe ser mayor que cero.")
    contrato = Contrato.objects.select_for_update().get(pk=contrato.pk)
    if contrato.estado == Contrato.Estado.CANCELADO:
        raise ValidationError("El contrato está cancelado: no se pueden registrar pagos.")
    saldo = contrato.saldo_pendiente
    if importe > saldo:
        raise ValidationError(f"El pago supera el saldo pendiente del contrato (S/ {saldo:,.2f}).")
    if numero:
        if numero not in (1, 2, 3):
            raise ValidationError("Elige primer, segundo o tercer pago, u «otro pago».")
        if Pago.objects.filter(contrato=contrato, orden_adelanto=numero).exists():
            raise ValidationError(f"El {NOMBRES_PAGO[numero].lower()} ya está registrado en este contrato.")
        concepto = (descripcion or "").strip() or NOMBRES_PAGO[numero]
    else:
        concepto = (descripcion or "").strip() or "Otro pago"
    origen = origen or Pago.origen_de(usuario)
    pago = Pago.objects.create(
        contrato=contrato,
        vestido=vestido,
        importe=importe,
        fecha=fecha or timezone.localdate(),
        metodo=metodo or Pago.Metodo.EFECTIVO,
        referencia=referencia or "",
        concepto=concepto[:150],
        observaciones=observaciones or "",
        orden_adelanto=numero or None,
        confirmado=True,
        registrado_por=usuario,
        origen=origen,
    )

    from core.services.notificaciones import ROL_COMERCIAL, ROL_GERENCIA, ROL_JEFA, cliente_de, notificar, usuarios_con_rol

    # Se avisa a la otra área y a gerencia.
    destino = (ROL_COMERCIAL, ROL_GERENCIA) if origen == Pago.Origen.TALLER else (ROL_JEFA, ROL_GERENCIA)
    desde = "en taller" if origen == Pago.Origen.TALLER else "en tienda"
    notificar(
        [u for u in usuarios_con_rol(*destino) if u != usuario],
        "PAGO",
        f"Pago registrado {desde} · {contrato.numero}",
        f"{concepto}: S/ {importe:,.2f} de {cliente_de(contrato)} (recibo {pago.codigo}). "
        f"Saldo: S/ {contrato.saldo_pendiente:,.2f}.",
        vestido=vestido,
        contrato=contrato,
    )
    return pago
