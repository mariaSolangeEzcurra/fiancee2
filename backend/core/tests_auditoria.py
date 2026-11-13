"""
Auditoría de punta a punta: cada rol hace su trabajo y se verifica que
precios, saldos, horarios, horas y finanzas cuadren en TODAS las pantallas.

    python manage.py test core.tests_auditoria
"""

from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    AusenciaTrabajadora,
    CategoriaFinanciera,
    Contrato,
    DisponibilidadSemanal,
    MovimientoFinanciero,
    Notificacion,
    Pago,
    PasoVestido,
    RegistroAsistencia,
    ReservaOperacion,
    SesionVestido,
    Trabajadora,
    VestidoContrato,
)
from core.services.planificacion import CapacidadTaller
from core.tests_contratos import URL, BaseContratos

D = Decimal


def aware(fecha, h, m=0):
    return timezone.make_aware(datetime.combine(fecha, time(h, m)))


class Auditoria(BaseContratos):
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

    # ─── utilidades ──────────────────────────────────────
    def contrato(self, cid):
        r = self.api.get(f"{URL}{cid}/")
        self.assertEqual(r.status_code, 200)
        return r.data

    def prod(self, vestido_id):
        r = self.jef.get(f"/api/core/produccion/vestidos/{vestido_id}/")
        self.assertEqual(r.status_code, 200, r.data)
        return r.data["dress"]

    def assertDinero(self, a, b, msg=""):
        self.assertEqual(D(str(a)).quantize(D("0.01")), D(str(b)).quantize(D("0.01")), msg)


class PreciosYSaldos(Auditoria):
    """Un mismo contrato debe mostrar el mismo total, pagado y saldo en todos lados."""

    def test_precio_pagos_cobros_y_saldo_cuadran_en_todas_las_pantallas(self):
        c = self.crear()["contrato"]
        cid = c["id"]
        # Ítems: 3500 + (900 + 100) + 150 = 4650 ; adelantos 1000 + 500
        self.assertDinero(c["precio_total"], "4650")
        self.assertDinero(c["total_pagado"], "1500")
        self.assertDinero(c["saldo_pendiente"], "3150")
        v1 = next(v for v in c["vestidos"] if v["taller"] == "A")

        # Jefa: tercer pago desde el taller (ligado al vestido)
        r = self.jef.post(f"/api/core/produccion/vestidos/{v1['id']}/pagos/",
                          {"amount": "400", "number": 3, "method": "TARJETA", "notes": "pagó la mamá"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        # El mismo número no se puede repetir
        r = self.jef.post(f"/api/core/produccion/vestidos/{v1['id']}/pagos/", {"amount": "10", "number": 2}, format="json")
        self.assertEqual(r.status_code, 400)

        # Jefa: cobro extra de 250 (sube el total)
        r = self.jef.post(f"/api/core/produccion/vestidos/{v1['id']}/cargos/", {"concept": "Pedrería extra", "amount": "250"}, format="json")
        self.assertIn(r.status_code, (200, 201), r.data)

        total, pagado, saldo = D("4900"), D("1900"), D("3000")
        c = self.contrato(cid)
        self.assertDinero(c["precio_total"], total, "total en el contrato")
        self.assertDinero(c["total_pagado"], pagado, "pagado en el contrato")
        self.assertDinero(c["saldo_pendiente"], saldo, "saldo en el contrato")
        terc = next(a for a in c["adelantos"] if a["orden_adelanto"] == 3)
        self.assertDinero(terc["importe"], "400")
        self.assertEqual(terc["observaciones"], "pagó la mamá")

        f = self.prod(v1["id"])["finance"]
        self.assertDinero(f["contractTotal"], total, "total en taller")
        self.assertDinero(f["contractBalance"], saldo, "saldo en taller")
        self.assertEqual(sorted(f["usedPaymentNumbers"]), [1, 2, 3])
        self.assertDinero(sum(p["amount"] for p in f["payments"]), pagado, "pagos en taller")

        # Comercial: ingresos del mes y por cobrar
        ing = self.api.get("/api/core/comercial/ingresos/").data
        self.assertDinero(ing["totals"]["total"], pagado)
        self.assertDinero(ing["totals"]["fromWorkshop"], "400")
        self.assertDinero(ing["totals"]["toCollectAll"], saldo)
        self.assertDinero(sum(m["total"] for m in ing["byMethod"]), pagado)
        self.assertDinero(sum(t["total"] for t in ing["byType"]), pagado)
        self.assertDinero(sum(d["total"] for d in ing["days"]), pagado)
        self.assertDinero(self.api.get("/api/core/comercial/inicio/").data["kpis"]["toCollect"], saldo)

        # Gerencia: finanzas
        fin = self.ger.get("/api/core/gerencia/finanzas/").data
        self.assertDinero(fin["income"]["total"], pagado)
        self.assertDinero(fin["income"]["toCollectAll"], saldo)
        self.assertDinero(fin["income"]["sold"], total)

        # Contabilidad: un movimiento de ingreso por pago
        self.assertDinero(
            MovimientoFinanciero.objects.filter(tipo="INGRESO").aggregate(t=Sum("importe"))["t"], pagado
        )

        # Comercial edita el contrato reenviando sus adelantos: el pago del taller no se pierde ni se duplica.
        c = self.contrato(cid)
        datos = self.payload(vestidos=[
            {"id": v["id"], "tipo_vestido": v["tipo_vestido"], "taller": v["taller"], "modalidad": v["modalidad"],
             "precio": v["precio_venta"] if v["modalidad"] == "VENTA" else v["precio_alquiler"],
             "precio_otros": v["precio_otros"], "descripcion": v["descripcion"]}
            for v in c["vestidos"]
        ], adelantos=[
            {"importe": "1000.00", "metodo": "EFECTIVO"},
            {"importe": "500.00", "metodo": "TRANSFERENCIA", "referencia": "OP-1"},
            {"importe": "400.00", "metodo": "TARJETA"},
        ])
        r = self.api.put(f"{URL}{cid}/", datos, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(Pago.objects.filter(contrato_id=cid).count(), 3)
        p3 = Pago.objects.get(contrato_id=cid, orden_adelanto=3)
        self.assertIsNotNone(p3.vestido_id, "el pago del taller sigue ligado al vestido")
        self.assertEqual(p3.observaciones, "pagó la mamá")
        c = self.contrato(cid)
        self.assertDinero(c["precio_total"], total, "el cobro extra se mantiene tras editar")
        self.assertDinero(c["saldo_pendiente"], saldo)

        # No se puede cobrar más que el total
        r = self.jef.post(f"/api/core/produccion/vestidos/{v1['id']}/pagos/", {"amount": "3000.01"}, format="json")
        self.assertEqual(r.status_code, 400)
        # Pago exacto del saldo deja todo en cero
        r = self.jef.post(f"/api/core/produccion/vestidos/{v1['id']}/pagos/", {"amount": "3000"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertDinero(self.contrato(cid)["saldo_pendiente"], "0")
        self.assertDinero(self.ger.get("/api/core/gerencia/finanzas/").data["income"]["toCollectAll"], "0")


class PlanificacionYHorarios(Auditoria):
    """Las horas reservadas respetan el horario de cada persona, permisos, fechas y la regla del bordado."""

    def verificar_reservas(self):
        hoy = timezone.localdate()
        horario = {(h.trabajadora_id, h.dia_semana): h.horas_disponibles for h in DisponibilidadSemanal.objects.all()}
        ausencias = list(AusenciaTrabajadora.objects.all())
        por_dia = defaultdict(D)
        for r in ReservaOperacion.objects.exclude(estado="CANCELADA").select_related("vestido", "plantilla__operacion"):
            base = horario.get((r.trabajadora_id, r.fecha.weekday()), D("0"))
            for a in ausencias:
                if a.trabajadora_id == r.trabajadora_id and a.fecha_inicio <= r.fecha <= a.fecha_fin:
                    base = max(D("0"), base - a.horas_no_disponibles)
            self.assertGreater(base, 0, f"{r.vestido.codigo}: reserva el {r.fecha} sin horario ({r.trabajadora})")
            self.assertGreaterEqual(r.fecha, hoy, "no se reserva en el pasado")
            if r.fecha > r.vestido.fecha_limite_efectiva:
                # Solo pasa cuando no alcanza el tiempo: el vestido debe quedar marcado como atrasado.
                self.assertGreater(r.vestido.fecha_fin_estimada, r.vestido.fecha_limite_efectiva,
                                   f"{r.vestido.codigo}: reserva después de la entrega sin marcarlo atrasado")
            self.assertTrue(
                r.trabajadora.habilidades.filter(pk=r.plantilla.operacion_id).exists()
                or r.trabajadora.area == r.plantilla.operacion.area_responsable,
                f"{r.trabajadora} no sabe hacer {r.plantilla.operacion}",
            )
            por_dia[(r.trabajadora_id, r.fecha)] += r.horas_reservadas
            por_dia[("base", r.trabajadora_id, r.fecha)] = base
        for k, v in por_dia.items():
            if k[0] == "base":
                continue
            self.assertLessEqual(v, por_dia[("base",) + k], f"Sobrecarga de {k}: {v} h")

    def test_reservas_respetan_horario_capacidad_y_fechas(self):
        self.crear()
        self.crear(datos_cliente={"nombre": "Rosa Q.", "documento": "11111111", "telefono": "999111222"},
                   fecha_entrega=str(self.hoy + timedelta(days=40)), fecha_evento=str(self.hoy + timedelta(days=45)),
                   fecha_devolucion=str(self.hoy + timedelta(days=47)))
        self.verificar_reservas()

        # Las horas reservadas de cada vestido = horas de sus pasos de trabajo (lo no asignado queda registrado aparte)
        for v in VestidoContrato.objects.filter(ruta__isnull=False):
            reservado = ReservaOperacion.objects.filter(vestido=v).exclude(estado="CANCELADA").aggregate(t=Sum("horas_reservadas"))["t"] or D("0")
            pasos = sum((p.horas_estimadas for p in v.pasos.all() if not p.es_entrega and p.tipo_tiempo == "TRABAJO"), D("0"))
            self.assertDinero(reservado + v.horas_sin_asignar, pasos, f"{v.codigo}: horas reservadas ≠ horas de sus procesos")

    def test_permiso_libera_el_dia_al_replanificar(self):
        c = self.crear()["contrato"]
        r0 = ReservaOperacion.objects.exclude(estado="CANCELADA").order_by("fecha").first()
        self.assertIsNotNone(r0)
        AusenciaTrabajadora.objects.create(trabajadora=r0.trabajadora, fecha_inicio=r0.fecha, fecha_fin=r0.fecha,
                                           horas_no_disponibles=D("8"), motivo="Cita médica")
        r = self.api.post(f"{URL}{c['id']}/planificacion/", {}, format="json")
        if r.status_code == 405:
            r = self.api.put(f"{URL}{c['id']}/", self.payload(), format="json")
        self.assertIn(r.status_code, (200, 201), getattr(r, "data", None))
        self.assertFalse(
            ReservaOperacion.objects.exclude(estado="CANCELADA").filter(trabajadora=r0.trabajadora, fecha=r0.fecha).exists(),
            "no debe quedar trabajo el día del permiso",
        )
        self.verificar_reservas()

    def test_bordado_empieza_15_dias_antes(self):
        self.crear()
        for r in ReservaOperacion.objects.exclude(estado="CANCELADA").select_related("vestido", "plantilla__operacion"):
            if "bordado" in r.plantilla.operacion.nombre.lower():
                self.assertGreaterEqual(
                    r.fecha, r.vestido.fecha_limite_efectiva - timedelta(days=15),
                    f"{r.vestido.codigo}: bordado antes de los 15 días",
                )

    def test_capacidad_por_area_cuadra_con_los_horarios(self):
        self.crear()
        data = self.jef.get("/api/core/produccion/capacidad-areas/?semana=1").data
        desde = timezone.localdate() + timedelta(days=7)
        dias = [desde + timedelta(days=i) for i in range(7)]
        cap = CapacidadTaller(desde, dias=6)
        esperado = sum((cap.base(t.id, d) for t in Trabajadora.objects.filter(activa=True) for d in dias), D("0"))
        self.assertDinero(data["totals"]["capacity"], esperado)
        # Cada persona: 8 h × 6 días = 48 h a la semana
        self.assertDinero(esperado, Trabajadora.objects.filter(activa=True).count() * 48)
        reservado = ReservaOperacion.objects.exclude(estado="CANCELADA").filter(fecha__range=(dias[0], dias[-1])).aggregate(t=Sum("horas_reservadas"))["t"] or 0
        self.assertDinero(data["totals"]["busy"], reservado)
        for a in data["areas"]:
            self.assertLessEqual(a["busy"], a["capacity"] + 0.01)
            self.assertDinero(a["free"], max(0, a["capacity"] - a["busy"]))
            self.assertDinero(sum(w["hours"] for w in a["workers"]), a["capacity"])
            self.assertDinero(sum(d["capacity"] for d in a["days"]), a["capacity"])


class Simulador(Auditoria):
    def test_simulacion_sin_cliente_y_aceptacion_crea_el_mismo_plan(self):
        datos = {
            "fecha_entrega": str(self.hoy + timedelta(days=60)),
            "fecha_evento": str(self.hoy + timedelta(days=65)),
            "vestidos": [{"tipo_vestido": self.sirena.id, "taller": "A", "cantidad": 1}],
        }
        r = self.api.post("/api/core/simulador/", datos, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn(r.data["veredicto"], ("FACTIBLE", "FACTIBLE_CON_CONDICIONES"))
        # Simular no reserva nada
        self.assertEqual(ReservaOperacion.objects.count(), 0)

        # Un pedido imposible (mañana, 20 vestidos) no es factible
        r = self.api.post("/api/core/simulador/", {
            "fecha_entrega": str(self.hoy + timedelta(days=2)),
            "vestidos": [{"tipo_vestido": self.sirena.id, "taller": "A", "cantidad": 20}],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["veredicto"], "NO_FACTIBLE")


class JornadasYHoras(Auditoria):
    def test_horas_trabajadas_pausas_extra_y_cierre_automatico(self):
        t = self.trab_taller
        lunes = timezone.localdate() - timedelta(days=timezone.localdate().weekday() + 7)  # lunes pasado
        # Lunes: 8:00–17:00 = 9 h, con 1 h extra declarada
        RegistroAsistencia.objects.create(trabajadora=t, fecha=lunes, entrada=aware(lunes, 8), salida=aware(lunes, 17),
                                          horas_extra=D("1"), motivo_horas_extra="Entrega urgente")
        # Martes: olvidó marcar salida → se cierra con su horario (8 h)
        martes = lunes + timedelta(days=1)
        reg_martes = RegistroAsistencia.objects.create(trabajadora=t, fecha=martes, entrada=aware(martes, 8))
        # Miércoles: faltó. Jueves: permiso.
        jueves = lunes + timedelta(days=3)
        AusenciaTrabajadora.objects.create(trabajadora=t, fecha_inicio=jueves, fecha_fin=jueves, horas_no_disponibles=D("8"), motivo="Permiso")

        r = self.ger.get(f"/api/core/gerencia/horas/?desde={lunes}&hasta={lunes + timedelta(days=5)}")
        self.assertEqual(r.status_code, 200, r.data)
        fila = next(x for x in r.data["rows"] if x["id"] == str(t.id))
        reg_martes.refresh_from_db()
        self.assertTrue(reg_martes.cierre_automatico)
        self.assertEqual(reg_martes.salida, aware(martes, 16), "se cierra a las 8 h de su entrada")
        # Le tocaban: lun–sáb 6 × 8 = 48, menos jueves (permiso) = 40
        self.assertDinero(fila["scheduled"], "40")
        self.assertDinero(fila["worked"], "17")  # 9 + 8
        self.assertDinero(fila["extra"], "1")
        self.assertEqual(fila["daysWorked"], 2)
        self.assertEqual(fila["absences"], 1)
        self.assertEqual(fila["missed"], 3, "miércoles, viernes y sábado sin marcar")
        self.assertEqual(fila["autoClosed"], 1)

        # Historial de la ficha (jefa) muestra lo mismo
        det = self.jef.get(f"/api/core/produccion/personal/{t.id}/?dias=30").data
        dias = {str(h["date"]): h for h in det["history"]}
        self.assertEqual(dias[str(lunes)]["status"], "COMPLETO")
        self.assertEqual(dias[str(martes)]["status"], "CIERRE_AUTOMATICO")
        self.assertEqual(dias[str(lunes + timedelta(days=2))]["status"], "NO_VINO")
        self.assertEqual(dias[str(jueves)]["status"], "PERMISO")

    def test_sesion_con_pausa_descuenta_la_pausa(self):
        c = self.crear()["contrato"]
        v = VestidoContrato.objects.get(contrato_id=c["id"], ruta__taller="A")
        paso = v.pasos.order_by("orden").first()
        self.trab_taller.habilidades.add(paso.operacion) if getattr(paso, "operacion", None) else None
        hoy = timezone.localdate()
        reg = RegistroAsistencia.objects.create(trabajadora=self.trab_taller, fecha=hoy, entrada=timezone.now() - timedelta(hours=3))
        s = SesionVestido.objects.create(trabajadora=self.trab_taller, vestido=v, paso=paso, jornada=reg,
                                         inicio=timezone.now() - timedelta(hours=2), fin=timezone.now())
        from core.models import PausaSesionVestido
        PausaSesionVestido.objects.create(sesion=s, inicio=timezone.now() - timedelta(minutes=90), fin=timezone.now() - timedelta(minutes=60))
        s.refresh_from_db()
        self.assertAlmostEqual(float(s.horas_efectivas), 1.5, places=2)


class FinanzasGerencia(Auditoria):
    def test_gastos_fijos_frecuencias_utilidad_y_meta(self):
        self.crear()  # ingresos del mes: 1500
        cat = CategoriaFinanciera.objects.get(nombre="Otros gastos")
        mes = timezone.localdate().strftime("%Y-%m")
        self.ger.patch("/api/core/gerencia/configuracion/", {"monthlyGoal": "10000", "targetMargin": "30"}, format="json")
        # Fijos: mensual 1000, semanal 120 (→ 520 al mes), anual 1200 (→ 100 al mes)
        for nombre, monto, frec in (("Mensual", "1000", "MENSUAL"), ("Semanal", "120", "SEMANAL"), ("Anual", "1200", "ANUAL")):
            r = self.ger.post("/api/core/gerencia/fijos/", {"name": nombre, "amount": monto, "categoryId": cat.id, "frequency": frec,
                                                            "from": f"{mes}-01"}, format="json")
            self.assertEqual(r.status_code, 201, r.data)
        r = self.ger.get(f"/api/core/gerencia/fijos/?mes={mes}").data
        self.assertDinero(r["monthlyTotal"], "1620")
        # Gasto pagado 200 y por pagar 80
        self.ger.post("/api/core/gerencia/gastos/", {"concept": "Hilos", "amount": "200", "categoryId": cat.id}, format="json")
        self.ger.post("/api/core/gerencia/gastos/", {"concept": "Luz", "amount": "80", "categoryId": cat.id, "status": "PENDIENTE"}, format="json")

        f = self.ger.get(f"/api/core/gerencia/finanzas/?mes={mes}").data
        self.assertDinero(f["income"]["total"], "1500")
        self.assertDinero(f["expense"]["paid"], "200")
        self.assertDinero(f["expense"]["pendingMonth"], "1700")  # 1620 fijos + 80
        self.assertDinero(f["expense"]["month"], "1900")
        self.assertDinero(f["result"]["profit"], "1300")
        self.assertDinero(f["result"]["profitEstimated"], "-400")
        self.assertDinero(f["result"]["breakEven"], "1900")
        self.assertDinero(f["goal"]["missing"], "8500")
        if f["goal"]["daysLeft"]:
            self.assertDinero(f["goal"]["perDay"], D("8500") / f["goal"]["daysLeft"])
        # Gasto pagado = movimiento de egreso; al pasar a pendiente se quita
        g = self.ger.get("/api/core/gerencia/gastos/?estado=PAGADO").data["items"][0]
        self.assertTrue(MovimientoFinanciero.objects.filter(gasto_id=g["id"], tipo="EGRESO").exists())
        self.ger.patch(f"/api/core/gerencia/gastos/{g['id']}/", {"status": "PENDIENTE"}, format="json")
        self.assertFalse(MovimientoFinanciero.objects.filter(gasto_id=g["id"]).exists())
        # Indicadores coinciden con finanzas para el mes actual
        ind = self.ger.get("/api/core/gerencia/indicadores/?meses=1").data
        self.assertDinero(ind["series"][-1]["income"], "1500")
        self.assertDinero(ind["series"][-1]["expense"], "0")


class Notificaciones(Auditoria):
    def test_cada_accion_avisa_a_quien_corresponde(self):
        Notificacion.objects.all().delete()
        c = self.crear()["contrato"]
        self.assertTrue(Notificacion.objects.filter(usuario=self.jefa, tipo="CONTRATO").exists(), "jefa: nuevo contrato")

        v = next(x for x in c["vestidos"] if x["taller"] == "A")
        d = self.prod(v["id"])
        paso = d["steps"][d["currentIndex"]]
        # Asignar a alguien que sabe el proceso
        quien = int(paso["eligibleWorkerIds"][0])
        t = Trabajadora.objects.get(pk=quien)
        t.usuario = self.user_taller if t.usuario_id is None and quien == self.trab_taller.id else t.usuario
        r = self.jef.post(f"/api/core/produccion/vestidos/{v['id']}/pasos/{d['currentIndex']}/trabajadoras/", {"workerId": quien}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        # Asignar a alguien que NO sabe el proceso → error
        nosabe = Trabajadora.objects.exclude(pk__in=[int(x) for x in paso["eligibleWorkerIds"]]).first()
        r = self.jef.post(f"/api/core/produccion/vestidos/{v['id']}/pasos/{d['currentIndex']}/trabajadoras/", {"workerId": nosabe.id}, format="json")
        self.assertEqual(r.status_code, 400, "no se puede asignar fuera de sus habilidades")

        self.jef.post(f"/api/core/produccion/vestidos/{v['id']}/pagos/", {"amount": "100"}, format="json")
        self.assertTrue(Notificacion.objects.filter(usuario=self.comercial, tipo="PAGO").exists(), "comercial: pago en taller")
        self.assertTrue(Notificacion.objects.filter(usuario=self.gerente, tipo="PAGO").exists(), "gerencia: pago en taller")
        self.jef.post(f"/api/core/produccion/vestidos/{v['id']}/cargos/", {"concept": "Extra", "amount": "50"}, format="json")
        self.assertTrue(Notificacion.objects.filter(usuario=self.comercial, tipo="COBRO").exists(), "comercial: cobro extra")


class PermisosPorRol(Auditoria):
    """Cada rol entra solo a lo suyo; lo de solo lectura no se puede modificar."""

    def test_matriz_de_permisos(self):
        c = self.crear()["contrato"]
        vid = next(x["id"] for x in c["vestidos"] if x["taller"] == "A")
        clientes = {"comercial": self.api, "jefa": self.jef, "taller": self.tal, "gerencia": self.ger}
        ok = lambda code: code < 400  # noqa: E731
        casos = [
            # (método, url, datos, roles que SÍ pueden)
            ("get", URL, None, {"comercial", "jefa", "gerencia"}),
            ("post", "/api/core/simulador/", {"fecha_entrega": str(self.hoy + timedelta(days=90)), "vestidos": [{"tipo_vestido": self.mini.id, "taller": "A"}]}, {"comercial", "jefa", "gerencia"}),
            ("get", "/api/core/produccion/vestidos/", None, {"comercial", "jefa", "gerencia"}),
            ("post", f"/api/core/produccion/vestidos/{vid}/notas/", {"text": "hola"}, {"jefa"}),
            ("post", f"/api/core/produccion/vestidos/{vid}/pagos/", {"amount": "1"}, {"jefa"}),
            ("get", "/api/core/produccion/personal/", None, {"jefa", "gerencia"}),
            ("get", "/api/core/produccion/capacidad-areas/", None, {"jefa", "gerencia"}),
            ("get", "/api/core/comercial/inicio/", None, {"comercial", "gerencia"}),
            ("get", "/api/core/comercial/ingresos/", None, {"comercial", "gerencia"}),
            ("get", "/api/core/gerencia/finanzas/", None, {"gerencia"}),
            ("post", "/api/core/gerencia/gastos/", {"concept": "x", "amount": "1", "categoryId": CategoriaFinanciera.objects.filter(tipo="EGRESO").first().id}, {"gerencia"}),
            ("get", "/api/core/gerencia/horas/", None, {"gerencia"}),
            ("get", "/api/core/gerencia/indicadores/", None, {"gerencia"}),
            ("get", "/api/taller/mi-panel/", None, {"taller"}),
            ("get", "/api/core/notificaciones/", None, {"comercial", "jefa", "taller", "gerencia"}),
            ("post", URL, self.payload(datos_cliente={"nombre": "X", "documento": "22222222"}), {"comercial"}),
            ("put", f"{URL}{c['id']}/", self.payload(), {"comercial"}),
        ]
        fallas = []
        for metodo, url, datos, pueden in casos:
            for rol, cli in clientes.items():
                r = getattr(cli, metodo)(url, datos, format="json") if datos is not None else getattr(cli, metodo)(url)
                if ok(r.status_code) != (rol in pueden):
                    fallas.append(f"{metodo.upper()} {url} [{rol}] → {r.status_code}")
        self.assertEqual(fallas, [], "\n".join(fallas))


class FlujoTrabajadora(Auditoria):
    def test_trabajadora_ve_solo_lo_suyo_y_su_tiempo_llega_a_la_jefa(self):
        c = self.crear()["contrato"]
        v = VestidoContrato.objects.get(contrato_id=c["id"], ruta__taller="A")
        d = self.prod(v.id)
        idx = d["currentIndex"]
        paso = v.pasos.order_by("orden")[idx]
        # La trabajadora sabe hacer el primer proceso
        self.trab_taller.habilidades.add(*[op for op in [getattr(paso, "operacion", None)] if op])
        r = self.jef.post(f"/api/core/produccion/vestidos/{v.id}/pasos/{idx}/trabajadoras/", {"workerId": self.trab_taller.id}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(Notificacion.objects.filter(usuario=self.user_taller, tipo="ASIGNACION").exists(), "le llega el aviso")
        # Antes de que la jefa inicie el proceso, no puede trabajarlo
        self.tal.post("/api/taller/mi-jornada/iniciar/", {}, format="json")
        r = self.tal.post("/api/taller/sesiones-vestido/iniciar/", {"vestido_id": v.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.jef.post(f"/api/core/produccion/vestidos/{v.id}/iniciar-proceso/", {}, format="json")
        disp = self.tal.get("/api/taller/vestidos-disponibles/").data
        self.assertIn(v.id, [x.get("vestido_id", x.get("id")) for x in disp])
        r = self.tal.post("/api/taller/sesiones-vestido/iniciar/", {"vestido_id": v.id}, format="json")
        self.assertIn(r.status_code, (200, 201), r.data)
        # La jefa ve quién está trabajando
        self.assertIsNotNone(self.prod(v.id)["activeSession"])
        personal = self.jef.get("/api/core/produccion/personal/").data
        yo = next(x for x in personal if x["id"] == str(self.trab_taller.id))
        self.assertEqual(yo["today"]["status"], "TRABAJANDO")
        self.assertEqual(yo["activeSession"]["dress"], v.codigo)
        # Al terminar la jornada, la sesión abierta se cierra
        r = self.tal.post("/api/taller/mi-jornada/finalizar/", {"horas_extra": "0.5", "motivo_horas_extra": "Terminé el corte"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(SesionVestido.objects.filter(trabajadora=self.trab_taller, fin__isnull=True).exists())
        reg = RegistroAsistencia.objects.get(trabajadora=self.trab_taller, fecha=timezone.localdate())
        self.assertDinero(reg.horas_extra, "0.5")


class SimuladorVsContrato(Auditoria):
    def test_lo_que_dice_el_simulador_es_lo_que_se_planifica(self):
        # Un pedido ya en curso ocupa parte del taller
        self.crear()
        entrega = self.hoy + timedelta(days=75)
        for taller, tipo in (("A", self.sirena), ("C", self.mini), ("A", self.mini)):
            sim = self.api.post("/api/core/simulador/", {
                "fecha_entrega": str(entrega), "fecha_evento": str(entrega + timedelta(days=5)),
                "vestidos": [{"tipo_vestido": tipo.id, "taller": taller, "cantidad": 1}],
            }, format="json").data
            # Se crea el contrato con lo mismo (así lo hace la pantalla al aceptar)
            c = self.crear(datos_cliente={"nombre": f"Sim {taller}{tipo.id}", "documento": f"7{tipo.id}{ord(taller)}0000"[:8]},
                           fecha_entrega=str(entrega), fecha_evento=str(entrega + timedelta(days=5)),
                           fecha_devolucion=str(entrega + timedelta(days=7)), adelantos=[],
                           vestidos=[{"tipo_vestido": tipo.id, "taller": taller, "modalidad": "VENTA", "precio": "1000"}])["contrato"]
            v = VestidoContrato.objects.get(contrato_id=c["id"])
            self.assertEqual(str(v.fecha_fin_estimada), str(sim["fecha_fin_estimada"]),
                             f"{tipo} {taller}: simulador dijo {sim['fecha_fin_estimada']} y se planificó {v.fecha_fin_estimada}")
            a_tiempo = v.fecha_fin_estimada <= v.fecha_limite_efectiva
            self.assertEqual(a_tiempo, sim["veredicto"] != "NO_FACTIBLE", f"{tipo} {taller}: veredicto {sim['veredicto']}")


class GerenciaGestionaPersonal(Auditoria):
    def test_rol_gerencia_puede_gestionar_personal_y_horarios(self):
        r = self.ger.get("/api/gerencia/personal/trabajadoras/")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        t = Trabajadora.objects.first()
        r = self.ger.get(f"/api/gerencia/personal/trabajadoras/{t.id}/horarios/")
        self.assertEqual(r.status_code, 200)
        # Comercial y jefa no
        self.assertEqual(self.api.get("/api/gerencia/personal/trabajadoras/").status_code, 403)
        # La jefa de taller también gestiona al personal, pero no ve sueldos.
        r = self.jef.get("/api/gerencia/personal/trabajadoras/")
        self.assertEqual(r.status_code, 200)
        filas = r.data if isinstance(r.data, list) else r.data.get("results", [])
        self.assertTrue(all("sueldo_mensual" not in x for x in filas))


class DiaLibre(Auditoria):
    def test_dia_libre_muestra_libre_y_cierra_con_8_horas(self):
        t = self.trab_taller
        domingo = timezone.localdate() - timedelta(days=(timezone.localdate().weekday() + 1) % 7 or 7)
        self.assertEqual(domingo.weekday(), 6)
        from core.services.jornada import horas_para_cierre, horas_programadas
        self.assertEqual(horas_programadas(t, domingo), 0, "el domingo es libre")
        self.assertEqual(horas_para_cierre(t, domingo), 8)
        reg = RegistroAsistencia.objects.create(trabajadora=t, fecha=domingo, entrada=aware(domingo, 9))
        self.tal.get("/api/taller/mi-panel/")
        reg.refresh_from_db()
        self.assertEqual(reg.salida, aware(domingo, 17))
        # En el reporte: trabajó 8 h aunque no le tocaba nada ese día
        r = self.ger.get(f"/api/core/gerencia/horas/?desde={domingo}&hasta={domingo}").data
        fila = next(x for x in r["rows"] if x["id"] == str(t.id))
        self.assertDinero(fila["scheduled"], "0")
        self.assertDinero(fila["worked"], "8")
        self.assertEqual(fila["missed"], 0)
