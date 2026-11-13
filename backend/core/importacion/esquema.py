"""
Estructura de las plantillas Excel que usa el área de TI para cargar
la información del negocio al sistema.

Cada hoja tiene sus columnas. El orden de las hojas es el orden en que
se importan (primero lo que otras hojas necesitan).
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Callable, Optional

from core.models import (
    CategoriaFinanciera,
    Contrato,
    Operacion,
    Pago,
    TipoVestido,
    Trabajadora,
    VestidoContrato,
)


def normalizar(texto) -> str:
    """minúsculas, sin tildes, sin espacios dobles ni asteriscos."""
    texto = str(texto or "").replace("*", " ").strip().lower()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = re.sub(r"[°º.]", "", texto)
    return re.sub(r"\s+", " ", texto).strip()


@dataclass
class Columna:
    titulo: str
    clave: str
    tipo: str = "texto"  # texto | numero | fecha | opcion | sino | lista
    obligatorio: bool = False
    ayuda: str = ""
    ejemplo: str = ""
    # Para tipo "opcion": lista de (valor_interno, etiqueta, [alias...]).
    opciones: Optional[Callable[[], list]] = None
    # Para "lista": de dónde salen los valores válidos (solo informativo).
    valores: Optional[Callable[[], list]] = None
    ancho: int = 18
    alias: list = field(default_factory=list)

    @property
    def encabezado(self):
        return f"{self.titulo} *" if self.obligatorio else self.titulo

    def nota(self):
        partes = ["Obligatorio" if self.obligatorio else "Opcional"]
        if self.ayuda:
            partes.append(self.ayuda)
        return ". ".join(partes)

    def etiquetas(self):
        if self.opciones:
            return [o[1] for o in self.opciones()]
        if self.valores:
            return list(self.valores())
        return []


@dataclass
class Hoja:
    clave: str
    titulo: str
    descripcion: str
    columnas: list
    icono: str = "file"

    def columna(self, clave):
        return next(c for c in self.columnas if c.clave == clave)


# ------------------------------------------------------------------
# Opciones (se leen de la base de datos para que siempre estén al día)
# ------------------------------------------------------------------

SI_NO = lambda: [(True, "Sí", ["si", "x", "1", "true", "activa", "activo"]), (False, "No", ["0", "false", "inactiva", "inactivo"])]


def op_areas():
    return [(v, l, []) for v, l in Trabajadora.Area.choices]


def op_tipos_evento():
    return [
        (Contrato.TipoEvento.NOVIA, "Novia", ["boda", "matrimonio"]),
        (Contrato.TipoEvento.QUINCEANERA, "Quinceañera", ["quince", "15 anos", "xv"]),
        (Contrato.TipoEvento.OTRO, "Otros", ["otro"]),
    ]


def op_estados_contrato():
    return [
        (Contrato.Estado.ACTIVO, "Activo", ["en curso", "pendiente", "en produccion"]),
        (Contrato.Estado.ENTREGADO, "Entregado", ["terminado", "finalizado", "cerrado"]),
        (Contrato.Estado.CANCELADO, "Cancelado", ["anulado"]),
    ]


def op_tipos_vestido():
    return [(t.id, t.nombre, []) for t in TipoVestido.objects.filter(activo=True).order_by("nombre")]


def op_talleres():
    return [
        ("A", "Taller A", ["a", "confeccion desde cero", "desde cero"]),
        ("C", "Taller C", ["c", "compra y modificacion"]),
        ("T", "Tienda", ["t", "taller t", "stock", "vestido en stock"]),
        ("", "Sin taller", ["no", "ninguno", "no pasa por taller", "-"]),
    ]


def op_modalidad():
    return [
        (VestidoContrato.Modalidad.VENTA, "Venta", ["vendido", "compra"]),
        (VestidoContrato.Modalidad.ALQUILER, "Alquiler", ["alquilado", "renta"]),
    ]


def op_metodos():
    return [
        (Pago.Metodo.EFECTIVO, "Efectivo", ["cash", "contado"]),
        (Pago.Metodo.TRANSFERENCIA, "Transferencia", ["deposito", "yape", "plin", "bcp", "interbank", "bbva"]),
        (Pago.Metodo.TARJETA, "Tarjeta", ["pos", "visa", "mastercard", "credito", "debito"]),
        (Pago.Metodo.OTRO, "Otro", []),
    ]


def op_categorias_gasto():
    return [
        (c.id, c.nombre, [])
        for c in CategoriaFinanciera.objects.filter(
            tipo=CategoriaFinanciera.Tipo.EGRESO, activa=True
        ).order_by("nombre")
    ]


def op_estado_gasto():
    return [("PAGADO", "Pagado", ["cancelado", "pagada"]), ("PENDIENTE", "Por pagar", ["pendiente", "debe"])]


def valores_procesos():
    return list(Operacion.objects.filter(activa=True).order_by("nombre").values_list("nombre", flat=True))


DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

# ------------------------------------------------------------------
# Hojas
# ------------------------------------------------------------------

HOJAS = [
    Hoja(
        "clientes", "Clientes",
        "Datos de las clientas. Si el DNI ya existe, se actualizan sus datos.",
        [
            Columna("Nombre", "nombre", obligatorio=True, ayuda="Nombre y apellidos", ejemplo="María Quispe Torres", ancho=28),
            Columna("DNI", "documento", ayuda="DNI o carné de extranjería. Sirve para no duplicar clientas", ejemplo="45879632", ancho=14),
            Columna("Teléfono", "telefono", ayuda="Celular, de preferencia con WhatsApp", ejemplo="987654321", ancho=14, alias=["celular", "telefono/celular"]),
            Columna("Correo", "correo", ejemplo="maria@gmail.com", ancho=24, alias=["email", "correo electronico"]),
            Columna("Dirección", "direccion", ejemplo="Av. Ejército 123, Yanahuara", ancho=28),
            Columna("Observaciones", "observaciones", ancho=30),
        ],
        icono="users",
    ),
    Hoja(
        "personal", "Personal",
        "Trabajadoras del taller, su área, lo que saben hacer y sus horas por día.",
        [
            Columna("Nombre", "nombre", obligatorio=True, ayuda="Si ya existe alguien con el mismo nombre, se actualiza", ejemplo="Rosa Mamani", ancho=24),
            Columna("Área", "area", tipo="opcion", obligatorio=True, opciones=op_areas, ejemplo="Confección", ancho=16),
            Columna("Activa", "activa", tipo="sino", opciones=SI_NO, ayuda="Sí o No. Vacío = Sí", ejemplo="Sí", ancho=10),
            Columna("Procesos que realiza", "habilidades", tipo="lista", valores=valores_procesos,
                    ayuda="Separados por coma. Mira la hoja Listas", ejemplo="corte de tela, confección, entalle", ancho=36,
                    alias=["habilidades", "procesos"]),
            *[
                Columna(d, f"dia_{i}", tipo="numero", ayuda="Horas que trabaja ese día (0 = descansa)",
                        ejemplo="8" if i < 5 else ("4" if i == 5 else "0"), ancho=10)
                for i, d in enumerate(DIAS)
            ],
            Columna("Sueldo mensual (S/)", "sueldo_mensual", tipo="numero", ayuda="Solo lo ve gerencia. Sirve para calcular la rentabilidad", ejemplo="1300", ancho=14, alias=["sueldo"]),
            Columna("Fecha de ingreso", "fecha_ingreso", tipo="fecha", ayuda="Formato dd/mm/aaaa", ejemplo="01/03/2025", ancho=14),
            Columna("Observaciones", "observaciones", ancho=30),
        ],
        icono="staff",
    ),
    Hoja(
        "contratos", "Contratos",
        "Un contrato por fila. Sus vestidos van en la hoja Vestidos con el mismo N° de contrato.",
        [
            Columna("N° contrato", "numero", obligatorio=True, ayuda="El número que usan ustedes. Debe repetirse en Vestidos y Pagos", ejemplo="CT-2026-0101", ancho=16, alias=["numero", "nro contrato", "contrato"]),
            Columna("Nombre de la clienta", "cliente_nombre", obligatorio=True, ejemplo="María Quispe Torres", ancho=28, alias=["clienta", "cliente", "nombre clienta"]),
            Columna("DNI de la clienta", "cliente_documento", ayuda="Si coincide con una clienta registrada, se usa esa", ejemplo="45879632", ancho=14, alias=["dni", "dni clienta"]),
            Columna("Teléfono de la clienta", "cliente_telefono", ejemplo="987654321", ancho=14, alias=["telefono", "celular"]),
            Columna("Fecha del contrato", "fecha_firma", tipo="fecha", obligatorio=True, ayuda="Formato dd/mm/aaaa", ejemplo="05/10/2026", ancho=14, alias=["fecha firma", "fecha"]),
            Columna("Fecha de recojo", "fecha_entrega", tipo="fecha", obligatorio=True, ayuda="Día en que la clienta recoge el vestido (fecha límite del taller)", ejemplo="20/12/2026", ancho=14, alias=["fecha entrega", "fecha de entrega"]),
            Columna("Fecha del evento", "fecha_evento", tipo="fecha", ayuda="No puede ser antes del recojo", ejemplo="27/12/2026", ancho=14),
            Columna("Tipo de evento", "tipo_evento", tipo="opcion", opciones=op_tipos_evento, ayuda="Vacío = Novia", ejemplo="Novia", ancho=14),
            Columna("Detalle del evento", "tipo_evento_detalle", ayuda="Obligatorio si el tipo es Otros", ejemplo="", ancho=20),
            Columna("Fecha de devolución", "fecha_devolucion", tipo="fecha", ayuda="Solo para alquileres", ejemplo="", ancho=14),
            Columna("Garantía (S/)", "garantia", tipo="numero", ejemplo="300", ancho=12),
            Columna("Detalle de la garantía", "garantia_detalle", ejemplo="DNI en custodia", ancho=20),
            Columna("Estado", "estado", tipo="opcion", opciones=op_estados_contrato,
                    ayuda="Activo, Entregado o Cancelado. Vacío = Activo. Solo los activos se programan en el taller", ejemplo="Activo", ancho=12),
            Columna("Observaciones", "observaciones", ancho=30),
        ],
        icono="contract",
    ),
    Hoja(
        "vestidos", "Vestidos",
        "Uno por fila. Un contrato puede tener varios vestidos (varias filas con el mismo N° de contrato).",
        [
            Columna("N° contrato", "numero", obligatorio=True, ayuda="Debe estar en la hoja Contratos", ejemplo="CT-2026-0101", ancho=16, alias=["numero", "nro contrato", "contrato"]),
            Columna("Tipo de vestido", "tipo_vestido", tipo="opcion", opciones=op_tipos_vestido, ayuda="Del catálogo. Obligatorio si pasa por el taller", ejemplo="Sirena", ancho=18, alias=["modelo", "tipo"]),
            Columna("Taller", "taller", tipo="opcion", opciones=op_talleres,
                    ayuda="Taller A (desde cero), Taller C (compra y modificación), Tienda o Sin taller", ejemplo="Taller A", ancho=14),
            Columna("Modalidad", "modalidad", tipo="opcion", obligatorio=True, opciones=op_modalidad, ejemplo="Venta", ancho=12),
            Columna("Precio (S/)", "precio", tipo="numero", obligatorio=True, ayuda="Mayor a 0", ejemplo="2500", ancho=12, alias=["precio"]),
            Columna("Otros cargos (S/)", "precio_otros", tipo="numero", ayuda="Accesorios, velo, etc.", ejemplo="150", ancho=14, alias=["otros", "otros cargos"]),
            Columna("Descripción", "descripcion", ayuda="Obligatoria si no tiene tipo de vestido", ejemplo="Escote corazón, cola larga", ancho=28),
            Columna("Observaciones", "observaciones", ancho=30),
        ],
        icono="dress",
    ),
    Hoja(
        "pagos", "Pagos",
        "Adelantos y pagos que ya hicieron las clientas. Cuentan como ingresos en Finanzas.",
        [
            Columna("N° contrato", "numero", obligatorio=True, ayuda="Contrato de este archivo o uno que ya esté en el sistema", ejemplo="CT-2026-0101", ancho=16, alias=["numero", "nro contrato", "contrato"]),
            Columna("Fecha", "fecha", tipo="fecha", obligatorio=True, ayuda="Formato dd/mm/aaaa", ejemplo="05/10/2026", ancho=14),
            Columna("Importe (S/)", "importe", tipo="numero", obligatorio=True, ejemplo="1000", ancho=12, alias=["monto", "importe"]),
            Columna("Método", "metodo", tipo="opcion", obligatorio=True, opciones=op_metodos, ayuda="Yape y Plin van como Transferencia", ejemplo="Transferencia", ancho=14, alias=["metodo de pago", "forma de pago"]),
            Columna("Concepto", "concepto", ayuda="Vacío = Primer pago, Segundo pago…", ejemplo="Adelanto", ancho=18),
            Columna("N° de operación", "referencia", ayuda="Para no registrar dos veces el mismo pago", ejemplo="00123456", ancho=16, alias=["referencia", "nro operacion", "operacion"]),
            Columna("Observaciones", "observaciones", ancho=30),
        ],
        icono="payment",
    ),
    Hoja(
        "gastos", "Gastos",
        "Gastos del negocio (telas, alquiler, luz…). Los pagados cuentan como egresos en Finanzas.",
        [
            Columna("Fecha", "fecha", tipo="fecha", obligatorio=True, ayuda="Formato dd/mm/aaaa", ejemplo="03/10/2026", ancho=14),
            Columna("Concepto", "concepto", obligatorio=True, ejemplo="Compra de encaje francés", ancho=28, alias=["descripcion", "detalle"]),
            Columna("Categoría", "categoria", tipo="opcion", obligatorio=True, opciones=op_categorias_gasto, ayuda="Mira la hoja Listas", ejemplo="Telas y encajes", ancho=24),
            Columna("Importe (S/)", "importe", tipo="numero", obligatorio=True, ejemplo="450", ancho=12, alias=["monto", "importe"]),
            Columna("Método", "metodo", tipo="opcion", opciones=op_metodos, ayuda="Vacío = Efectivo", ejemplo="Efectivo", ancho=14, alias=["metodo de pago", "forma de pago"]),
            Columna("Proveedor", "proveedor", ejemplo="Textiles Arequipa", ancho=20),
            Columna("Comprobante", "comprobante", ayuda="Boleta o factura", ejemplo="B001-4589", ancho=14),
            Columna("Estado", "estado", tipo="opcion", opciones=op_estado_gasto, ayuda="Pagado o Por pagar. Vacío = Pagado", ejemplo="Pagado", ancho=12),
            Columna("Vence", "vence", tipo="fecha", ayuda="Solo si está por pagar", ejemplo="", ancho=14),
            Columna("Observaciones", "observaciones", ancho=30),
        ],
        icono="expense",
    ),
]

HOJAS_POR_CLAVE = {h.clave: h for h in HOJAS}


def buscar_hoja(nombre_hoja):
    n = normalizar(nombre_hoja)
    for hoja in HOJAS:
        if n in (hoja.clave, normalizar(hoja.titulo)):
            return hoja
    return None


def esquema_publico():
    """Descripción de las hojas para mostrarla en la pantalla de TI."""
    return [
        {
            "clave": h.clave,
            "titulo": h.titulo,
            "descripcion": h.descripcion,
            "icono": h.icono,
            "columnas": [
                {
                    "titulo": c.titulo,
                    "obligatorio": c.obligatorio,
                    "tipo": c.tipo,
                    "ayuda": c.ayuda,
                    "ejemplo": c.ejemplo,
                    "opciones": c.etiquetas() if c.tipo in ("opcion", "lista", "sino") else [],
                }
                for c in h.columnas
            ],
        }
        for h in HOJAS
    ]
