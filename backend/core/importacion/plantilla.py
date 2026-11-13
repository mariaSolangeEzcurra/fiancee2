"""Genera el Excel de plantilla (con instrucciones y listas desplegables)."""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter, quote_sheetname
from openpyxl.worksheet.datavalidation import DataValidation

from .esquema import HOJAS

COCOA = "4A3428"
GOLD = "9A7640"
CREAM = "F4EDE3"
BLUSH = "F5E6E2"
GRIS = "76604F"
FILAS_CON_FORMATO = 1000

titulo_font = Font(name="Calibri", size=16, bold=True, color=COCOA)
sub_font = Font(name="Calibri", size=11, color=GRIS)
enc_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
enc_fill = PatternFill("solid", fgColor=COCOA)
enc_obl_fill = PatternFill("solid", fgColor=GOLD)
ayuda_font = Font(name="Calibri", size=9, italic=True, color=GRIS)
ayuda_fill = PatternFill("solid", fgColor=CREAM)
borde = Border(bottom=Side(style="thin", color="E7DCCE"))
envolver = Alignment(wrap_text=True, vertical="top")


def _hoja_listas(wb, hojas):
    """Hoja oculta con los valores de las listas desplegables."""
    ws = wb.create_sheet("Listas")
    ws["A1"] = "Valores válidos para las columnas con lista"
    ws["A1"].font = titulo_font
    ws["A2"] = "No borres esta hoja: las listas desplegables salen de aquí."
    ws["A2"].font = sub_font

    rangos = {}
    col = 1
    vistos = {}
    for hoja in hojas:
        for c in hoja.columnas:
            valores = c.etiquetas()
            if not valores:
                continue
            clave = (c.titulo, tuple(valores))
            if clave in vistos:
                rangos[(hoja.clave, c.clave)] = vistos[clave]
                continue
            letra = get_column_letter(col)
            ws.cell(row=4, column=col, value=c.titulo).font = Font(bold=True, color="FFFFFF")
            ws.cell(row=4, column=col).fill = enc_fill
            for i, v in enumerate(valores, start=5):
                ws.cell(row=i, column=col, value=v)
            ws.column_dimensions[letra].width = max(16, min(40, max(len(str(v)) for v in valores) + 4))
            ref = f"{quote_sheetname('Listas')}!${letra}$5:${letra}${4 + len(valores)}"
            rangos[(hoja.clave, c.clave)] = ref
            vistos[clave] = ref
            col += 1
    return rangos


def _instrucciones(wb, hojas):
    ws = wb.active
    ws.title = "Instrucciones"
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 14
    ws.column_dimensions["C"].width = 62
    ws.column_dimensions["D"].width = 26

    ws["A1"] = "Fiancée · Plantilla para cargar datos"
    ws["A1"].font = Font(size=20, bold=True, color=COCOA)
    pasos = [
        "1. Llena solo las hojas que necesites. Las demás puedes dejarlas vacías o borrarlas.",
        "2. Empieza a escribir desde la fila 3 de cada hoja (la fila 2 es solo ayuda, puedes borrarla).",
        "3. Las columnas con * (en dorado) son obligatorias.",
        "4. Fechas en formato dd/mm/aaaa. Montos en soles sin símbolo (ej. 2500 o 2500.50).",
        "5. En las columnas con lista, elige el valor del desplegable.",
        "6. No cambies los nombres de las hojas ni de los encabezados.",
        "7. Sube el archivo en Fiancée → TI → Importar datos. Primero se revisa y te muestra los errores; nada se guarda hasta que confirmes.",
        "8. Si vuelves a subir el mismo archivo, lo que ya está en el sistema se omite (no se duplica).",
    ]
    fila = 3
    for p in pasos:
        ws.cell(row=fila, column=1, value=p).font = Font(size=11, color=COCOA)
        ws.merge_cells(start_row=fila, start_column=1, end_row=fila, end_column=4)
        fila += 1

    fila += 1
    ws.cell(row=fila, column=1, value="Orden en que se cargan: Clientes → Personal → Contratos → Vestidos → Pagos → Gastos").font = Font(bold=True, color=GOLD)
    ws.merge_cells(start_row=fila, start_column=1, end_row=fila, end_column=4)
    fila += 2

    for hoja in hojas:
        ws.cell(row=fila, column=1, value=f"Hoja «{hoja.titulo}»").font = Font(size=14, bold=True, color=COCOA)
        fila += 1
        ws.cell(row=fila, column=1, value=hoja.descripcion).font = sub_font
        ws.merge_cells(start_row=fila, start_column=1, end_row=fila, end_column=4)
        fila += 1
        for i, t in enumerate(["Columna", "¿Obligatorio?", "Qué poner", "Ejemplo"], start=1):
            celda = ws.cell(row=fila, column=i, value=t)
            celda.font = enc_font
            celda.fill = enc_fill
        fila += 1
        for c in hoja.columnas:
            ayuda = c.ayuda
            if c.tipo == "opcion" or c.tipo == "sino":
                ops = c.etiquetas()
                if ops and len(ops) <= 8:
                    ayuda = (ayuda + ". " if ayuda else "") + "Opciones: " + ", ".join(ops)
                elif ops:
                    ayuda = (ayuda + ". " if ayuda else "") + "Elige de la lista"
            valores = [c.titulo, "Sí" if c.obligatorio else "No", ayuda or "—", c.ejemplo or ""]
            for i, v in enumerate(valores, start=1):
                celda = ws.cell(row=fila, column=i, value=v)
                celda.alignment = envolver
                celda.border = borde
                if i == 2 and c.obligatorio:
                    celda.font = Font(bold=True, color=GOLD)
            fila += 1
        fila += 1


def _hoja_datos(wb, hoja, rangos):
    ws = wb.create_sheet(hoja.titulo)
    ws.freeze_panes = "A3"
    for i, c in enumerate(hoja.columnas, start=1):
        letra = get_column_letter(i)
        celda = ws.cell(row=1, column=i, value=c.encabezado)
        celda.font = enc_font
        celda.fill = enc_obl_fill if c.obligatorio else enc_fill
        celda.alignment = Alignment(vertical="center", wrap_text=True)
        celda.comment = Comment(c.nota() + (f"\nEjemplo: {c.ejemplo}" if c.ejemplo else ""), "Fiancée")

        ayuda = c.nota()
        if c.ejemplo:
            ayuda += f". Ej: {c.ejemplo}"
        a = ws.cell(row=2, column=i, value=ayuda)
        a.font = ayuda_font
        a.fill = ayuda_fill
        a.alignment = envolver
        ws.column_dimensions[letra].width = c.ancho

        rango_celdas = f"{letra}3:{letra}{FILAS_CON_FORMATO}"
        if c.tipo == "fecha":
            for f in range(3, 203):
                ws.cell(row=f, column=i).number_format = "DD/MM/YYYY"
        elif c.tipo == "numero":
            for f in range(3, 203):
                ws.cell(row=f, column=i).number_format = "#,##0.00" if "S/" in c.titulo else "0.##"
        elif c.tipo == "texto":
            # Texto: así Excel no borra los ceros del DNI o del teléfono.
            for f in range(3, 203):
                ws.cell(row=f, column=i).number_format = "@"

        if (hoja.clave, c.clave) in rangos and c.tipo in ("opcion", "sino"):
            dv = DataValidation(
                type="list", formula1=rangos[(hoja.clave, c.clave)], allow_blank=True,
                showErrorMessage=True, errorStyle="warning",
                errorTitle="Valor fuera de la lista",
                error="Elige un valor de la lista desplegable.",
            )
            ws.add_data_validation(dv)
            dv.add(rango_celdas)
        elif c.tipo == "fecha":
            dv = DataValidation(
                type="date", operator="greaterThan", formula1="DATE(2000,1,1)", allow_blank=True,
                showErrorMessage=True, errorStyle="warning",
                errorTitle="Fecha", error="Escribe la fecha como dd/mm/aaaa.",
            )
            ws.add_data_validation(dv)
            dv.add(rango_celdas)
        elif c.tipo == "numero":
            dv = DataValidation(
                type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
                showErrorMessage=True, errorStyle="warning",
                errorTitle="Número", error="Escribe solo el número, sin S/ ni letras.",
            )
            ws.add_data_validation(dv)
            dv.add(rango_celdas)

    ws.row_dimensions[1].height = 32
    ws.row_dimensions[2].height = 48


def generar_plantilla(claves=None):
    hojas = [h for h in HOJAS if not claves or h.clave in claves]
    wb = Workbook()
    _instrucciones(wb, hojas)
    rangos = _hoja_listas(wb, hojas)
    for hoja in hojas:
        _hoja_datos(wb, hoja, rangos)
    # Listas al final y oculta-visible (se deja visible para consultar procesos/categorías).
    listas = wb["Listas"]
    wb.move_sheet(listas, offset=len(wb.sheetnames))
    salida = BytesIO()
    wb.save(salida)
    return salida.getvalue()
