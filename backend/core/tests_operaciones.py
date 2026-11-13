"""
Pagos con recibo, fichas técnicas, gastos por área, calendario y avisos de contrato.

    python manage.py test core.tests_operaciones
"""

import shutil
import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from core.models import CategoriaFinanciera, Gasto, Notificacion, Pago
from core.tests_contratos import BaseContratos

MEDIA = tempfile.mkdtemp()

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82"
)


@override_settings(MEDIA_ROOT=MEDIA)
class Operaciones(BaseContratos):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        U = get_user_model()
        self.gerente, _ = U.objects.get_or_create(username="gere", defaults={"rol": "gerencia"})
        self.ger = APIClient()
        self.ger.force_authenticate(self.gerente)
        self.jef = APIClient()
        self.jef.force_authenticate(self.jefa)
        self.tal = APIClient()
        self.tal.force_authenticate(self.user_taller)

    def test_contrato_nuevo_avisa_a_jefa_y_gerencia(self):
        c = self.crear()["contrato"]
        avisados = set(
            Notificacion.objects.filter(tipo="CONTRATO", contrato_id=c["id"]).values_list("usuario__rol", flat=True)
        )
        self.assertIn("jefa_taller", avisados)
        self.assertIn("gerencia", avisados)

    def test_pagos_con_codigo_y_origen(self):
        c = self.crear()["contrato"]
        cid = c["id"]
        url = f"/api/core/contratos/{cid}/pagos/"
        d = self.api.get(url).data
        self.assertEqual([s["number"] for s in d["slots"]], [1, 2, 3])
        # Los adelantos del contrato salen de Comercial.
        self.assertTrue(all(p["code"].startswith("EFICO") for p in d["history"]))

        # La jefa registra el tercer pago: recibo EFITA.
        r = self.jef.post(url, {"amount": 100, "number": 3, "method": "EFECTIVO"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        tercero = r.data["slots"][2]["payment"]
        self.assertTrue(tercero["code"].startswith("EFITA"))
        self.assertEqual(tercero["origin"], "TALLER")
        self.assertEqual(tercero["by"], self.jefa.username)

        # Repetir el tercer pago no se puede.
        r = self.jef.post(url, {"amount": 10, "number": 3}, format="json")
        self.assertEqual(r.status_code, 400)

        # Comercial agrega un abono con descripción y observación.
        r = self.api.post(url, {"amount": 50, "description": "Abono prueba", "notes": "pagó la mamá"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        otro = r.data["others"][-1]
        self.assertEqual(otro["label"], "Abono prueba")
        self.assertEqual(otro["notes"], "pagó la mamá")
        self.assertTrue(otro["code"].startswith("EFICO"))

        # Lo ven igual la jefa y gerencia; gerencia no registra.
        self.assertEqual(self.jef.get(url).data["paid"], r.data["paid"])
        self.assertEqual(self.ger.get(url).status_code, 200)
        self.assertEqual(self.ger.post(url, {"amount": 1}, format="json").status_code, 403)

        # No se puede pagar más que el saldo.
        r = self.api.post(url, {"amount": float(r.data["balance"]) + 1}, format="json")
        self.assertEqual(r.status_code, 400)

        # Códigos únicos.
        codigos = list(Pago.objects.filter(contrato_id=cid).values_list("codigo", flat=True))
        self.assertEqual(len(codigos), len(set(codigos)))

    def test_ficha_y_referencias(self):
        c = self.crear()["contrato"]
        v = next(x for x in c["vestidos"] if x["taller"])
        url = f"/api/core/vestidos/{v['id']}/archivos/"
        r = self.api.post(
            url,
            {"files": [SimpleUploadedFile("ref.png", PNG, content_type="image/png")], "kind": "REFERENCIA"},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(len(r.data["files"]), 1)
        self.assertTrue(r.data["files"][0]["isImage"])

        r = self.jef.patch(f"/api/core/vestidos/{v['id']}/ficha/", {"sheet": "Busto 88"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.jef.get(url).data["sheet"], "Busto 88")

        # Un archivo no permitido se rechaza.
        r = self.api.post(url, {"files": [SimpleUploadedFile("x.exe", b"MZ")], "kind": "FICHA"}, format="multipart")
        self.assertEqual(r.status_code, 400)

        # Borrar.
        aid = self.jef.get(url).data["files"][0]["id"]
        self.assertEqual(self.jef.delete(f"{url}{aid}/").status_code, 200)

    def test_gastos_por_area_suman_en_gerencia(self):
        cat = CategoriaFinanciera.objects.filter(tipo="EGRESO").first() or CategoriaFinanciera.objects.create(
            nombre="Insumos prueba", tipo="EGRESO"
        )
        r = self.jef.post(
            "/api/core/gastos-area/",
            {"amount": "45.50", "concept": "Hilos", "categoryId": cat.id, "method": "EFECTIVO",
             "file": SimpleUploadedFile("boleta.png", PNG, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["by"], self.jefa.username)
        g = Gasto.objects.get(pk=r.data["id"])
        self.assertEqual(g.importe, Decimal("45.50"))
        self.assertEqual(g.registrado_por, self.jefa)
        self.assertTrue(Notificacion.objects.filter(tipo="GASTO", usuario=self.gerente).exists())

        self.assertEqual(g.area, "TALLER")
        # Comercial registra uno suyo.
        r = self.api.post("/api/core/gastos-area/", {"amount": "10", "concept": "Movilidad", "categoryId": cat.id}, format="multipart")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["area"], "TIENDA")

        # Cada área ve solo lo suyo.
        com = self.api.get("/api/core/gastos-area/").data
        self.assertEqual((com["count"], com["total"], com["scope"]), (1, 10.0, "TIENDA"))
        jef = self.jef.get("/api/core/gastos-area/").data
        self.assertEqual((jef["count"], jef["total"], jef["scope"]), (1, 45.5, "TALLER"))
        # Gerencia ve todo, con su origen, y puede filtrar.
        ger = self.ger.get("/api/core/gastos-area/").data
        self.assertEqual(ger["count"], 2)
        self.assertEqual({a["area"]: a["total"] for a in ger["byArea"]}, {"TIENDA": 10.0, "TALLER": 45.5, "GERENCIA": 0.0})
        self.assertEqual(self.ger.get("/api/core/gastos-area/?area=TALLER").data["count"], 1)
        self.assertEqual(self.ger.get(f"/api/core/gastos-area/?persona={self.comercial.id}").data["count"], 1)
        fin = self.ger.get("/api/core/gerencia/gastos/?area=TIENDA")
        self.assertEqual(fin.status_code, 200, fin.data)
        self.assertEqual([i["area"] for i in fin.data["items"]], ["TIENDA"])
        # El taller (trabajadora) no entra.
        self.assertEqual(self.tal.get("/api/core/gastos-area/").status_code, 403)

    def test_calendario(self):
        c = self.crear()["contrato"]
        mes = c["fecha_entrega"][:7]
        r = self.jef.get(f"/api/core/calendario/?mes={mes}")
        self.assertEqual(r.status_code, 200, r.data)
        ev = next(e for e in r.data["events"] if e["contractId"] == c["id"] and e["kind"] == "SALIDA")
        self.assertGreater(ev["balance"], 0)
        self.assertFalse(ev["paid"])
        self.assertEqual(self.tal.get(f"/api/core/calendario/?mes={mes}").status_code, 403)

    def test_jefa_gestiona_personal_sin_ver_sueldos(self):
        r = self.jef.post(
            "/api/gerencia/personal/trabajadoras/",
            {"nombre": "Rosa Quispe", "sueldo_mensual": "9999"},
            format="json",
        )
        self.assertIn(r.status_code, (201, 400), r.data)
        if r.status_code == 201:
            self.assertNotIn("sueldo_mensual", r.data)
