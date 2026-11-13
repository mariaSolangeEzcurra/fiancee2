from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    Cliente,
    Contrato,
    DisponibilidadSemanal,
    MovimientoFinanciero,
    Operacion,
    Pago,
    ReservaOperacion,
    RutaProduccion,
    SimulacionContrato,
    TipoVestido,
    Trabajadora,
    VestidoContrato,
    cargar_catalogo_inicial,
)

URL = "/api/core/contratos/"


class BaseContratos(TestCase):
    @classmethod
    def setUpTestData(cls):
        cargar_catalogo_inicial()
        Usuario = get_user_model()
        cls.comercial = Usuario.objects.create_user("ana", password="x", rol="comercial", first_name="Ana")
        cls.jefa = Usuario.objects.create_user("jefa", password="x", rol="jefa_taller")
        cls.user_taller = Usuario.objects.create_user("tall", password="x", rol="taller")

        # Una trabajadora por área, con todas las habilidades de su área
        # y 8 h de lunes a sábado.
        for area, _ in Trabajadora.Area.choices:
            for n in range(2):
                t = Trabajadora.objects.create(nombre=f"{area}-{n}", area=area)
                t.habilidades.set(Operacion.objects.filter(area_responsable=area))
                for dia in range(7):
                    DisponibilidadSemanal.objects.create(
                        trabajadora=t, dia_semana=dia,
                        horas_disponibles=Decimal("8") if dia < 6 else Decimal("0"),
                    )
        cls.trab_taller = Trabajadora.objects.get(nombre="CONFECCION-0")
        cls.trab_taller.usuario = cls.user_taller
        cls.trab_taller.save()

        cls.sirena = TipoVestido.objects.get(nombre="Sirena")
        cls.mini = TipoVestido.objects.get(nombre="Minimalista")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.comercial)
        self.hoy = timezone.localdate()

    def payload(self, **extra):
        data = {
            "datos_cliente": {
                "nombre": "María Pérez",
                "documento": "45678912",
                "telefono": "987654321",
                "direccion": "Av. Ejército 123, Yanahuara",
            },
            "fecha_evento": str(self.hoy + timedelta(days=200)),
            "tipo_evento": "NOVIA",
            "fecha_entrega": str(self.hoy + timedelta(days=190)),
            "fecha_devolucion": str(self.hoy + timedelta(days=202)),
            "servicio_lavanderia": "Lavado en seco",
            "garantia": "300.00",
            "vestidos": [
                {"tipo_vestido": self.sirena.id, "taller": "A", "modalidad": "VENTA",
                 "precio": "3500.00", "descripcion": "Sirena con cola desmontable"},
                {"tipo_vestido": self.mini.id, "taller": "C", "modalidad": "ALQUILER",
                 "precio": "900.00", "precio_otros": "100.00"},
                {"descripcion": "Velo catedral", "modalidad": "ALQUILER", "precio": "150.00"},
            ],
            "adelantos": [
                {"importe": "1000.00", "metodo": "EFECTIVO"},
                {"importe": "500.00", "metodo": "TRANSFERENCIA", "referencia": "OP-1"},
            ],
        }
        data.update(extra)
        return data

    def crear(self, **extra):
        r = self.api.post(URL, self.payload(**extra), format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data


class ContratosTestCase(BaseContratos):

    def test_crear_contrato_manual_completo(self):
        data = self.crear()
        c = data["contrato"]

        self.assertTrue(data["cliente_creado"])
        self.assertEqual(c["origen"], "MANUAL")
        self.assertTrue(c["numero"].startswith(f"CT-{self.hoy.year}-"))
        self.assertEqual(c["cliente"]["direccion"], "Av. Ejército 123, Yanahuara")
        self.assertEqual(Decimal(c["precio_total"]), Decimal("4650.00"))
        self.assertEqual(Decimal(c["total_pagado"]), Decimal("1500.00"))
        self.assertEqual(Decimal(c["saldo_pendiente"]), Decimal("3150.00"))
        self.assertEqual([a["concepto"] for a in c["adelantos"]], ["Primer pago", "Segundo pago"])
        self.assertEqual(MovimientoFinanciero.objects.count(), 2)
        self.assertEqual(c["asesora"], self.comercial.id)
        # servicios deducidos de los ítems
        self.assertTrue(c["servicio_alquiler"] and c["servicio_venta"] and c["servicio_confeccion"])

        v1, v2, v3 = c["vestidos"]
        self.assertEqual(v1["codigo"], f"{c['numero']}-V001")
        self.assertEqual((v1["taller"], v2["taller"], v3["taller"]), ("A", "C", None))
        self.assertEqual(v2["precio_alquiler"], "900.00")
        self.assertEqual(v2["precio_venta"], "0.00")

        # Planificación: reservas para los vestidos con taller.
        contrato = Contrato.objects.get(pk=c["id"])
        self.assertTrue(ReservaOperacion.objects.filter(vestido_id=v1["id"]).exists())
        self.assertTrue(ReservaOperacion.objects.filter(vestido_id=v2["id"]).exists())
        self.assertFalse(ReservaOperacion.objects.filter(vestido_id=v3["id"]).exists())

        ruta_a = RutaProduccion.objects.get(tipo_vestido=self.sirena, taller="A")
        horas_trabajo = ruta_a.operaciones.filter(tipo_tiempo="TRABAJO").aggregate(s=Sum("horas_estimadas"))["s"]
        reservadas = ReservaOperacion.objects.filter(vestido_id=v1["id"]).aggregate(s=Sum("horas_reservadas"))["s"]
        self.assertEqual(reservadas, horas_trabajo)

        plan = {p["codigo"]: p for p in data["planificacion"]}
        self.assertTrue(plan[v1["codigo"]]["planificado"])
        self.assertIsNotNone(contrato.vestidos.get(pk=v1["id"]).fecha_fin_estimada)

    def test_capacidad_diaria_no_se_excede(self):
        self.crear()
        self.crear(datos_cliente={"nombre": "Otra", "documento": "11111111"})
        for t in Trabajadora.objects.all():
            for fila in (
                ReservaOperacion.objects.filter(trabajadora=t)
                .values("fecha").annotate(h=Sum("horas_reservadas"))
            ):
                self.assertLessEqual(fila["h"], Decimal("8"), (t.nombre, fila))

    def test_clienta_existente_por_dni_se_reutiliza(self):
        self.crear()
        data = self.crear(datos_cliente={"nombre": "María Pérez", "documento": "45678912", "telefono": "999000111"})
        self.assertFalse(data["cliente_creado"])
        self.assertEqual(Cliente.objects.filter(documento="45678912").count(), 1)
        self.assertEqual(Cliente.objects.get(documento="45678912").telefono, "999000111")

    def test_editar_vestidos_numero_y_adelantos(self):
        c = self.crear()["contrato"]
        v1, v2, v3 = c["vestidos"]
        reservas_v1_antes = set(ReservaOperacion.objects.filter(vestido_id=v1["id"]).values_list("id", flat=True))

        r = self.api.patch(f"{URL}{c['id']}/", {
            "numero": "VE-500",
            "vestidos": [
                # v1 pasa del Taller A al C -> se replanifica
                {"id": v1["id"], "tipo_vestido": self.sirena.id, "taller": "C", "precio": "3000.00"},
                # v2 solo cambia precio -> conserva sus reservas
                {"id": v2["id"], "tipo_vestido": self.mini.id, "taller": "C", "modalidad": "ALQUILER", "precio": "950.00"},
                # v3 (velo) se quita; se agrega un vestido nuevo
                {"tipo_vestido": self.mini.id, "taller": "A", "modalidad": "VENTA", "precio": "2000.00"},
            ],
            "adelantos": [{"importe": "1000.00"}, {"importe": "0"}],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        c2 = r.data["contrato"]

        self.assertEqual(c2["numero"], "VE-500")
        self.assertEqual([v["codigo"] for v in c2["vestidos"]], ["VE-500-V001", "VE-500-V002", "VE-500-V004"])
        self.assertEqual(Decimal(c2["precio_total"]), Decimal("5950.00"))
        self.assertEqual(Decimal(c2["total_pagado"]), Decimal("1000.00"))
        self.assertEqual(Pago.objects.filter(contrato_id=c["id"]).count(), 1)
        self.assertFalse(VestidoContrato.objects.filter(pk=v3["id"]).exists())

        reservas_v1 = ReservaOperacion.objects.filter(vestido_id=v1["id"])
        self.assertTrue(reservas_v1.exists())
        self.assertTrue(reservas_v1_antes.isdisjoint(set(reservas_v1.values_list("id", flat=True))))
        self.assertTrue(all(r.plantilla.ruta.taller == "C" for r in reservas_v1))
        planificados = {p["codigo"] for p in r.data["planificacion"]}
        self.assertEqual(planificados, {"VE-500-V001", "VE-500-V004"})

    def test_no_se_cambia_taller_de_vestido_con_avance(self):
        c = self.crear()["contrato"]
        v1 = c["vestidos"][0]
        VestidoContrato.objects.filter(pk=v1["id"]).update(estado="EN_PROCESO")
        r = self.api.patch(f"{URL}{c['id']}/", {
            "vestidos": [{"id": v1["id"], "tipo_vestido": self.sirena.id, "taller": "C"}]
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("vestidos", r.data)

    def test_cancelar_libera_capacidad(self):
        c = self.crear()["contrato"]
        r = self.api.patch(f"{URL}{c['id']}/", {"estado": "CANCELADO"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(
            ReservaOperacion.objects.filter(contrato_id=c["id"]).exclude(estado="CANCELADA").exists()
        )
        r = self.api.patch(f"{URL}{c['id']}/", {"observaciones": "x"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_previsualizar_no_guarda(self):
        r = self.api.post(f"{URL}previsualizar/", self.payload(), format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["planificacion"])
        self.assertEqual(Contrato.objects.count(), 0)
        self.assertEqual(Cliente.objects.count(), 0)
        self.assertEqual(ReservaOperacion.objects.count(), 0)

    def test_validaciones(self):
        r = self.api.post(URL, self.payload(vestidos=[]), format="json")
        self.assertEqual(r.status_code, 400)
        r = self.api.post(URL, self.payload(fecha_evento=str(self.hoy + timedelta(days=10))), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("fecha_evento", r.data)
        r = self.api.post(URL, self.payload(vestidos=[{"taller": "A", "precio": "1"}]), format="json")
        self.assertEqual(r.status_code, 400)
        r = self.api.post(URL, self.payload(adelantos=[{"importe": "99999"}]), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Contrato.objects.count(), 0)

    def test_permisos(self):
        c = self.crear()["contrato"]
        jefa = APIClient(); jefa.force_authenticate(self.jefa)
        self.assertEqual(jefa.get(URL).status_code, 200)
        self.assertEqual(jefa.get(f"{URL}{c['id']}/planificacion/").status_code, 200)
        self.assertEqual(jefa.post(URL, self.payload(), format="json").status_code, 403)
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        self.assertEqual(taller.get(URL).status_code, 403)

    def test_lista_y_filtros(self):
        self.crear()
        r = self.api.get(URL, {"q": "45678912"})
        self.assertEqual(r.data["total"], 1)
        r = self.api.get(URL, {"origen": "SIMULADOR"})
        self.assertEqual(r.data["total"], 0)
        r = self.api.get(f"{URL}clientes/", {"q": "maría"})
        self.assertEqual(len(r.data), 1)

    def test_aceptar_simulacion_usa_mismo_flujo(self):
        cliente = Cliente.objects.create(nombre="Lucía", documento="22222222")
        ruta = RutaProduccion.objects.get(tipo_vestido=self.sirena, taller="A")
        sim = SimulacionContrato.objects.create(
            cliente=cliente, tipo_vestido=self.sirena, ruta=ruta, cantidad=2,
            fecha_entrega_solicitada=self.hoy + timedelta(days=150),
            precio_unitario=Decimal("2500"), estado="VIABLE",
        )
        r = self.api.post(f"{URL}aceptar-simulacion/", {"simulacion_id": sim.id}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        c = r.data["contrato"]
        self.assertEqual(c["origen"], "SIMULADOR")
        self.assertEqual(len(c["vestidos"]), 2)
        self.assertEqual(Decimal(c["precio_total"]), Decimal("5000.00"))
        self.assertEqual(ReservaOperacion.objects.filter(contrato_id=c["id"]).values("vestido").distinct().count(), 2)
        sim.refresh_from_db()
        self.assertEqual(sim.estado, "ACEPTADA")
        r = self.api.post(f"{URL}aceptar-simulacion/", {"simulacion_id": sim.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_taller_ve_vestidos_de_contrato_manual(self):
        c = self.crear()["contrato"]
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        # Sin que la jefa inicie el proceso, no aparecen.
        r = taller.get("/api/gerencia/personal/vestidos-disponibles/")
        self.assertEqual(len(r.data), 0)
        jefa = APIClient(); jefa.force_authenticate(self.jefa)
        for v in c["vestidos"][:2]:
            jefa.post(f"/api/core/produccion/vestidos/{v['id']}/iniciar-proceso/")
        # Solo ve los procesos de sus habilidades: el primer paso no es confección.
        r = taller.get("/api/gerencia/personal/vestidos-disponibles/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 0)
        self.trab_taller.habilidades.set(Operacion.objects.all())
        r = taller.get("/api/gerencia/personal/vestidos-disponibles/")
        self.assertEqual(len(r.data), 2)  # el velo no pasa por el taller
        self.assertEqual(r.data[0]["cliente"], "María Pérez")

        r = taller.get("/api/gerencia/personal/mis-trabajos/")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))


class VestidoEnTiendaTestCase(BaseContratos):
    def setUp(self):
        super().setUp()
        # Vestido de tienda: se elige el modelo y su taller "Tienda".
        self.tienda = TipoVestido.objects.get(nombre="Sirena")
        self.ruta_t = RutaProduccion.objects.get(tipo_vestido=self.tienda, taller="T")
        self.plantillas = {p.operacion.nombre: p for p in self.ruta_t.operaciones.select_related("operacion")}

    def test_ruta_tienda_sin_compra(self):
        self.assertNotIn("compra materiales", self.plantillas)
        self.assertIn("entalle", self.plantillas)

    def test_tienda_toma_horas_del_modelo(self):
        def horas(taller, nombre):
            return RutaProduccion.objects.get(tipo_vestido=self.tienda, taller=taller).operaciones.get(
                operacion__nombre=nombre).horas_estimadas
        self.assertEqual(self.plantillas["bordado"].horas_estimadas, horas("C", "bordado"))
        self.assertEqual(self.plantillas["confección"].horas_estimadas, horas("A", "confección"))
        # El genérico ya no se ofrece para contratos nuevos.
        generico = TipoVestido.objects.filter(nombre="Vestido en tienda").first()
        if generico:
            self.assertFalse(generico.activo)

    def test_tiempos_ajustados_por_vestido(self):
        procesos = [
            {"plantilla": self.plantillas["entalle"].id, "horas": "3.00", "incluido": True},
            {"plantilla": self.plantillas["lavandería"].id, "horas": "24.00", "incluido": False},
        ]
        data = self.crear(vestidos=[
            {"tipo_vestido": self.tienda.id, "taller": "T", "modalidad": "ALQUILER",
             "precio": "800.00", "procesos": procesos},
        ], adelantos=[])
        v = data["contrato"]["vestidos"][0]
        self.assertEqual(v["taller"], "T")
        por_nombre = {p["operacion"]: p for p in v["procesos"]}
        self.assertEqual(por_nombre["entalle"]["horas"], "3.00")
        self.assertTrue(por_nombre["entalle"]["ajustado"])
        self.assertFalse(por_nombre["lavandería"]["incluido"])
        self.assertEqual(por_nombre["acabados"]["horas"], por_nombre["acabados"]["horas_base"])

        esperado = sum(
            (p.horas_estimadas for n, p in self.plantillas.items() if n not in ("entalle", "lavandería")),
            Decimal("3.00"),
        )
        reservadas = ReservaOperacion.objects.filter(vestido_id=v["id"]).aggregate(s=Sum("horas_reservadas"))["s"]
        self.assertEqual(reservadas, esperado)
        self.assertFalse(ReservaOperacion.objects.filter(
            vestido_id=v["id"], plantilla=self.plantillas["lavandería"]).exists())

        ops = {o["operacion"]: o for o in data["planificacion"][0]["operaciones"]}
        self.assertTrue(ops["lavandería"]["omitido"])

    def test_editar_tiempos_replanifica(self):
        c = self.crear(vestidos=[{"tipo_vestido": self.tienda.id, "taller": "T", "precio": "800"}], adelantos=[])["contrato"]
        v = c["vestidos"][0]
        entalle = self.plantillas["entalle"]
        r = self.api.patch(f"{URL}{c['id']}/", {"vestidos": [
            {"id": v["id"], "tipo_vestido": self.tienda.id, "taller": "T", "precio": "800",
             "procesos": [{"plantilla": entalle.id, "horas": "1.50"}]},
        ]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data["planificacion"]), 1)
        h = ReservaOperacion.objects.filter(vestido_id=v["id"], plantilla=entalle).aggregate(s=Sum("horas_reservadas"))["s"]
        self.assertEqual(h, Decimal("1.50"))

        # Mismo envío sin cambios: no replanifica.
        r = self.api.patch(f"{URL}{c['id']}/", {"vestidos": [
            {"id": v["id"], "tipo_vestido": self.tienda.id, "taller": "T", "precio": "800",
             "procesos": [{"plantilla": entalle.id, "horas": "1.50"}]},
        ]}, format="json")
        self.assertEqual(r.data["planificacion"], [])

        # Con avance ya no se pueden cambiar.
        VestidoContrato.objects.filter(pk=v["id"]).update(estado="EN_PROCESO")
        r = self.api.patch(f"{URL}{c['id']}/", {"vestidos": [
            {"id": v["id"], "tipo_vestido": self.tienda.id, "taller": "T", "precio": "800",
             "procesos": [{"plantilla": entalle.id, "horas": "5"}]},
        ]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_proceso_de_otra_ruta_rechazado(self):
        otra = RutaProduccion.objects.get(tipo_vestido=self.sirena, taller="A").operaciones.first()
        r = self.api.post(URL, self.payload(vestidos=[
            {"tipo_vestido": self.tienda.id, "taller": "T", "precio": "1",
             "procesos": [{"plantilla": otra.id, "horas": "1"}]},
        ]), format="json")
        self.assertEqual(r.status_code, 400)

    def test_tiempos_tambien_en_taller_a(self):
        ruta_a = RutaProduccion.objects.get(tipo_vestido=self.sirena, taller="A")
        bordado = ruta_a.operaciones.get(operacion__nombre="bordado")
        data = self.crear(vestidos=[{"tipo_vestido": self.sirena.id, "taller": "A", "precio": "1",
                                      "procesos": [{"plantilla": bordado.id, "horas": "0", "incluido": False}]}], adelantos=[])
        v = data["contrato"]["vestidos"][0]
        self.assertFalse(ReservaOperacion.objects.filter(vestido_id=v["id"], plantilla=bordado).exists())


class ProduccionTestCase(BaseContratos):
    """Del contrato a la línea de producción de cada vestido."""

    P = "/api/core/produccion/vestidos/"

    def setUp(self):
        super().setUp()
        self.jefa_api = APIClient()
        self.jefa_api.force_authenticate(self.jefa)
        c = self.crear(adelantos=[])["contrato"]
        self.contrato_id = c["id"]
        self.v1 = c["vestidos"][0]  # Sirena, Taller A
        self.v2 = c["vestidos"][1]  # Minimalista, Taller C

    def get(self, vid):
        r = self.jefa_api.get(f"{self.P}{vid}/")
        self.assertEqual(r.status_code, 200, r.data)
        return r.data["dress"]

    def test_lista_para_jefa_con_pasos(self):
        r = self.jefa_api.get(self.P)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 2)  # el velo sin taller no aparece
        d = next(x for x in r.data if x["vestidoId"] == self.v1["id"])
        self.assertEqual(d["workshop"], "Taller A")
        self.assertEqual(d["status"], "Sin iniciar")
        self.assertEqual(d["currentIndex"], 0)
        self.assertEqual(d["steps"][0]["process"], "compra materiales")
        self.assertTrue(d["steps"][-1]["isDelivery"])
        self.assertEqual(d["client"], "María Pérez")
        # gerencia puede leer, el taller no
        g = APIClient(); g.force_authenticate(get_user_model().objects.create_user("g", password="x", rol="gerencia"))
        self.assertEqual(g.get(self.P).status_code, 200)
        self.assertEqual(g.post(f"{self.P}{self.v1['id']}/completar-paso/").status_code, 403)

    def test_pasos_respetan_tiempos_ajustados(self):
        tienda = TipoVestido.objects.get(nombre="Sirena")
        ruta = RutaProduccion.objects.get(tipo_vestido=tienda, taller="T")
        lav = ruta.operaciones.get(operacion__nombre="lavandería")
        ent = ruta.operaciones.get(operacion__nombre="entalle")
        c = self.crear(adelantos=[], datos_cliente={"nombre": "X", "documento": "999"}, vestidos=[
            {"tipo_vestido": tienda.id, "taller": "T", "precio": "500",
             "procesos": [{"plantilla": lav.id, "horas": "0", "incluido": False},
                          {"plantilla": ent.id, "horas": "3"}]}])["contrato"]
        d = self.get(c["vestidos"][0]["id"])
        nombres = [s["process"] for s in d["steps"]]
        self.assertNotIn("lavandería", nombres)
        self.assertEqual(next(s for s in d["steps"] if s["process"] == "entalle")["estHours"], 3.0)
        self.assertEqual(d["workshop"], "Tienda")

    def test_jefa_avanza_hasta_terminar(self):
        vid = self.v2["id"]
        d = self.get(vid)
        n = len(d["steps"])
        r = self.jefa_api.post(f"{self.P}{vid}/completar-paso/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["dress"]["currentIndex"], 1)
        self.assertEqual(r.data["dress"]["status"], "En proceso")
        self.assertTrue(r.data["dress"]["steps"][0]["done"])
        self.assertEqual(Contrato.objects.get(pk=self.contrato_id).estado, "EN_PRODUCCION")
        for _ in range(n - 1):
            r = self.jefa_api.post(f"{self.P}{vid}/completar-paso/")
        self.assertEqual(r.data["dress"]["status"], "Terminado")
        self.assertEqual(self.jefa_api.post(f"{self.P}{vid}/completar-paso/").status_code, 400)
        # Volver a un proceso lo reabre
        r = self.jefa_api.post(f"{self.P}{vid}/paso-actual/", {"index": 2}, format="json")
        self.assertEqual(r.data["dress"]["status"], "En proceso")
        self.assertFalse(r.data["dress"]["steps"][2]["done"])

    def test_completar_paso_libera_reservas_futuras(self):
        vid = self.v1["id"]
        d = self.get(vid)
        plantilla_id = VestidoContrato.objects.get(pk=vid).pasos.get(orden=0).plantilla_id
        self.jefa_api.post(f"{self.P}{vid}/completar-paso/")
        qs = ReservaOperacion.objects.filter(vestido_id=vid, plantilla_id=plantilla_id)
        self.assertFalse(qs.filter(estado="RESERVADA").exists())
        self.assertFalse(qs.filter(estado="CANCELADA", fecha__lte=self.hoy).exists())

    def test_horas_trabajadoras_fecha_prioridad_notas(self):
        vid = self.v1["id"]
        # horas: patronaje (índice 1) a 20 h → reservas reprogramadas
        r = self.jefa_api.patch(f"{self.P}{vid}/pasos/1/", {"estHours": "20"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["dress"]["steps"][1]["estHours"], 20.0)
        paso = VestidoContrato.objects.get(pk=vid).pasos.get(orden=1)
        total = ReservaOperacion.objects.filter(vestido_id=vid, plantilla=paso.plantilla).exclude(
            estado="CANCELADA").aggregate(s=Sum("horas_reservadas"))["s"]
        self.assertEqual(total, Decimal("20.00"))
        # trabajadora (alternar)
        t = Trabajadora.objects.first()
        r = self.jefa_api.post(f"{self.P}{vid}/pasos/1/trabajadoras/", {"workerId": t.id}, format="json")
        self.assertIn(str(t.id), r.data["dress"]["steps"][1]["workerIds"])
        r = self.jefa_api.post(f"{self.P}{vid}/pasos/1/trabajadoras/", {"workerId": t.id}, format="json")
        self.assertNotIn(str(t.id), r.data["dress"]["steps"][1]["workerIds"])
        # fecha límite y prioridad
        nueva = str(self.hoy + timedelta(days=100))
        r = self.jefa_api.patch(f"{self.P}{vid}/", {"deadline": nueva, "priority": "Alta"}, format="json")
        self.assertEqual(str(r.data["dress"]["deadline"]), nueva)
        self.assertEqual(r.data["dress"]["priority"], "Alta")
        # nota
        r = self.jefa_api.post(f"{self.P}{vid}/notas/", {"kind": "incidencia", "text": "Falta forro"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["dress"]["notes"][0]["kind"], "incidencia")
        # trabajadoras
        r = self.jefa_api.get("/api/core/produccion/trabajadoras/")
        self.assertTrue(r.data and "areas" in r.data[0])

    def test_trabajadora_trabaja_por_procesos(self):
        from core.models import RegistroAsistencia
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        RegistroAsistencia.objects.create(trabajadora=self.trab_taller, fecha=timezone.localdate(),
                                          entrada=timezone.now())
        vid = self.v1["id"]
        # Saltamos compra/patronaje/corte para llegar a confección
        for _ in range(3):
            self.jefa_api.post(f"{self.P}{vid}/completar-paso/")
        # Sin iniciar el proceso, la trabajadora no puede empezar.
        r = taller.post("/api/taller/sesiones-vestido/iniciar/", {"vestido_id": vid}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("aún no inició", r.data["detail"])
        r = self.jefa_api.post(f"{self.P}{vid}/iniciar-proceso/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIsNotNone(r.data["dress"]["steps"][3]["startedAt"])
        r = taller.get("/api/taller/vestidos-disponibles/")
        self.assertEqual(r.status_code, 200, r.data)
        item = next(x for x in r.data if x["id"] == vid)
        self.assertEqual(item["proceso_actual"], "confección")
        self.assertTrue(item["es_de_mi_area"])

        r = taller.post("/api/taller/sesiones-vestido/iniciar/", {"vestido_id": vid}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        sid = r.data["sesion"]["id"]
        d = self.get(vid)
        self.assertTrue(d["steps"][3]["inProgress"])
        self.assertIn(str(self.trab_taller.id), d["steps"][3]["workerIds"])
        self.assertIsNotNone(d["activeSession"])

        r = taller.post(f"/api/taller/sesiones-vestido/{sid}/finalizar/", {"observaciones": "Avancé falda"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        # Terminar la sesión NO termina el proceso: sigue abierto.
        d = self.get(vid)
        self.assertFalse(d["steps"][3]["done"])
        self.assertEqual(d["currentIndex"], 3)
        self.assertIsNone(d["activeSession"])
        self.assertEqual(len(d["workLog"]), 1)
        log = d["workLog"][0]
        self.assertEqual(log["worker"], self.trab_taller.nombre)
        self.assertEqual(log["process"], "Confección")
        self.assertEqual(log["status"], "Finalizada")
        self.assertEqual(log["notes"], "Avancé falda")
        self.assertIsNotNone(log["shift"]["checkIn"])
        self.assertEqual(d["steps"][3]["sessions"][0]["id"], log["id"])
        self.assertEqual(d["workersSummary"][0]["sessions"], 1)

        # Otra trabajadora continúa el mismo proceso.
        otra = Trabajadora.objects.get(nombre="CONFECCION-1")
        otra.usuario = get_user_model().objects.create_user("otra", password="x", rol="taller")
        otra.save()
        RegistroAsistencia.objects.create(trabajadora=otra, fecha=timezone.localdate(), entrada=timezone.now())
        api2 = APIClient(); api2.force_authenticate(otra.usuario)
        r = api2.post("/api/taller/sesiones-vestido/iniciar/", {"vestido_id": vid}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        d = self.get(vid)
        self.assertEqual(d["activeSession"]["worker"], "CONFECCION-1")
        self.assertEqual(d["activeSession"]["status"], "Trabajando")
        api2.post(f"/api/taller/sesiones-vestido/{r.data['sesion']['id']}/pausar/", {"motivo": "almuerzo"}, format="json")
        self.assertEqual(self.get(vid)["activeSession"]["status"], "En pausa")

        # Solo la jefa termina el proceso: queda la duración real.
        r = self.jefa_api.post(f"{self.P}{vid}/completar-paso/")
        paso = r.data["dress"]["steps"][3]
        self.assertTrue(paso["done"])
        self.assertIsNotNone(paso["elapsedHours"])
        self.assertEqual(r.data["dress"]["currentIndex"], 4)
        # El siguiente queda pendiente hasta que la jefa lo inicie.
        self.assertEqual(r.data["dress"]["steps"][4]["status"], "PENDIENTE")
        self.assertEqual(len(r.data["dress"]["workersSummary"]), 2)

    def test_contrato_editado_regenera_pasos(self):
        vid = self.v1["id"]
        r = self.api.patch(f"{URL}{self.contrato_id}/", {"vestidos": [
            {"id": vid, "tipo_vestido": self.sirena.id, "taller": "C", "precio": "1"},
            {"id": self.v2["id"], "tipo_vestido": self.mini.id, "taller": "C", "modalidad": "ALQUILER", "precio": "900"},
        ]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        d = self.get(vid)
        self.assertEqual(d["workshop"], "Taller C")
        self.assertNotIn("patronaje", [s["process"] for s in d["steps"]])


class JefaTallerTestCase(BaseContratos):
    """Procesos extra, horas, dinero, fotos y recordatorios."""

    P = "/api/core/produccion/vestidos/"

    def setUp(self):
        super().setUp()
        self.jefa_api = APIClient()
        self.jefa_api.force_authenticate(self.jefa)
        c = self.crear()["contrato"]
        self.contrato_id = c["id"]
        self.vid = c["vestidos"][1]["id"]  # Minimalista, Taller C

    def dress(self):
        return self.jefa_api.get(f"{self.P}{self.vid}/").data["dress"]

    def test_agregar_y_quitar_proceso_extra(self):
        from core.models import Operacion
        prueba = Operacion.objects.get(nombre="prueba 1")
        antes = self.dress()
        r = self.jefa_api.post(f"{self.P}{self.vid}/iniciar-proceso/")
        r = self.jefa_api.post(f"{self.P}{self.vid}/pasos/", {
            "operationId": prueba.id, "hours": "3", "name": "Prueba extra (pedido de la novia)"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        d = r.data["dress"]
        self.assertEqual(len(d["steps"]), len(antes["steps"]) + 1)
        nuevo = d["steps"][1]
        self.assertTrue(nuevo["isExtra"])
        self.assertEqual(nuevo["name"], "Prueba extra (pedido de la novia)")
        self.assertEqual(d["currentIndex"], 0)
        reservadas = ReservaOperacion.objects.filter(paso_id=nuevo["id"]).aggregate(s=Sum("horas_reservadas"))["s"]
        self.assertEqual(reservadas, Decimal("3.00"))
        # cambiar horas de un paso futuro
        r = self.jefa_api.patch(f"{self.P}{self.vid}/pasos/1/", {"estHours": "5"}, format="json")
        self.assertEqual(r.data["dress"]["steps"][1]["estHours"], 5.0)
        self.assertEqual(ReservaOperacion.objects.filter(paso_id=nuevo["id"]).aggregate(s=Sum("horas_reservadas"))["s"], Decimal("5.00"))
        # quitar
        r = self.jefa_api.delete(f"{self.P}{self.vid}/pasos/1/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data["dress"]["steps"]), len(antes["steps"]))
        self.assertFalse(ReservaOperacion.objects.filter(paso_id=nuevo["id"]).exists())
        # un paso de la ruta no se puede quitar
        self.assertEqual(self.jefa_api.delete(f"{self.P}{self.vid}/pasos/2/").status_code, 400)

    def test_pagos_y_cobros_extra_suben_el_total(self):
        d = self.dress()
        total = d["finance"]["contractTotal"]
        self.assertEqual(total, 4650.0)
        r = self.jefa_api.post(f"{self.P}{self.vid}/cargos/", {"concept": "Cambiar escote", "amount": "250"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        f = r.data["dress"]["finance"]
        self.assertEqual(f["contractTotal"], 4900.0)
        self.assertEqual(f["dressExtras"], 250.0)
        self.assertEqual(f["dressTotal"], 1250.0)
        self.assertEqual(Contrato.objects.get(pk=self.contrato_id).precio_total, Decimal("4900.00"))
        # el comercial ve el cobro en el contrato
        c = self.api.get(f"{URL}{self.contrato_id}/").data
        self.assertEqual(c["total_cargos"], "250.00")
        self.assertEqual(c["cargos_adicionales"][0]["concepto"], "Cambiar escote")
        # pago recibido en taller
        r = self.jefa_api.post(f"{self.P}{self.vid}/pagos/", {"amount": "400", "method": "TRANSFERENCIA"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        f = r.data["dress"]["finance"]
        self.assertEqual(f["contractPaid"], 1900.0)
        self.assertEqual(f["contractBalance"], 3000.0)
        self.assertEqual(MovimientoFinanciero.objects.count(), 3)
        # no se puede pagar más del saldo
        r = self.jefa_api.post(f"{self.P}{self.vid}/pagos/", {"amount": "99999"}, format="json")
        self.assertEqual(r.status_code, 400)
        # editar el contrato mantiene el cobro extra en el total
        r = self.api.patch(f"{URL}{self.contrato_id}/", {"observaciones": "ok"}, format="json")
        self.assertEqual(r.data["contrato"]["precio_total"], "4900.00")
        # quitar el cobro
        cargo_id = f["charges"][0]["id"]
        r = self.jefa_api.delete(f"{self.P}{self.vid}/cargos/{cargo_id}/")
        self.assertEqual(r.data["dress"]["finance"]["contractTotal"], 4650.0)

    def test_nota_con_fotos_y_cobro(self):
        import shutil, tempfile
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
               b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")
        media = tempfile.mkdtemp()
        try:
            with override_settings(MEDIA_ROOT=media):
                r = self.jefa_api.post(f"{self.P}{self.vid}/notas/", {
                    "kind": "observacion", "text": "Se subió el escote 2 cm",
                    "extraAmount": "120", "extraConcept": "Ajuste de escote",
                    "images": [SimpleUploadedFile("a.png", png, "image/png"), SimpleUploadedFile("b.png", png, "image/png")],
                }, format="multipart")
                self.assertEqual(r.status_code, 201, r.data)
                nota = r.data["dress"]["notes"][0]
                self.assertEqual(len(nota["images"]), 2)
                self.assertTrue(nota["images"][0]["url"].startswith("http"))
                self.assertEqual(nota["extraCharge"]["amount"], 120.0)
                self.assertEqual(r.data["dress"]["finance"]["dressExtras"], 120.0)
                # no se aceptan archivos que no son imagen
                r = self.jefa_api.post(f"{self.P}{self.vid}/notas/", {
                    "text": "x", "images": [SimpleUploadedFile("a.pdf", b"%PDF", "application/pdf")]}, format="multipart")
                self.assertEqual(r.status_code, 400)
                # las trabajadoras también la ven
                taller = APIClient(); taller.force_authenticate(self.user_taller)
                r = taller.get(f"/api/taller/vestidos/{self.vid}/notas/")
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.data[0]["cobro_extra"], 120.0)
                self.assertEqual(len(r.data[0]["imagenes"]), 2)
        finally:
            shutil.rmtree(media, ignore_errors=True)

    def test_recordatorio_primera_prueba(self):
        from core.models import Contrato as C
        C.objects.filter(pk=self.contrato_id).update(fecha_firma=self.hoy - timedelta(days=46))
        r = self.jefa_api.get("/api/core/produccion/recordatorios/")
        self.assertEqual(r.status_code, 200)
        tipos = {(a["code"], a["type"]) for a in r.data}
        self.assertIn((VestidoContrato.objects.get(pk=self.vid).codigo, "PRIMERA_PRUEBA"), tipos)
        self.assertTrue(all(a["due"] for a in r.data if a["type"] == "PRIMERA_PRUEBA"))
        self.assertTrue(self.dress()["reminders"])
        C.objects.filter(pk=self.contrato_id).update(fecha_firma=self.hoy - timedelta(days=10))
        r = self.jefa_api.get("/api/core/produccion/recordatorios/")
        self.assertFalse([a for a in r.data if a["type"] == "PRIMERA_PRUEBA"])


class SimuladorTestCase(BaseContratos):
    S = "/api/core/simulador/"

    def sim(self, dias, vestidos=None, **extra):
        body = {"fecha_entrega": str(self.hoy + timedelta(days=dias)),
                "vestidos": vestidos or [{"tipo_vestido": self.mini.id, "taller": "A"}], **extra}
        r = self.api.post(self.S, body, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def test_factible_con_tiempo(self):
        d = self.sim(200)
        self.assertEqual(d["veredicto"], "FACTIBLE", d["condiciones"])
        self.assertEqual(d["estado"], "ok")
        self.assertGreater(d["margen_dias"], 7)
        self.assertTrue(d["areas"])
        self.assertIn("cuello_botella", d)
        self.assertIsNone(d["causa"])
        self.assertTrue(d["resumen_vestidos"][0]["a_tiempo"])
        self.assertFalse(d["temporada_alta"]["activa"])
        # no guarda nada
        self.assertEqual(ReservaOperacion.objects.count(), 0)

    def test_no_factible_sugiere_fecha(self):
        d = self.sim(10)
        self.assertEqual(d["veredicto"], "NO_FACTIBLE")
        self.assertIsNotNone(d["fecha_alternativa"])
        self.assertGreater(str(d["fecha_alternativa"]), str(self.hoy + timedelta(days=10)))
        self.assertTrue(d["motivos"])
        # la fecha sugerida sí es factible
        dias = (d["fecha_alternativa"] - self.hoy).days
        self.assertNotEqual(self.sim(dias)["veredicto"], "NO_FACTIBLE")

    def test_bordado_15_dias_antes(self):
        d = self.sim(200, [{"tipo_vestido": self.sirena.id, "taller": "A"}])
        bordado = next(o for o in d["vestidos"][0]["operaciones"] if o["operacion"] == "bordado")
        self.assertGreaterEqual(bordado["inicio"], self.hoy + timedelta(days=200 - 15))
        self.assertIn("15 días", bordado["regla"])

    def test_carga_real_y_temporada_alta(self):
        from django.test import override_settings
        # Se llenan 12 contratos: la carga comprometida sube.
        for i in range(12):
            self.crear(adelantos=[], datos_cliente={"nombre": f"N{i}", "documento": f"7{i:07d}"},
                       vestidos=[{"tipo_vestido": self.mini.id, "taller": "A", "precio": "1"}])
        with override_settings(FIANCEE_TEMPORADA_ALTA_VESTIDOS=10):
            d = self.sim(200)
        self.assertTrue(d["temporada_alta"]["activa"])
        self.assertGreaterEqual(d["temporada_alta"]["vestidos_en_produccion"], 12)
        self.assertEqual(d["temporada_alta"]["factor"], 1.2)
        self.assertNotEqual(d["veredicto"], "FACTIBLE")
        self.assertGreaterEqual(d["cola"]["vestidos_antes"], 12)

    def test_mas_personal_mas_capacidad(self):
        antes = self.sim(60)
        t = Trabajadora.objects.create(nombre="Nueva", area="CONFECCION")
        t.habilidades.set(Operacion.objects.filter(area_responsable="CONFECCION"))
        for dia in range(6):
            DisponibilidadSemanal.objects.create(trabajadora=t, dia_semana=dia, horas_disponibles=Decimal("6"))
        despues = self.sim(60)
        cap = lambda d: next(a["capacidad"] for a in d["areas"] if a["area"] == "CONFECCION")
        self.assertGreater(cap(despues), cap(antes))

    def test_validaciones_y_permisos(self):
        r = self.api.post(self.S, {"fecha_entrega": str(self.hoy - timedelta(days=1)),
                                   "vestidos": [{"tipo_vestido": self.mini.id, "taller": "A"}]}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.api.post(self.S, {"fecha_entrega": str(self.hoy + timedelta(days=50)),
                                   "vestidos": [{"tipo_vestido": self.mini.id, "taller": "T"}]}, format="json")
        # Ahora cada modelo tiene su ruta Tienda.
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        generico, _ = TipoVestido.objects.get_or_create(nombre="Vestido en tienda", defaults={"activo": False})
        r = self.api.post(self.S, {"fecha_entrega": str(self.hoy + timedelta(days=50)),
                                   "vestidos": [{"tipo_vestido": generico.id, "taller": "T"}]}, format="json")
        self.assertEqual(r.status_code, 400)
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        self.assertEqual(taller.post(self.S, {}, format="json").status_code, 403)


class JornadaYNotificacionesTestCase(BaseContratos):
    def test_jornada_olvidada_se_cierra_con_su_horario(self):
        from core.models import Notificacion, RegistroAsistencia

        ayer = timezone.localdate() - timedelta(days=1)
        entrada = timezone.make_aware(timezone.datetime.combine(ayer, timezone.datetime.min.time())) + timedelta(hours=8)
        reg = RegistroAsistencia.objects.create(trabajadora=self.trab_taller, fecha=ayer, entrada=entrada)
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        r = taller.get("/api/taller/mi-panel/")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        reg.refresh_from_db()
        self.assertTrue(reg.cierre_automatico)
        self.assertIsNotNone(reg.salida)
        self.assertLessEqual((reg.salida - reg.entrada).total_seconds(), 8 * 3600 + 1)
        self.assertIsNotNone(r.data["ultima_jornada_automatica"])
        # Le llega aviso a ella y a la jefa.
        self.assertTrue(Notificacion.objects.filter(usuario=self.user_taller, tipo="JORNADA").exists())
        self.assertTrue(Notificacion.objects.filter(usuario=self.jefa, tipo="JORNADA").exists())

        r = taller.post("/api/taller/horas-extra/", {"horas": "1.5", "motivo": "Acabé el bordado"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        reg.refresh_from_db()
        self.assertEqual(reg.horas_extra, Decimal("1.50"))
        self.assertEqual(reg.motivo_horas_extra, "Acabé el bordado")

    def test_notificaciones_api(self):
        self.crear()
        jefa = APIClient(); jefa.force_authenticate(self.jefa)
        r = jefa.get("/api/core/notificaciones/")
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(r.data["unread"], 1)
        primera = r.data["items"][0]
        self.assertEqual(jefa.post(f"/api/core/notificaciones/{primera['id']}/leer/").status_code, 200)
        jefa.post("/api/core/notificaciones/leer-todas/")
        self.assertEqual(jefa.get("/api/core/notificaciones/").data["unread"], 0)


class PersonalYCapacidadJefaTestCase(BaseContratos):
    def test_personal_lista_detalle_y_capacidad(self):
        from core.models import RegistroAsistencia

        self.crear()
        ayer = timezone.localdate() - timedelta(days=1)
        entrada = timezone.make_aware(timezone.datetime.combine(ayer, timezone.datetime.min.time())) + timedelta(hours=8)
        RegistroAsistencia.objects.create(
            trabajadora=self.trab_taller, fecha=ayer, entrada=entrada,
            salida=entrada + timedelta(hours=9), horas_extra=Decimal("1"), motivo_horas_extra="Bordado urgente",
        )
        jefa = APIClient(); jefa.force_authenticate(self.jefa)

        r = jefa.get("/api/core/produccion/personal/")
        self.assertEqual(r.status_code, 200)
        yo = next(w for w in r.data if w["id"] == str(self.trab_taller.id))
        self.assertEqual(len(yo["schedule"]), 7)
        self.assertTrue(yo["skills"])

        r = jefa.get(f"/api/core/produccion/personal/{self.trab_taller.id}/?dias=7")
        self.assertEqual(r.status_code, 200)
        dia = next(d for d in r.data["history"] if str(d["date"]) == str(ayer))
        self.assertEqual(dia["extra"], 1.0)
        self.assertEqual(dia["extraReason"], "Bordado urgente")
        self.assertEqual(r.data["totals"]["daysWorked"], 1)

        r = jefa.get("/api/core/produccion/capacidad-areas/?semana=0")
        self.assertEqual(r.status_code, 200)
        confeccion = next(a for a in r.data["areas"] if a["code"] == "CONFECCION")
        self.assertIn(self.trab_taller.nombre, [w["name"] for w in confeccion["workers"]])
        self.assertGreater(confeccion["capacity"], 0)

        # La trabajadora no puede ver el personal.
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        self.assertEqual(taller.get("/api/core/produccion/personal/").status_code, 403)


class ComercialTestCase(BaseContratos):
    def test_inicio_ingresos_y_vestidos_solo_lectura(self):
        c = self.crear()["contrato"]
        api = self.api  # comercial
        r = api.get("/api/core/comercial/inicio/")
        self.assertEqual(r.status_code, 200)
        self.assertGreater(r.data["kpis"]["collectedMonth"], 0)
        self.assertTrue(any(d["contractId"] == c["id"] for d in r.data["deliveries"]) or r.data["deliveries"] == [])

        r = api.get("/api/core/comercial/ingresos/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["totals"]["count"], len(r.data["payments"]))
        self.assertGreater(r.data["totals"]["total"], 0)
        r = api.get("/api/core/comercial/ingresos/?origen=taller")
        self.assertEqual(r.data["totals"]["total"], 0)

        # Comercial ve los vestidos pero no los cambia.
        r = api.get("/api/core/produccion/vestidos/")
        self.assertEqual(r.status_code, 200)
        vid = r.data[0]["id"]
        self.assertEqual(api.post(f"/api/core/produccion/vestidos/{vid}/iniciar-proceso/").status_code, 403)

        # La jefa de taller no entra a ingresos.
        jefa = APIClient(); jefa.force_authenticate(self.jefa)
        self.assertEqual(jefa.get("/api/core/comercial/ingresos/").status_code, 403)


class GerenciaFinanzasTestCase(BaseContratos):
    def setUp(self):
        super().setUp()
        Usuario = get_user_model()
        self.gerente = Usuario.objects.create_user("gere", password="x", rol="gerencia")
        self.g = APIClient(); self.g.force_authenticate(self.gerente)

    def test_flujo_completo(self):
        from core.models import CategoriaFinanciera, MovimientoFinanciero

        self.crear()  # genera ingresos (adelantos)
        cat = CategoriaFinanciera.objects.get(nombre="Telas y encajes")
        alquiler = CategoriaFinanciera.objects.get(nombre="Alquiler del local")
        mes = timezone.localdate().strftime("%Y-%m")

        # Meta general y meta del mes
        r = self.g.patch("/api/core/gerencia/configuracion/", {"monthlyGoal": "40000", "targetMargin": "35"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["monthlyGoal"], 40000.0)
        r = self.g.post("/api/core/gerencia/metas/", {"month": mes, "goal": "50000"}, format="json")
        self.assertEqual(r.data["customGoals"][0]["goal"], 50000.0)

        # Gasto pagado y uno por pagar
        r = self.g.post("/api/core/gerencia/gastos/", {"concept": "Tul francés", "amount": "350.50", "categoryId": cat.id, "supplier": "Gamarra"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        gid = r.data["id"]
        self.assertTrue(MovimientoFinanciero.objects.filter(gasto_id=gid, tipo="EGRESO").exists())
        self.g.post("/api/core/gerencia/gastos/", {"concept": "Luz", "amount": "120", "categoryId": cat.id, "status": "PENDIENTE"}, format="json")
        self.assertEqual(self.g.post("/api/core/gerencia/gastos/", {"concept": "", "amount": "1", "categoryId": cat.id}, format="json").status_code, 400)

        # Gasto fijo mensual y su pago
        r = self.g.post("/api/core/gerencia/fijos/", {"name": "Alquiler", "amount": "2500", "categoryId": alquiler.id, "payDay": 30}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        fid = r.data["id"]

        r = self.g.get(f"/api/core/gerencia/finanzas/?mes={mes}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["expense"]["paid"], 350.5)
        self.assertEqual(r.data["expense"]["pendingMonth"], 2620.0)
        self.assertEqual(r.data["goal"]["amount"], 50000.0)
        self.assertGreater(r.data["income"]["total"], 0)
        self.assertEqual(r.data["result"]["profitEstimated"], round(r.data["income"]["total"] - 2970.5, 2))

        r = self.g.post(f"/api/core/gerencia/fijos/{fid}/pagar/", {"month": mes}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.g.post(f"/api/core/gerencia/fijos/{fid}/pagar/", {"month": mes}, format="json").status_code, 400)
        r = self.g.get(f"/api/core/gerencia/finanzas/?mes={mes}")
        self.assertEqual(r.data["expense"]["paid"], 2850.5)
        self.assertEqual(r.data["expense"]["pendingMonth"], 120.0)

        # Borrar un fijo con pagos lo desactiva
        r = self.g.delete(f"/api/core/gerencia/fijos/{fid}/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["fixed"]["active"])

        self.assertEqual(self.g.get("/api/core/gerencia/horas/").status_code, 200)
        r = self.g.get("/api/core/gerencia/indicadores/?meses=3")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["series"]), 3)

        # Comercial no entra a finanzas de gerencia
        self.assertEqual(self.api.get("/api/core/gerencia/finanzas/").status_code, 403)
