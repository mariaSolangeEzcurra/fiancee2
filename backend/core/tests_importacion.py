import io
from datetime import date

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient

from core.importacion.importador import procesar
from core.importacion.plantilla import generar_plantilla
from core.models import CategoriaFinanciera, Cliente, Contrato, Gasto, ImportacionDatos, Pago, Trabajadora


def libro(**hojas):
    wb = load_workbook(io.BytesIO(generar_plantilla()))
    for nombre, filas in hojas.items():
        ws = wb[nombre]
        for i, fila in enumerate(filas, start=3):
            for j, v in enumerate(fila, start=1):
                ws.cell(row=i, column=j, value=v)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


CONTRATO = ["T-1", "Lucía Ramos", "70112233", "", date(2026, 11, 1), date(2027, 2, 10), date(2027, 2, 14), "Novia", "", None, 0, "", "", ""]
VESTIDO = ["T-1", "Sirena", "Taller A", "Venta", 3000, 0, "", ""]


class ImportacionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ti = get_user_model().objects.create_user("ti", password="x", rol="ti")
        cls.ger = get_user_model().objects.create_user("ger", password="x", rol="gerencia")
        CategoriaFinanciera.objects.get_or_create(nombre="Telas y encajes", defaults={"tipo": "EGRESO"})

    def _catalogo(self):
        from core.models import Operacion, PlantillaOperacion, RutaProduccion, TipoVestido
        t, _ = TipoVestido.objects.get_or_create(nombre="Sirena")
        op, _ = Operacion.objects.get_or_create(nombre="confección", defaults={"area_responsable": "CONFECCION"})
        r, _ = RutaProduccion.objects.get_or_create(tipo_vestido=t, taller="A")
        PlantillaOperacion.objects.get_or_create(ruta=r, operacion=op, defaults={"orden": 1, "horas_estimadas": 10})

    def test_revisar_no_guarda_y_guardar_si(self):
        self._catalogo()
        archivo = libro(Contratos=[CONTRATO], Vestidos=[VESTIDO], Pagos=[["T-1", "05/11/2026", 1000, "Yape", "", "OP1", ""]])
        r = procesar(archivo, self.ti, guardar=False)
        self.assertTrue(r["ok"], r["errores"])
        self.assertFalse(Contrato.objects.filter(numero="T-1").exists())
        archivo.seek(0)
        r = procesar(archivo, self.ti, guardar=True)
        self.assertTrue(r["guardado"])
        c = Contrato.objects.get(numero="T-1")
        self.assertEqual(c.precio_total, 3000)
        self.assertEqual(Pago.objects.get(contrato=c).metodo, "TRANSFERENCIA")
        # Volver a subir no duplica.
        archivo.seek(0)
        r = procesar(archivo, self.ti, guardar=True)
        self.assertEqual(Contrato.objects.filter(numero="T-1").count(), 1)
        self.assertEqual(Pago.objects.filter(contrato=c).count(), 1)

    def test_errores_claros_y_nada_se_guarda(self):
        self._catalogo()
        malo = list(CONTRATO)
        malo[6] = date(2027, 1, 1)  # evento antes del recojo
        archivo = libro(
            Clientes=[["Buena", "111", "", "", "", ""]],
            Contratos=[malo],
            Vestidos=[VESTIDO, ["X-9", "Sirena", "A", "Venta", 10, 0, "", ""]],
            Gastos=[["32/13/2026", "Algo", "Categoría rara", "abc", "", "", "", "", "", ""]],
            Personal=[["Rosa", "Confección", "Sí", "volar", 8, 8, 8, 8, 8, 0, 0, ""]],
        )
        r = procesar(archivo, self.ti, guardar=True)
        self.assertFalse(r["ok"])
        textos = " | ".join(f"{e['hoja']}:{e['columna']}:{e['mensaje']}" for e in r["errores"])
        self.assertIn("Fecha del evento", textos)
        self.assertIn("X-9 no está en la hoja Contratos", textos)
        self.assertIn("no es una fecha válida", textos)
        self.assertIn("Categoría rara", textos)
        self.assertIn("no es un número válido", textos)
        self.assertIn("volar", textos)
        self.assertFalse(Cliente.objects.filter(nombre="Buena").exists())
        self.assertFalse(Trabajadora.objects.filter(nombre="Rosa").exists())

    def test_pago_mayor_al_total(self):
        self._catalogo()
        archivo = libro(Contratos=[CONTRATO], Vestidos=[VESTIDO], Pagos=[["T-1", "05/11/2026", 5000, "Efectivo", "", "", ""]])
        r = procesar(archivo, self.ti, guardar=True)
        self.assertFalse(r["ok"])
        self.assertIn("S/ 3,000.00", r["errores"][0]["mensaje"])

    def test_personal_y_gastos(self):
        archivo = libro(
            Personal=[["Rosa Nueva", "Bordado", "", "", 8, 8, 8, 8, 8, 4, 0, "1,300", "01/03/2025", ""]],
            Gastos=[[date(2026, 11, 3), "Encaje", "Telas y encajes", "1,250.50", "", "", "", "Por pagar", "30/11/2026", ""]],
        )
        r = procesar(archivo, self.ti, guardar=True)
        self.assertTrue(r["guardado"], r["errores"])
        t = Trabajadora.objects.get(nombre="Rosa Nueva")
        self.assertEqual(t.area, "BORDADO")
        self.assertEqual(t.horarios.get(dia_semana=5).horas_disponibles, 4)
        self.assertEqual(t.sueldo_mensual, 1300)
        self.assertEqual(str(t.fecha_ingreso), "2025-03-01")
        g = Gasto.objects.get(concepto="Encaje")
        self.assertEqual(str(g.importe), "1250.50")
        self.assertEqual(g.estado, "PENDIENTE")

    def test_api_solo_ti(self):
        api = APIClient()
        api.force_authenticate(self.ger)
        self.assertEqual(api.get("/api/core/ti/resumen/").status_code, 403)
        api.force_authenticate(self.ti)
        self.assertEqual(api.get("/api/core/ti/resumen/").status_code, 200)
        resp = api.get("/api/core/ti/plantilla/?hojas=pagos")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("Pagos", load_workbook(io.BytesIO(resp.content)).sheetnames)
        archivo = SimpleUploadedFile("datos.xlsx", libro(Clientes=[["Ana", "999", "", "", "", ""]]).getvalue())
        resp = api.post("/api/core/ti/importar/", {"archivo": archivo, "guardar": "1"}, format="multipart")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["guardado"])
        self.assertEqual(ImportacionDatos.objects.count(), 1)
        resp = api.post("/api/core/ti/importar/", {"archivo": SimpleUploadedFile("x.csv", b"a,b")}, format="multipart")
        self.assertEqual(resp.status_code, 400)


class AnalisisGerenciaTests(TestCase):
    def test_rentabilidad_y_tiempos_responden(self):
        ger = get_user_model().objects.create_user("ger2", password="x", rol="gerencia")
        api = APIClient()
        api.force_authenticate(ger)
        r = api.get("/api/core/gerencia/indicadores/rentabilidad/?meses=3")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["verdict"]["code"], "SIN_DATOS")
        # Sueldos y gastos fijos entran al costo aunque no estén pagados.
        from core.models import CostoOperativo, Trabajadora
        Trabajadora.objects.create(nombre="Ana", area="CONFECCION", sueldo_mensual=1200)
        cat = CategoriaFinanciera.objects.get_or_create(nombre="Alquiler del local", defaults={"tipo": "EGRESO"})[0]
        CostoOperativo.objects.create(nombre="Alquiler", categoria=cat, importe=2000, fecha_inicio="2020-01-01")
        d = api.get("/api/core/gerencia/indicadores/rentabilidad/?meses=1").json()
        self.assertEqual(d["totals"]["salaries"], 1200)
        self.assertEqual(d["totals"]["fixed"], 2000)
        self.assertEqual(d["verdict"]["code"], "NO")
        r = api.get("/api/core/gerencia/indicadores/personal/?meses=3")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["workers"], [])
        api.force_authenticate(get_user_model().objects.create_user("com", password="x", rol="comercial"))
        self.assertEqual(api.get("/api/core/gerencia/indicadores/rentabilidad/").status_code, 403)


class DashboardGerencialTests(TestCase):
    def test_endpoints(self):
        ger = get_user_model().objects.create_user("ger3", password="x", rol="gerencia")
        api = APIClient()
        api.force_authenticate(ger)
        r = api.get("/api/core/gerencia/dashboard/?meses=3")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        for k in ("eficiencia", "desviacion", "costoMoVestido", "utilidadBruta", "margenBruto", "cumplimiento", "capacidadUtilizada", "retrabajo"):
            self.assertIn(k, d["period"])
        self.assertEqual(len(d["monthly"]), 3)
        self.assertEqual(api.get("/api/core/gerencia/dashboard/capacidad/").status_code, 200)
        self.assertEqual(api.get("/api/core/gerencia/dashboard/finanzas/").status_code, 200)
        r = api.get("/api/core/gerencia/dashboard/reporte/?meses=3")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Comparación mensual", load_workbook(io.BytesIO(r.content)).sheetnames)
        api.force_authenticate(get_user_model().objects.create_user("jt", password="x", rol="jefa_taller"))
        self.assertEqual(api.get("/api/core/gerencia/dashboard/").status_code, 403)


class EstadoResultadosTests(TestCase):
    def test_estructura_y_impuesto(self):
        from datetime import date as d
        from core.models import ConfiguracionNegocio, CostoOperativo, Gasto, Trabajadora
        ger = get_user_model().objects.create_user("ger4", password="x", rol="gerencia")
        cfg = ConfiguracionNegocio.obtener()
        cfg.tasa_impuesto = 10
        cfg.save()
        Trabajadora.objects.create(nombre="Ana", area="CONFECCION", sueldo_mensual=1000)
        cat_tela = CategoriaFinanciera.objects.get_or_create(nombre="Telas y encajes", defaults={"tipo": "EGRESO"})[0]
        cat_alq = CategoriaFinanciera.objects.get_or_create(nombre="Alquiler del local", defaults={"tipo": "EGRESO"})[0]
        CostoOperativo.objects.create(nombre="Alquiler", categoria=cat_alq, importe=500, fecha_inicio="2020-01-01")
        hoy = d.today()
        Gasto.objects.create(fecha=hoy, concepto="Tela", categoria=cat_tela, importe=300, metodo="EFECTIVO", estado="PAGADO")
        api = APIClient()
        api.force_authenticate(ger)
        r = api.get("/api/core/gerencia/estado-resultados/?meses=1")
        self.assertEqual(r.status_code, 200, r.content)
        lin = {l["key"]: l for l in r.json()["lines"]}
        self.assertEqual(lin["costoVentas"]["accounting"], 1300)   # 1000 sueldo + 300 tela
        self.assertEqual(lin["gastosOperativos"]["accounting"], 500)
        self.assertEqual(lin["operativa"]["accounting"], -1800)
        self.assertEqual(lin["impuestos"]["accounting"], 0)          # sin utilidad, sin impuesto
        self.assertEqual(lin["neta"]["accounting"], -1800)
        self.assertEqual(lin["materiales"]["cash"] if "materiales" in lin else lin["mat:Telas y encajes"]["cash"], 300)
