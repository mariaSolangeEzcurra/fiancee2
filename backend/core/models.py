from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import Sum
from django.utils import timezone


# ============================================================
# 1. PERSONAL Y DISPONIBILIDAD
# ============================================================

class Trabajadora(models.Model):
    class Area(models.TextChoices):
        CONFECCION = "CONFECCION", "Confección"
        BORDADO = "BORDADO", "Bordado"
        COMPRAS = "COMPRAS", "Compras"
        PRUEBAS = "PRUEBAS", "Pruebas"
        LAVANDERIA = "LAVANDERIA", "Lavandería"
        ACABADOS = "ACABADOS", "Acabados"
        OTRO = "OTRO", "Otro"

    nombre = models.CharField(max_length=150)
    area = models.CharField(max_length=20, choices=Area.choices)
    activa = models.BooleanField(default=True)

    # Una persona puede tener varias habilidades.
    habilidades = models.ManyToManyField(
        "Operacion",
        blank=True,
        related_name="trabajadoras_habilitadas",
    )

    observaciones = models.TextField(blank=True)

    usuario = models.OneToOneField(
    settings.AUTH_USER_MODEL,
    on_delete=models.SET_NULL,
    null=True,
    blank=True,
    related_name="perfil_trabajadora",
)


    def __str__(self):
        return f"{self.nombre} - {self.get_area_display()}"


class DisponibilidadSemanal(models.Model):
    DIAS = [
        (0, "Lunes"),
        (1, "Martes"),
        (2, "Miércoles"),
        (3, "Jueves"),
        (4, "Viernes"),
        (5, "Sábado"),
        (6, "Domingo"),
    ]

    trabajadora = models.ForeignKey(
        Trabajadora,
        on_delete=models.CASCADE,
        related_name="horarios",
    )
    dia_semana = models.PositiveSmallIntegerField(choices=DIAS)
    horas_disponibles = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(Decimal("0"))],
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["trabajadora", "dia_semana"],
                name="horario_unico_por_trabajadora_dia",
            )
        ]
        ordering = ["dia_semana"]

    def __str__(self):
        return (
            f"{self.trabajadora.nombre} - "
            f"{self.get_dia_semana_display()}: "
            f"{self.horas_disponibles} h"
        )


class AusenciaTrabajadora(models.Model):
    trabajadora = models.ForeignKey(
        Trabajadora,
        on_delete=models.CASCADE,
        related_name="ausencias",
    )
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField()
    horas_no_disponibles = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(Decimal("0"))],
    )
    motivo = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return f"{self.trabajadora} - {self.fecha_inicio}"


# ============================================================
# 2. CATÁLOGO DE VESTIDOS Y OPERACIONES
# ============================================================

class TipoVestido(models.Model):
    nombre = models.CharField(max_length=100, unique=True)
    activo = models.BooleanField(default=True)
    descripcion = models.TextField(blank=True)

    def __str__(self):
        return self.nombre


class Operacion(models.Model):
    nombre = models.CharField(max_length=120, unique=True)
    area_responsable = models.CharField(
        max_length=20,
        choices=Trabajadora.Area.choices,
        default=Trabajadora.Area.OTRO,
    )
    descripcion = models.TextField(blank=True)
    activa = models.BooleanField(default=True)

    def __str__(self):
        return self.nombre


class RutaProduccion(models.Model):
    class Tipo(models.TextChoices):
        TALLER_A = "A", "Taller A - Confección desde cero"
        TALLER_C = "C", "Taller C - Compra y modificación"

    tipo_vestido = models.ForeignKey(
        TipoVestido,
        on_delete=models.PROTECT,
        related_name="rutas",
    )
    taller = models.CharField(max_length=1, choices=Tipo.choices)
    activa = models.BooleanField(default=True)
    descripcion = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tipo_vestido", "taller"],
                name="ruta_unica_por_tipo_y_taller",
            )
        ]

    def __str__(self):
        return f"{self.tipo_vestido} - Taller {self.taller}"


class PlantillaOperacion(models.Model):
    """
    Define cada etapa y sus tiempos editables para un vestido y ruta.

    TRABAJO: consume horas de una persona o recurso.
    ESPERA: transcurre tiempo, pero no consume horas de personal.
    """

    class TipoTiempo(models.TextChoices):
        TRABAJO = "TRABAJO", "Trabajo efectivo"
        ESPERA = "ESPERA", "Espera o plazo de proveedor"

    ruta = models.ForeignKey(
        RutaProduccion,
        on_delete=models.CASCADE,
        related_name="operaciones",
    )
    operacion = models.ForeignKey(
        Operacion,
        on_delete=models.PROTECT,
        related_name="plantillas",
    )
    orden = models.PositiveIntegerField(default=1)

    tipo_tiempo = models.CharField(
        max_length=10,
        choices=TipoTiempo.choices,
        default=TipoTiempo.TRABAJO,
    )

    # Cada proceso tiene su propio tiempo, modificable.
    horas_estimadas = models.DecimalField(
        max_digits=9,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )

    obligatoria = models.BooleanField(default=True)
    activa = models.BooleanField(default=True)

    # Permite indicar que una etapa debe esperar a otra.
    depende_de = models.ManyToManyField(
        "self",
        symmetrical=False,
        blank=True,
        related_name="operaciones_siguientes",
    )

    observaciones = models.TextField(blank=True)

    class Meta:
        ordering = ["orden", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["ruta", "operacion"],
                name="operacion_unica_por_ruta",
            )
        ]

    def __str__(self):
        return (
            f"{self.ruta} - {self.operacion}: "
            f"{self.horas_estimadas} h"
        )


# ============================================================
# 3. CLIENTES Y SIMULACIONES
# ============================================================

class Cliente(models.Model):
    nombre = models.CharField(max_length=180)
    documento = models.CharField(max_length=30, blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    correo = models.EmailField(blank=True)
    activo = models.BooleanField(default=True)
    observaciones = models.TextField(blank=True)

    def __str__(self):
        return self.nombre


class SimulacionContrato(models.Model):
    class Estado(models.TextChoices):
        BORRADOR = "BORRADOR", "Borrador"
        VIABLE = "VIABLE", "Viable"
        NO_VIABLE = "NO_VIABLE", "No viable"
        ACEPTADA = "ACEPTADA", "Convertida en contrato"
        DESCARTADA = "DESCARTADA", "Descartada"

    cliente = models.ForeignKey(
        Cliente,
        on_delete=models.PROTECT,
        related_name="simulaciones",
    )
    tipo_vestido = models.ForeignKey(
        TipoVestido,
        on_delete=models.PROTECT,
    )
    ruta = models.ForeignKey(
        RutaProduccion,
        on_delete=models.PROTECT,
    )

    cantidad = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(1)],
    )
    fecha_simulacion = models.DateTimeField(default=timezone.now)
    fecha_entrega_solicitada = models.DateField()

    precio_unitario = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )

    estado = models.CharField(
        max_length=12,
        choices=Estado.choices,
        default=Estado.BORRADOR,
    )

    horas_trabajo_estimadas = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    horas_espera_estimadas = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )

    fecha_entrega_estimada = models.DateField(null=True, blank=True)
    resultado_detallado = models.JSONField(default=dict, blank=True)
    observaciones = models.TextField(blank=True)

    creada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="simulaciones_creadas",
    )

    @property
    def importe_total(self):
        return self.precio_unitario * self.cantidad

    def __str__(self):
        return f"Simulación #{self.pk} - {self.cliente}"


class DetalleSimulacion(models.Model):
    """
    Copia los tiempos empleados en una simulación.
    Los cambios futuros en las plantillas no alteran el historial.
    """

    simulacion = models.ForeignKey(
        SimulacionContrato,
        on_delete=models.CASCADE,
        related_name="detalles",
    )
    operacion_nombre = models.CharField(max_length=120)
    orden = models.PositiveIntegerField()
    tipo_tiempo = models.CharField(
        max_length=10,
        choices=PlantillaOperacion.TipoTiempo.choices,
    )
    horas_por_unidad = models.DecimalField(
        max_digits=9,
        decimal_places=2,
    )
    cantidad = models.PositiveIntegerField(default=1)
    horas_totales = models.DecimalField(
        max_digits=12,
        decimal_places=2,
    )
    observaciones = models.TextField(blank=True)

    class Meta:
        ordering = ["orden", "id"]


# ============================================================
# 4. CONTRATOS
# ============================================================

class Contrato(models.Model):
    class Estado(models.TextChoices):
        ACTIVO = "ACTIVO", "Activo"
        EN_PRODUCCION = "EN_PRODUCCION", "En producción"
        ENTREGADO = "ENTREGADO", "Entregado"
        CANCELADO = "CANCELADO", "Cancelado"

    simulacion = models.OneToOneField(
        SimulacionContrato,
        on_delete=models.PROTECT,
        related_name="contrato",
    )
    numero = models.CharField(max_length=40, unique=True)
    fecha_firma = models.DateField(default=timezone.localdate)
    fecha_entrega = models.DateField()
    precio_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    estado = models.CharField(
        max_length=15,
        choices=Estado.choices,
        default=Estado.ACTIVO,
    )
    condiciones_pago = models.TextField(blank=True)
    observaciones = models.TextField(blank=True)

    @property
    def total_pagado(self):
        return self.pagos.filter(confirmado=True).aggregate(
            total=Sum("importe")
        )["total"] or Decimal("0.00")

    @property
    def saldo_pendiente(self):
        return self.precio_total - self.total_pagado

    def __str__(self):
        return self.numero


# ============================================================
# 5. FINANZAS
# ============================================================

class CategoriaFinanciera(models.Model):
    class Tipo(models.TextChoices):
        INGRESO = "INGRESO", "Ingreso"
        EGRESO = "EGRESO", "Egreso"

    nombre = models.CharField(max_length=100, unique=True)
    tipo = models.CharField(max_length=10, choices=Tipo.choices)
    activa = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.nombre} ({self.tipo})"


class Pago(models.Model):
    class Metodo(models.TextChoices):
        EFECTIVO = "EFECTIVO", "Efectivo"
        TRANSFERENCIA = "TRANSFERENCIA", "Transferencia"
        TARJETA = "TARJETA", "Tarjeta"
        OTRO = "OTRO", "Otro"

    contrato = models.ForeignKey(
        Contrato,
        on_delete=models.PROTECT,
        related_name="pagos",
    )
    fecha = models.DateField(default=timezone.localdate)
    importe = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    metodo = models.CharField(max_length=20, choices=Metodo.choices)
    concepto = models.CharField(max_length=150, default="Pago de contrato")
    confirmado = models.BooleanField(default=False)
    referencia = models.CharField(max_length=100, blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    def save(self, *args, **kwargs):
        """
        Al confirmar un pago, crea o actualiza su movimiento financiero.
        Si no está confirmado, no se contabiliza como ingreso.
        """
        with transaction.atomic():
            super().save(*args, **kwargs)

            if self.confirmado:
                categoria, _ = CategoriaFinanciera.objects.get_or_create(
                    nombre="Pagos de contratos",
                    defaults={
                        "tipo": CategoriaFinanciera.Tipo.INGRESO
                    },
                )

                MovimientoFinanciero.objects.update_or_create(
                    pago=self,
                    defaults={
                        "fecha": self.fecha,
                        "tipo": MovimientoFinanciero.Tipo.INGRESO,
                        "categoria": categoria,
                        "importe": self.importe,
                        "descripcion": (
                            f"{self.concepto} - Contrato "
                            f"{self.contrato.numero}"
                        ),
                    },
                )
            else:
                MovimientoFinanciero.objects.filter(
                    pago=self
                ).delete()

    def __str__(self):
        return f"Pago de {self.importe} - {self.contrato.numero}"


class MovimientoFinanciero(models.Model):
    class Tipo(models.TextChoices):
        INGRESO = "INGRESO", "Ingreso"
        EGRESO = "EGRESO", "Egreso"

    fecha = models.DateField(default=timezone.localdate)
    tipo = models.CharField(max_length=10, choices=Tipo.choices)
    categoria = models.ForeignKey(
        CategoriaFinanciera,
        on_delete=models.PROTECT,
        related_name="movimientos",
    )
    importe = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    descripcion = models.CharField(max_length=250)

    # Un pago confirmado genera un único movimiento asociado.
    pago = models.OneToOneField(
        Pago,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="movimiento_financiero",
    )

    contrato = models.ForeignKey(
        Contrato,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="movimientos_financieros",
    )

    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.tipo}: {self.importe} - {self.fecha}"


class CostoOperativo(models.Model):
    """
    Para registrar gastos fijos y variables del taller.
    Ejemplos: planilla, alquiler, servicios y materiales.
    """

    class Frecuencia(models.TextChoices):
        UNICO = "UNICO", "Único"
        SEMANAL = "SEMANAL", "Semanal"
        MENSUAL = "MENSUAL", "Mensual"
        ANUAL = "ANUAL", "Anual"

    nombre = models.CharField(max_length=150)
    categoria = models.ForeignKey(
        CategoriaFinanciera,
        on_delete=models.PROTECT,
    )
    importe = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    frecuencia = models.CharField(
        max_length=10,
        choices=Frecuencia.choices,
        default=Frecuencia.MENSUAL,
    )
    fecha_inicio = models.DateField(default=timezone.localdate)
    fecha_fin = models.DateField(null=True, blank=True)
    activo = models.BooleanField(default=True)
    observaciones = models.TextField(blank=True)

    def __str__(self):
        return self.nombre


# ============================================================
# 6. DATOS INICIALES DEL EXCEL
# ============================================================

# None significa que el proceso no aplica a esa ruta.
# Los tiempos están expresados en horas aproximadas.
# En Taller A, compra materiales = trabajo de personal.
# En Taller C, compra materiales = espera del proveedor.

DATOS_TIEMPOS = {
    "Minimalista": {
        "compra materiales": (168, 1140),
        "patronaje": (10, None),
        "corte de tela": (14, None),
        "confección": (14, None),
        "prueba 1": (2, 2),
        "entalle": (24, 12),
        "prueba 2": (2, 2),
        "acabados": (8, 8),
        "basta": (4, 4),
        "bordado": (8, 0),
        "lavandería": (24, 24),
        "prueba 3": (2, 2),
    },
    "Sirena": {
        "compra materiales": (168, 1140),
        "patronaje": (10, None),
        "corte de tela": (24, None),
        "confección": (14, None),
        "prueba 1": (2, 2),
        "entalle": (16, 16),
        "prueba 2": (2, 2),
        "acabados": (24, 24),
        "basta": (4, 4),
        "bordado": (160, 160),
        "lavandería": (24, 24),
        "prueba 3": (2, 2),
    },
    "Corte A": {
        "compra materiales": (168, 1140),
        "patronaje": (10, None),
        "corte de tela": (24, None),
        "confección": (14, None),
        "prueba 1": (2, 2),
        "entalle": (8, 8),
        "prueba 2": (2, 2),
        "acabados": (16, 16),
        "basta": (6, 6),
        "bordado": (48, 48),
        "lavandería": (24, 24),
        "prueba 3": (2, 2),
    },
    "Princesa": {
        "compra materiales": (168, 1140),
        "patronaje": (10, None),
        "corte de tela": (24, None),
        "confección": (14, None),
        "prueba 1": (2, 2),
        "entalle": (12, 8),
        "prueba 2": (2, 2),
        "acabados": (22, 8),
        "basta": (8, 8),
        "bordado": (120, 85),
        "lavandería": (24, 24),
        "prueba 3": (2, 2),
    },
    "Mini Me": {
        "compra materiales": (168, 1140),
        "patronaje": (8, None),
        "corte de tela": (8, None),
        "confección": (18, None),
        "prueba 1": (2, 2),
        "entalle": (8, 8),
        "prueba 2": (2, 2),
        "acabados": (8, 8),
        "basta": (4, 4),
        "bordado": (24, 12),
        "lavandería": (24, 24),
        "prueba 3": (2, 2),
    },
    "Vainal": {
        "compra materiales": (168, 1140),
        "patronaje": (10, None),
        "corte de tela": (24, None),
        "confección": (14, None),
        "prueba 1": (2, 2),
        "entalle": (8, 8),
        "prueba 2": (2, 2),
        "acabados": (16, 16),
        "basta": (6, 6),
        "bordado": (48, 48),
        "lavandería": (24, 24),
        "prueba 3": (2, 2),
    },
    "Desmontable": {
        "compra materiales": (168, 1140),
        "patronaje": (4, None),
        "corte de tela": (4, None),
        "confección": (8, None),
        "prueba 1": (1, 1),
        "entalle": (4, 4),
        "prueba 2": (1, 1),
        "acabados": (4, 4),
        "basta": (4, 4),
        "bordado": (48, 4),
        "lavandería": (12, 12),
        "prueba 3": (1, 1),
    },
}


def cargar_catalogo_inicial():
    """
    Ejecutar una vez desde Django shell.
    Crea los vestidos, las operaciones, las dos rutas y sus tiempos.

    No sobrescribe las horas que ya hayas modificado posteriormente.
    """
    with transaction.atomic():
        for nombre_vestido, procesos in DATOS_TIEMPOS.items():
            vestido, _ = TipoVestido.objects.get_or_create(
                nombre=nombre_vestido
            )

            for taller in ["A", "C"]:
                ruta, _ = RutaProduccion.objects.get_or_create(
                    tipo_vestido=vestido,
                    taller=taller,
                )

                for orden, (nombre, tiempos) in enumerate(
                    procesos.items(), start=1
                ):
                    horas = tiempos[0] if taller == "A" else tiempos[1]

                    # En el Excel, una celda vacía significa que
                    # la operación no corresponde a esa ruta.
                    if horas is None:
                        continue

                    nombre_normalizado = nombre.strip().lower()

                    area = Trabajadora.Area.OTRO
                    if nombre_normalizado == "compra materiales":
                        area = Trabajadora.Area.COMPRAS
                    elif nombre_normalizado in (
                        "patronaje", "corte de tela", "confección", "entalle"
                    ):
                        area = Trabajadora.Area.CONFECCION
                    elif nombre_normalizado == "bordado":
                        area = Trabajadora.Area.BORDADO
                    elif nombre_normalizado.startswith("prueba"):
                        area = Trabajadora.Area.PRUEBAS
                    elif nombre_normalizado == "lavandería":
                        area = Trabajadora.Area.LAVANDERIA
                    elif nombre_normalizado in ("acabados", "basta"):
                        area = Trabajadora.Area.ACABADOS

                    operacion, _ = Operacion.objects.get_or_create(
                        nombre=nombre,
                        defaults={"area_responsable": area},
                    )

                    tipo_tiempo = (
                        PlantillaOperacion.TipoTiempo.ESPERA
                        if taller == "C"
                        and nombre_normalizado == "compra materiales"
                        else PlantillaOperacion.TipoTiempo.TRABAJO
                    )

                    plantilla, creada = (
                        PlantillaOperacion.objects.get_or_create(
                            ruta=ruta,
                            operacion=operacion,
                            defaults={
                                "orden": orden,
                                "horas_estimadas": Decimal(str(horas)),
                                "tipo_tiempo": tipo_tiempo,
                                "activa": True,
                            },
                        )
                    )

                    # Si la plantilla ya existe, no se reemplaza
                    # su tiempo editable.
                    if creada:
                        plantilla.save()


class ReservaOperacion(models.Model):
    """
    Registra las horas de producción comprometidas por trabajadora,
    operación, fecha y contrato.
    """

    class Estado(models.TextChoices):
        RESERVADA = "RESERVADA", "Reservada"
        EN_PROCESO = "EN_PROCESO", "En proceso"
        COMPLETADA = "COMPLETADA", "Completada"
        CANCELADA = "CANCELADA", "Cancelada"

    contrato = models.ForeignKey(
        "Contrato",
        on_delete=models.PROTECT,
        related_name="reservas_produccion",
    )
    trabajadora = models.ForeignKey(
        "Trabajadora",
        on_delete=models.PROTECT,
        related_name="reservas_produccion",
    )
    plantilla = models.ForeignKey(
        "PlantillaOperacion",
        on_delete=models.PROTECT,
        related_name="reservas_produccion",
    )
    fecha = models.DateField()

    horas_reservadas = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    horas_realizadas = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    estado = models.CharField(
        max_length=12,
        choices=Estado.choices,
        default=Estado.RESERVADA,
    )
    observaciones = models.TextField(blank=True)
    creada_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["fecha", "trabajadora", "plantilla"]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "contrato",
                    "trabajadora",
                    "plantilla",
                    "fecha",
                ],
                name="reserva_unica_por_contrato_persona_operacion_dia",
            )
        ]
        indexes = [
            models.Index(
                fields=["trabajadora", "fecha", "estado"],
                name="res_persona_fecha_estado_idx",
            ),
            models.Index(
                fields=["contrato", "estado"],
                name="reserva_contrato_estado_idx",
            ),
        ]

    @property
    def horas_pendientes(self):
        return max(
            Decimal("0"),
            self.horas_reservadas - self.horas_realizadas,
        )

    def __str__(self):
        return (
            f"{self.contrato.numero} | "
            f"{self.trabajadora.nombre} | "
            f"{self.plantilla.operacion.nombre} | "
            f"{self.fecha} | {self.horas_reservadas} h"
        )



class RegistroAsistencia(models.Model):
    """Entrada y salida diaria de una trabajadora."""

    trabajadora = models.ForeignKey(
        Trabajadora,
        on_delete=models.PROTECT,
        related_name="asistencias",
    )
    fecha = models.DateField(default=timezone.localdate)
    entrada = models.DateTimeField(default=timezone.now)
    salida = models.DateTimeField(null=True, blank=True)

    observaciones_entrada = models.TextField(blank=True)
    observaciones_salida = models.TextField(blank=True)

    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha", "-entrada"]
        constraints = [
            models.UniqueConstraint(
                fields=["trabajadora", "fecha"],
                name="asistencia_unica_persona_fecha",
            ),
        ]

    @property
    def horas_trabajadas(self):
        if self.salida is None:
            return None

        segundos = (self.salida - self.entrada).total_seconds()
        return max(Decimal("0"), Decimal(str(segundos / 3600)))

    def __str__(self):
        return f"{self.trabajadora.nombre} - {self.fecha}"


class SesionTrabajo(models.Model):
    """Tiempo real dedicado a una reserva de producción."""

    reserva = models.ForeignKey(
        ReservaOperacion,
        on_delete=models.PROTECT,
        related_name="sesiones",
    )
    inicio = models.DateTimeField(default=timezone.now)
    fin = models.DateTimeField(null=True, blank=True)

    observaciones_inicio = models.TextField(blank=True)
    observaciones_fin = models.TextField(blank=True)

    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-inicio"]
        indexes = [
            models.Index(
                fields=["reserva", "inicio"],
                name="sesion_reserva_inicio_idx",
            ),
        ]

    @property
    def horas_trabajadas(self):
        final = self.fin or timezone.now()
        segundos = (final - self.inicio).total_seconds()

        return max(
            Decimal("0"),
            Decimal(str(segundos / 3600)),
        )

    def __str__(self):
        return (
            f"{self.reserva.contrato.numero} - "
            f"{self.reserva.plantilla.operacion.nombre}"
        )
