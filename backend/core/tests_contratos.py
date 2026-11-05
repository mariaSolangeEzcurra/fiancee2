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


class ContratosTestCase(TestCase):
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

    # --------------------------------------------------------

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
        self.assertEqual([a["concepto"] for a in c["adelantos"]], ["Primer adelanto", "Segundo adelanto"])
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
        self.crear()
        taller = APIClient(); taller.force_authenticate(self.user_taller)
        r = taller.get("/api/gerencia/personal/vestidos-disponibles/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 2)  # el velo no pasa por el taller
        self.assertEqual(r.data[0]["cliente"], "María Pérez")

        r = taller.get("/api/gerencia/personal/mis-trabajos/")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))


class VestidoEnTiendaTestCase(ContratosTestCase):
    def setUp(self):
        super().setUp()
        self.tienda = TipoVestido.objects.get(nombre="Vestido en tienda")
        self.ruta_t = RutaProduccion.objects.get(tipo_vestido=self.tienda, taller="T")
        self.plantillas = {p.operacion.nombre: p for p in self.ruta_t.operaciones.select_related("operacion")}

    def test_ruta_tienda_sin_compra(self):
        self.assertNotIn("compra materiales", self.plantillas)
        self.assertIn("entalle", self.plantillas)

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
