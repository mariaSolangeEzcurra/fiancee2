"""
Lee el Excel que sube TI, revisa cada fila y la guarda en el sistema.

- Todo se hace en una sola transacción: si hay un solo error no se
  guarda nada, y la persona corrige y vuelve a subir.
- En modo revisión (guardar=False) se ejecuta todo y al final se
  deshace, así la vista previa muestra exactamente lo que pasaría.
- Lo que ya existe en el sistema se omite o se actualiza, nunca se
  duplica, así se puede volver a subir el mismo archivo sin miedo.
"""

import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from openpyxl import load_workbook

from core.models import (
    CategoriaFinanciera,
    Cliente,
    Contrato,
    DisponibilidadSemanal,
    Gasto,
    Notificacion,
    Operacion,
    Pago,
    PasoVestido,
    ReservaOperacion,
    TipoVestido,
    Trabajadora,
    VestidoContrato,
)

from .esquema import HOJAS, buscar_hoja, normalizar

CERO = Decimal("0")
MAX_FILAS = 5000


class Resultado:
    def __init__(self):
        self.errores = []
        self.avisos = []
        self.hojas = {}

    def hoja(self, clave, titulo):
        if clave not in self.hojas:
            self.hojas[clave] = {
                "clave": clave, "titulo": titulo, "filas": 0,
                "nuevos": 0, "actualizados": 0, "omitidos": 0, "errores": 0,
            }
        return self.hojas[clave]

    def error(self, hoja, fila, columna, mensaje):
        self.errores.append({"hoja": hoja.titulo, "fila": fila, "columna": columna or "", "mensaje": mensaje})
        self.hoja(hoja.clave, hoja.titulo)["errores"] += 1

    def aviso(self, hoja, fila, mensaje):
        self.avisos.append({"hoja": hoja.titulo, "fila": fila, "mensaje": mensaje})

    def contar(self, hoja, que):
        self.hoja(hoja.clave, hoja.titulo)[que] += 1

    def como_dict(self, guardado):
        orden = [h.clave for h in HOJAS]
        hojas = sorted(self.hojas.values(), key=lambda h: orden.index(h["clave"]))
        titulos = [h.titulo for h in HOJAS]
        clave_err = lambda e: (titulos.index(e["hoja"]) if e["hoja"] in titulos else 99, e["fila"])
        self.errores.sort(key=clave_err)
        self.avisos.sort(key=clave_err)
        return {
            "ok": not self.errores,
            "guardado": guardado and not self.errores,
            "hojas": hojas,
            "errores": self.errores[:500],
            "total_errores": len(self.errores),
            "avisos": self.avisos[:300],
            "total_avisos": len(self.avisos),
        }


class ErrorCelda(Exception):
    pass


# ------------------------------------------------------------------
# Conversión de valores de celdas
# ------------------------------------------------------------------

def a_texto(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y")
    return re.sub(r"\s+", " ", str(v)).strip()


def a_numero(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise ErrorCelda("debe ser un número")
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v)).quantize(Decimal("0.01"))
    s = str(v).strip().lower().replace("s/.", "").replace("s/", "").replace("soles", "").replace(" ", "")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".") if re.fullmatch(r"-?\d+,\d{1,2}", s) else s.replace(",", "")
    try:
        return Decimal(s).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ErrorCelda(f"«{v}» no es un número válido")


def a_fecha(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and 20000 < v < 80000:
        return date(1899, 12, 30) + timedelta(days=int(v))
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ErrorCelda(f"«{s}» no es una fecha válida (usa dd/mm/aaaa)")


def a_opcion(columna, v):
    texto = normalizar(a_texto(v))
    if not texto:
        return None
    for valor, etiqueta, alias in columna.opciones():
        candidatos = {normalizar(etiqueta), normalizar(valor), *[normalizar(a) for a in alias]}
        if texto in candidatos:
            return valor
    validos = [o[1] for o in columna.opciones()]
    lista = ", ".join(validos[:12]) + ("…" if len(validos) > 12 else "")
    raise ErrorCelda(f"«{a_texto(v)}» no es válido. Usa: {lista}")


def convertir(columna, v):
    if columna.tipo == "numero":
        return a_numero(v)
    if columna.tipo == "fecha":
        return a_fecha(v)
    if columna.tipo in ("opcion", "sino"):
        return a_opcion(columna, v)
    return a_texto(v)


# ------------------------------------------------------------------
# Lectura del libro
# ------------------------------------------------------------------

def _mapa_columnas(hoja, encabezados):
    """Relaciona cada columna de la plantilla con su posición en el Excel."""
    mapa = {}
    for idx, enc in enumerate(encabezados):
        n = normalizar(enc)
        if not n:
            continue
        for c in hoja.columnas:
            if c.clave in mapa:
                continue
            if n == normalizar(c.titulo) or n in [normalizar(a) for a in c.alias]:
                mapa[c.clave] = idx
                break
    return mapa


def leer_libro(archivo, res):
    try:
        wb = load_workbook(archivo, read_only=True, data_only=True)
    except Exception:
        raise ValidationError(
            "No se pudo abrir el archivo. Asegúrate de que sea un Excel (.xlsx) "
            "y que no esté protegido con contraseña."
        )

    datos = {}
    for ws in wb.worksheets:
        hoja = buscar_hoja(ws.title)
        if hoja is None:
            continue
        filas = list(ws.iter_rows(values_only=True))
        # Busca la fila de encabezados en las primeras 5 filas.
        inicio, mapa = None, {}
        for i, fila in enumerate(filas[:5]):
            m = _mapa_columnas(hoja, fila or [])
            if len(m) > len(mapa):
                inicio, mapa = i, m
        res.hoja(hoja.clave, hoja.titulo)
        if inicio is None or not mapa:
            res.error(hoja, 1, "", "No se encontraron los encabezados de la plantilla. Descarga la plantilla y copia tus datos en ella.")
            continue

        faltan = [c.titulo for c in hoja.columnas if c.obligatorio and c.clave not in mapa]
        if faltan:
            res.error(hoja, inicio + 1, "", "Faltan columnas obligatorias: " + ", ".join(faltan))
            continue

        ayudas = {normalizar(c.nota() + (f". Ej: {c.ejemplo}" if c.ejemplo else "")) for c in hoja.columnas}
        registros = []
        for num, fila in enumerate(filas[inicio + 1:], start=inicio + 2):
            fila = list(fila or [])
            valores = {clave: (fila[idx] if idx < len(fila) else None) for clave, idx in mapa.items()}
            no_vacios = [v for v in valores.values() if a_texto(v)]
            if not no_vacios:
                continue
            # Fila de ayuda de la plantilla.
            if sum(normalizar(a_texto(v)) in ayudas for v in no_vacios) >= max(1, len(no_vacios) // 2):
                continue
            if len(registros) >= MAX_FILAS:
                res.error(hoja, num, "", f"La hoja tiene más de {MAX_FILAS} filas. Divide el archivo en partes.")
                break

            registro, ok = {"_fila": num}, True
            for c in hoja.columnas:
                if c.clave not in mapa:
                    registro[c.clave] = None
                    continue
                try:
                    valor = convertir(c, valores[c.clave])
                except ErrorCelda as exc:
                    res.error(hoja, num, c.titulo, str(exc))
                    ok = False
                    continue
                if c.obligatorio and (valor is None or valor == ""):
                    res.error(hoja, num, c.titulo, "Este dato es obligatorio.")
                    ok = False
                registro[c.clave] = valor
            if ok:
                registros.append(registro)
            res.hoja(hoja.clave, hoja.titulo)["filas"] += 1
        datos[hoja.clave] = registros
    wb.close()
    return datos


# ------------------------------------------------------------------
# Ayudas
# ------------------------------------------------------------------

def _mensajes(exc):
    if hasattr(exc, "message_dict"):
        return [(k, " ".join(v)) for k, v in exc.message_dict.items()]
    return [("", " ".join(exc.messages))]


def buscar_cliente(nombre, documento):
    if documento:
        c = Cliente.objects.filter(documento__iexact=documento).order_by("id").first()
        if c:
            return c
        return None
    return Cliente.objects.filter(nombre__iexact=nombre, documento="").order_by("id").first()


def guardar_cliente(datos):
    """Crea o actualiza una clienta. Devuelve (cliente, 'nuevos'|'actualizados'|'omitidos')."""
    cliente = buscar_cliente(datos["nombre"], datos.get("documento") or "")
    if cliente is None:
        cliente = Cliente(**{k: v or "" for k, v in datos.items()})
        cliente.full_clean()
        cliente.save()
        return cliente, "nuevos"
    cambios = []
    for campo, valor in datos.items():
        if valor and getattr(cliente, campo) != valor:
            setattr(cliente, campo, valor)
            cambios.append(campo)
    if not cliente.activo:
        cliente.activo = True
        cambios.append("activo")
    if cambios:
        cliente.full_clean()
        cliente.save(update_fields=cambios)
        return cliente, "actualizados"
    return cliente, "omitidos"


# ------------------------------------------------------------------
# Hojas
# ------------------------------------------------------------------

def importar_clientes(filas, res, usuario):
    hoja = HOJAS[0]
    for r in filas:
        datos = {k: r.get(k) or "" for k in ("nombre", "documento", "telefono", "correo", "direccion", "observaciones")}
        try:
            with transaction.atomic():
                _, que = guardar_cliente(datos)
            res.contar(hoja, que)
        except ValidationError as exc:
            for campo, msg in _mensajes(exc):
                res.error(hoja, r["_fila"], _titulo(hoja, campo), msg)


def _titulo(hoja, campo):
    for c in hoja.columnas:
        if c.clave == campo:
            return c.titulo
    return ""


def importar_personal(filas, res, usuario):
    hoja = next(h for h in HOJAS if h.clave == "personal")
    procesos = {normalizar(o.nombre): o for o in Operacion.objects.filter(activa=True)}
    vistos = set()
    for r in filas:
        nombre = r["nombre"]
        if normalizar(nombre) in vistos:
            res.error(hoja, r["_fila"], "Nombre", f"«{nombre}» está repetida en la hoja.")
            continue
        vistos.add(normalizar(nombre))

        habilidades = None
        if r.get("habilidades"):
            habilidades, malas = [], []
            for parte in re.split(r"[,;/\n]+", r["habilidades"]):
                if not parte.strip():
                    continue
                op = procesos.get(normalizar(parte))
                (habilidades.append(op) if op else malas.append(parte.strip()))
            if malas:
                res.error(hoja, r["_fila"], "Procesos que realiza",
                          f"No existen: {', '.join(malas)}. Usa los nombres de la hoja Listas.")
                continue

        horas = {}
        malo = False
        for d in range(7):
            v = r.get(f"dia_{d}")
            if v is not None and not (CERO <= v <= 24):
                res.error(hoja, r["_fila"], _titulo(hoja, f"dia_{d}"), "Las horas deben estar entre 0 y 24.")
                malo = True
            horas[d] = v
        if malo:
            continue

        with transaction.atomic():
            t = Trabajadora.objects.filter(nombre__iexact=nombre).order_by("id").first()
            nuevo = t is None
            if nuevo:
                t = Trabajadora(nombre=nombre)
            t.area = r["area"]
            t.activa = True if r.get("activa") is None else r["activa"]
            if r.get("observaciones"):
                t.observaciones = r["observaciones"]
            if r.get("sueldo_mensual") is not None:
                t.sueldo_mensual = r["sueldo_mensual"]
            if r.get("fecha_ingreso"):
                t.fecha_ingreso = r["fecha_ingreso"]
            t.save()
            if habilidades is not None:
                t.habilidades.set(habilidades)
            for d, v in horas.items():
                if v is None and not nuevo:
                    continue
                DisponibilidadSemanal.objects.update_or_create(
                    trabajadora=t, dia_semana=d, defaults={"horas_disponibles": v or CERO}
                )
        res.contar(hoja, "nuevos" if nuevo else "actualizados")


def importar_contratos(filas_c, filas_v, res, usuario, creados):
    from core.contratos.serializers import ContratoEntradaSerializer
    from core.services.contratos import crear_contrato

    hc = next(h for h in HOJAS if h.clave == "contratos")
    hv = next(h for h in HOJAS if h.clave == "vestidos")

    vestidos_por = defaultdict(list)
    for v in filas_v:
        vestidos_por[normalizar(v["numero"])].append(v)

    numeros_hoja = set()
    for r in filas_c:
        clave = normalizar(r["numero"])
        if clave in numeros_hoja:
            res.error(hc, r["_fila"], "N° contrato", f"El contrato {r['numero']} está repetido en la hoja.")
            continue
        numeros_hoja.add(clave)

    # Vestidos de contratos que no están en la hoja Contratos.
    for clave, vs in vestidos_por.items():
        if clave not in numeros_hoja:
            existe = Contrato.objects.filter(numero__iexact=vs[0]["numero"]).exists()
            for v in vs:
                if existe:
                    res.aviso(hv, v["_fila"], f"El contrato {v['numero']} ya está en el sistema; este vestido se omitió. Para agregarle vestidos, edítalo desde Comercial.")
                    res.contar(hv, "omitidos")
                else:
                    res.error(hv, v["_fila"], "N° contrato", f"El contrato {v['numero']} no está en la hoja Contratos.")

    tipos = {t.id: t for t in TipoVestido.objects.all()}
    procesados = set()
    for r in filas_c:
        clave = normalizar(r["numero"])
        if clave in procesados:
            continue
        procesados.add(clave)
        fila = r["_fila"]
        vs = vestidos_por.get(clave, [])

        if Contrato.objects.filter(numero__iexact=r["numero"]).exists():
            res.aviso(hc, fila, f"El contrato {r['numero']} ya está en el sistema; se omitió (con sus vestidos).")
            res.contar(hc, "omitidos")
            for _ in vs:
                res.contar(hv, "omitidos")
            continue
        if not vs:
            res.error(hc, fila, "N° contrato", f"El contrato {r['numero']} no tiene vestidos en la hoja Vestidos.")
            continue

        malos = False
        items = []
        for v in vs:
            if not v["precio"] or v["precio"] <= 0:
                res.error(hv, v["_fila"], "Precio (S/)", "El precio debe ser mayor a 0.")
                malos = True
            taller = v.get("taller") or ""
            if taller and not v.get("tipo_vestido"):
                res.error(hv, v["_fila"], "Tipo de vestido", "Indica el tipo de vestido para enviarlo al taller.")
                malos = True
            if not v.get("tipo_vestido") and not v.get("descripcion"):
                res.error(hv, v["_fila"], "Descripción", "Indica el tipo de vestido o una descripción.")
                malos = True
            if taller == "" and v.get("tipo_vestido") and v.get("taller") is None:
                # Tipo de vestido sin taller indicado: si es de tienda va a T, si no al A.
                tipo = tipos.get(v["tipo_vestido"])
                taller = "T" if tipo and not tipo.rutas.exclude(taller="T").exists() else "A"
            items.append({
                "tipo_vestido": v.get("tipo_vestido"),
                "taller": taller,
                "modalidad": v["modalidad"],
                "precio": v["precio"] or CERO,
                "precio_otros": v.get("precio_otros") or CERO,
                "descripcion": v.get("descripcion") or "",
                "observaciones": v.get("observaciones") or "",
            })
        if malos:
            continue

        datos = {
            "numero": r["numero"],
            "fecha_firma": r["fecha_firma"],
            "fecha_entrega": r["fecha_entrega"],
            "fecha_evento": r.get("fecha_evento"),
            "tipo_evento": r.get("tipo_evento") or Contrato.TipoEvento.NOVIA,
            "tipo_evento_detalle": r.get("tipo_evento_detalle") or "",
            "fecha_devolucion": r.get("fecha_devolucion"),
            "garantia": r.get("garantia") or CERO,
            "garantia_detalle": r.get("garantia_detalle") or "",
            "observaciones": r.get("observaciones") or "",
            "vestidos": items,
            # Solo para que el formulario de contratos lo acepte; la clienta
            # se resuelve abajo con la misma regla que la hoja Clientes.
            "datos_cliente": {"nombre": r["cliente_nombre"]},
        }
        datos = {k: v for k, v in datos.items() if v is not None}

        ser = ContratoEntradaSerializer(data=datos)
        if not ser.is_valid():
            _errores_serializer(res, hc, hv, fila, vs, ser.errors)
            continue

        try:
            with transaction.atomic():
                cliente, que = guardar_cliente({
                    "nombre": r["cliente_nombre"],
                    "documento": r.get("cliente_documento") or "",
                    "telefono": r.get("cliente_telefono") or "",
                })
                validos = dict(ser.validated_data)
                validos.pop("replanificar", None)
                validos.pop("datos_cliente", None)
                validos["cliente"] = cliente
                contrato, _ = crear_contrato(usuario=None, **validos)
                Contrato.objects.filter(pk=contrato.pk).update(creado_por=usuario)
                estado = r.get("estado") or Contrato.Estado.ACTIVO
                if estado != Contrato.Estado.ACTIVO:
                    cerrar_contrato_historico(contrato, estado)
        except ValidationError as exc:
            for campo, msg in _mensajes(exc):
                res.error(hc, fila, _titulo(hc, campo), msg)
            continue

        creados.append(contrato.pk)
        res.contar(hc, "nuevos")
        for _ in vs:
            res.contar(hv, "nuevos")
        if que == "nuevos":
            res.aviso(hc, fila, f"Se registró a la clienta {cliente.nombre}.")
        contrato.refresh_from_db()
        if contrato.estado == Contrato.Estado.ACTIVO and contrato.fecha_entrega < timezone.localdate():
            res.aviso(hc, fila, f"{contrato.numero}: la fecha de recojo ya pasó y está como Activo; quedará como atrasado.")
        atrasados = contrato.vestidos.filter(fecha_fin_estimada__gt=contrato.fecha_entrega).count()
        if contrato.estado == Contrato.Estado.ACTIVO and atrasados:
            res.aviso(hc, fila, f"{contrato.numero}: {atrasados} vestido(s) no llegan a tiempo con la capacidad actual del taller.")


def _errores_serializer(res, hc, hv, fila, vs, errores):
    for campo, msgs in errores.items():
        if campo == "vestidos" and isinstance(msgs, list):
            for i, e in enumerate(msgs):
                if isinstance(e, dict):
                    for c2, m2 in e.items():
                        res.error(hv, vs[i]["_fila"] if i < len(vs) else fila, _titulo(hv, c2), " ".join(map(str, m2)))
                elif e:
                    res.error(hc, fila, "", str(e))
        else:
            if isinstance(msgs, dict):
                msgs = [f"{k}: {' '.join(map(str, v))}" for k, v in msgs.items()]
            res.error(hc, fila, _titulo(hc, campo), " ".join(map(str, msgs)))


def cerrar_contrato_historico(contrato, estado):
    """Contratos ya entregados o cancelados: no ocupan el taller."""
    ReservaOperacion.objects.filter(contrato=contrato).delete()
    if estado == Contrato.Estado.ENTREGADO:
        fin = timezone.make_aware(datetime.combine(contrato.fecha_entrega, time(18, 0)))
        for v in contrato.vestidos.all():
            pasos = PasoVestido.objects.filter(vestido=v)
            pasos.update(estado=PasoVestido.Estado.COMPLETADO, completado_en=fin)
            v.estado = VestidoContrato.Estado.FINALIZADO
            v.paso_actual = max(pasos.count() - 1, 0)
            v.fecha_fin_estimada = contrato.fecha_entrega
            v.horas_sin_asignar = CERO
            v.save(update_fields=["estado", "paso_actual", "fecha_fin_estimada", "horas_sin_asignar"])
    Contrato.objects.filter(pk=contrato.pk).update(estado=estado)


def importar_pagos(filas, res, usuario):
    from core.services.contratos import CONCEPTOS_ADELANTO

    hoja = next(h for h in HOJAS if h.clave == "pagos")
    for r in filas:
        fila = r["_fila"]
        contrato = Contrato.objects.filter(numero__iexact=r["numero"]).first()
        if contrato is None:
            res.error(hoja, fila, "N° contrato", f"El contrato {r['numero']} no existe en el sistema ni en la hoja Contratos.")
            continue
        if r["importe"] <= 0:
            res.error(hoja, fila, "Importe (S/)", "El importe debe ser mayor a 0.")
            continue

        iguales = Pago.objects.filter(contrato=contrato, confirmado=True)
        if r.get("referencia"):
            iguales = iguales.filter(referencia__iexact=r["referencia"])
        else:
            iguales = iguales.filter(fecha=r["fecha"], importe=r["importe"])
        if iguales.exists():
            res.aviso(hoja, fila, f"Este pago de {contrato.numero} ya estaba registrado; se omitió.")
            res.contar(hoja, "omitidos")
            continue

        pagado = Pago.objects.filter(contrato=contrato, confirmado=True).aggregate(t=Sum("importe"))["t"] or CERO
        if pagado + r["importe"] > contrato.precio_total:
            res.error(hoja, fila, "Importe (S/)",
                      f"Con este pago, {contrato.numero} quedaría pagado S/ {pagado + r['importe']:,.2f} "
                      f"y el contrato es de S/ {contrato.precio_total:,.2f}.")
            continue

        usados = set(Pago.objects.filter(contrato=contrato, orden_adelanto__isnull=False).values_list("orden_adelanto", flat=True))
        orden = next((o for o in (1, 2, 3) if o not in usados), None)
        Pago.objects.create(
            contrato=contrato,
            fecha=r["fecha"],
            importe=r["importe"],
            metodo=r["metodo"],
            concepto=(r.get("concepto") or CONCEPTOS_ADELANTO.get(orden, "Pago de contrato"))[:150],
            referencia=(r.get("referencia") or "")[:100],
            observaciones=r.get("observaciones") or "",
            orden_adelanto=orden,
            confirmado=True,
            registrado_por=usuario,
            origen=Pago.Origen.IMPORTACION,
        )
        res.contar(hoja, "nuevos")


def importar_gastos(filas, res, usuario):
    hoja = next(h for h in HOJAS if h.clave == "gastos")
    categorias = {c.id: c for c in CategoriaFinanciera.objects.filter(tipo=CategoriaFinanciera.Tipo.EGRESO)}
    for r in filas:
        fila = r["_fila"]
        if r["importe"] <= 0:
            res.error(hoja, fila, "Importe (S/)", "El importe debe ser mayor a 0.")
            continue
        if Gasto.objects.filter(fecha=r["fecha"], concepto__iexact=r["concepto"], importe=r["importe"]).exists():
            res.aviso(hoja, fila, f"El gasto «{r['concepto']}» del {r['fecha']:%d/%m/%Y} ya estaba registrado; se omitió.")
            res.contar(hoja, "omitidos")
            continue
        estado = r.get("estado") or Gasto.Estado.PAGADO
        Gasto.objects.create(
            fecha=r["fecha"],
            concepto=r["concepto"][:200],
            categoria=categorias[r["categoria"]],
            importe=r["importe"],
            metodo=r.get("metodo") or Pago.Metodo.EFECTIVO,
            proveedor=(r.get("proveedor") or "")[:150],
            comprobante=(r.get("comprobante") or "")[:60],
            estado=estado,
            vence=r.get("vence") if estado == Gasto.Estado.PENDIENTE else None,
            observaciones=r.get("observaciones") or "",
            registrado_por=usuario,
        )
        res.contar(hoja, "nuevos")


# ------------------------------------------------------------------
# Entrada principal
# ------------------------------------------------------------------

def procesar(archivo, usuario=None, guardar=False):
    res = Resultado()
    datos = leer_libro(archivo, res)
    if not datos and not res.errores:
        raise ValidationError(
            "El archivo no tiene ninguna hoja de la plantilla (Clientes, Personal, Contratos, "
            "Vestidos, Pagos o Gastos). Descarga la plantilla y copia tus datos en ella."
        )
    if datos and not any(datos.values()) and not res.errores:
        raise ValidationError("Las hojas están vacías. Escribe tus datos desde la fila 3.")

    if "vestidos" in datos and "contratos" not in datos:
        hv = next(h for h in HOJAS if h.clave == "vestidos")
        for v in datos["vestidos"]:
            if Contrato.objects.filter(numero__iexact=v["numero"]).exists():
                res.aviso(hv, v["_fila"], f"El contrato {v['numero']} ya está en el sistema; este vestido se omitió.")
                res.contar(hv, "omitidos")
            else:
                res.error(hv, v["_fila"], "N° contrato", "Los vestidos deben subirse junto con la hoja Contratos.")

    creados = []
    with transaction.atomic():
        if datos.get("clientes"):
            importar_clientes(datos["clientes"], res, usuario)
        if datos.get("personal"):
            importar_personal(datos["personal"], res, usuario)
        if datos.get("contratos"):
            importar_contratos(datos["contratos"], datos.get("vestidos", []), res, usuario, creados)
        if datos.get("pagos"):
            importar_pagos(datos["pagos"], res, usuario)
        if datos.get("gastos"):
            importar_gastos(datos["gastos"], res, usuario)

        if res.errores or not guardar:
            transaction.set_rollback(True)
        elif creados:
            # Una sola notificación en lugar de una por contrato.
            Notificacion.objects.filter(contrato_id__in=creados).delete()
            from core.services.notificaciones import ROL_JEFA, notificar, usuarios_con_rol

            activos = Contrato.objects.filter(pk__in=creados, estado=Contrato.Estado.ACTIVO).count()
            if activos:
                notificar(
                    usuarios_con_rol(ROL_JEFA),
                    "CONTRATO",
                    f"Se cargaron {activos} contrato(s) al sistema",
                    "TI importó contratos desde Excel. Ya están programados en el taller.",
                )

    return res.como_dict(guardar)
