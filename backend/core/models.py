from decimal import Decimal

from django.conf import settings
from datetime import timedelta

from django.core.validators import MaxValueValidator, MinValueValidator
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
        TIENDA = "T", "Tienda - Modificación de vestido en stock"

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
    direccion = models.CharField(max_length=250, blank=True)
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
    """
    Contrato de locación de servicios.

    Puede nacer de una simulación aceptada o crearse manualmente.
    Agrupa uno o varios vestidos/ítems (VestidoContrato); cada uno
    tiene su propio tipo de vestido, taller y precio.
    """

    class Estado(models.TextChoices):
        ACTIVO = "ACTIVO", "Activo"
        EN_PRODUCCION = "EN_PRODUCCION", "En producción"
        ENTREGADO = "ENTREGADO", "Entregado"
        CANCELADO = "CANCELADO", "Cancelado"

    class TipoEvento(models.TextChoices):
        NOVIA = "NOVIA", "Novia"
        QUINCEANERA = "QUINCEANERA", "Quinceañera"
        OTRO = "OTRO", "Otros"

    # Nulo cuando el contrato se crea manualmente.
    simulacion = models.OneToOneField(
        SimulacionContrato,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="contrato",
    )
    cliente = models.ForeignKey(
        Cliente,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="contratos",
    )
    numero = models.CharField(max_length=40, unique=True)

    # Fecha del contrato.
    fecha_firma = models.DateField(default=timezone.localdate)

    # Fecha de recojo del vestido por la clienta. Es la fecha límite
    # de producción del taller.
    fecha_entrega = models.DateField()

    # I. Objeto del contrato: servicios contratados.
    servicio_alquiler = models.BooleanField(default=False)
    servicio_venta = models.BooleanField(default=False)
    servicio_confeccion = models.BooleanField(
        default=False,
        help_text="Confección personalizada para venta o alquiler.",
    )

    # Evento
    fecha_evento = models.DateField(null=True, blank=True)
    tipo_evento = models.CharField(
        max_length=12,
        choices=TipoEvento.choices,
        default=TipoEvento.NOVIA,
    )
    tipo_evento_detalle = models.CharField(
        max_length=120,
        blank=True,
        help_text="Descripción cuando el tipo de evento es 'Otros'.",
    )

    # Alquiler: devolución del vestido y accesorios.
    fecha_devolucion = models.DateField(null=True, blank=True)

    # Sesión de fotos
    fecha_recojo_fotos = models.DateField(null=True, blank=True)
    fecha_devolucion_fotos = models.DateField(null=True, blank=True)

    # Servicio de lavandería (si aplica)
    servicio_lavanderia = models.CharField(max_length=250, blank=True)

    # Monto total = suma de los ítems del contrato.
    precio_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )

    # Garantía: se entrega en el recojo del vestido, junto con el DNI
    # original y un recibo de agua o luz.
    garantia = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    garantia_detalle = models.CharField(max_length=250, blank=True)

    estado = models.CharField(
        max_length=15,
        choices=Estado.choices,
        default=Estado.ACTIVO,
    )
    condiciones_pago = models.TextField(blank=True)
    observaciones = models.TextField(blank=True)

    asesora = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contratos_asesorados",
    )
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contratos_creados",
    )
    creado_en = models.DateTimeField(default=timezone.now)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_firma", "-id"]

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
# 4.1 VESTIDOS INDIVIDUALES DE CADA CONTRATO
# ============================================================

class VestidoContrato(models.Model):
    """
    Ítem del contrato (fila de la tabla ITEM / DESCRIPCIÓN / PRECIO).

    Si tiene ruta (taller A o C), pasa al taller: se planifican sus
    operaciones y se reservan horas de las trabajadoras.
    Si no tiene ruta (p. ej. alquiler de un vestido de stock o un
    accesorio), solo figura en el contrato y no ocupa capacidad.
    """

    class Estado(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        EN_PROCESO = "EN_PROCESO", "En proceso"
        FINALIZADO = "FINALIZADO", "Finalizado"

    class Modalidad(models.TextChoices):
        ALQUILER = "ALQUILER", "Alquiler"
        VENTA = "VENTA", "Venta"

    contrato = models.ForeignKey(
        Contrato,
        on_delete=models.PROTECT,
        related_name="vestidos",
    )

    numero = models.PositiveIntegerField()

    codigo = models.CharField(
        max_length=60,
        unique=True,
    )

    tipo_vestido = models.ForeignKey(
        TipoVestido,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vestidos_contratados",
    )
    ruta = models.ForeignKey(
        RutaProduccion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vestidos_contratados",
    )

    descripcion = models.CharField(max_length=250, blank=True)
    modalidad = models.CharField(
        max_length=10,
        choices=Modalidad.choices,
        default=Modalidad.VENTA,
    )
    # Precio en la columna PRECIO ALQUILER o PRECIO VENTA,
    # según la modalidad.
    precio = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    # Columna OTROS.
    precio_otros = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    # Seguimiento de producción (vista de la jefa de taller).
    class Prioridad(models.TextChoices):
        ALTA = "ALTA", "Alta"
        MEDIA = "MEDIA", "Media"
        BAJA = "BAJA", "Baja"

    prioridad = models.CharField(
        max_length=5,
        choices=Prioridad.choices,
        default=Prioridad.MEDIA,
    )
    # Índice (0..n) del paso actual en vestido.pasos ordenados.
    paso_actual = models.PositiveIntegerField(default=0)
    # Fecha límite propia del vestido; si es nula se usa la fecha de
    # recojo del contrato.
    fecha_limite = models.DateField(null=True, blank=True)

    # Resultado de la planificación automática del taller.
    fecha_fin_estimada = models.DateField(null=True, blank=True)
    horas_sin_asignar = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    observaciones = models.TextField(blank=True)

    estado = models.CharField(
        max_length=15,
        choices=Estado.choices,
        default=Estado.PENDIENTE,
    )

    creado_en = models.DateTimeField(auto_now_add=True)

    @property
    def precio_total(self):
        return (self.precio or Decimal("0")) + (
            self.precio_otros or Decimal("0")
        )

    @property
    def taller(self):
        return self.ruta.taller if self.ruta_id else None

    @property
    def fecha_limite_efectiva(self):
        return self.fecha_limite or self.contrato.fecha_entrega

    class Meta:
        ordering = ["contrato", "numero"]
        constraints = [
            models.UniqueConstraint(
                fields=["contrato", "numero"],
                name="vestido_unico_por_contrato",
            )
        ]

    def __str__(self):
        return f"{self.codigo} - {self.contrato.numero}"

class ProcesoVestidoContrato(models.Model):
    """
    Ajuste de tiempos de un proceso para un vestido concreto.

    Por defecto cada vestido usa las horas de la plantilla de su ruta.
    Si existe un ajuste, la planificación usa estas horas o, si
    incluido=False, se salta el proceso para ese vestido.
    """

    vestido = models.ForeignKey(
        VestidoContrato,
        on_delete=models.CASCADE,
        related_name="procesos",
    )
    plantilla = models.ForeignKey(
        PlantillaOperacion,
        on_delete=models.PROTECT,
        related_name="ajustes_vestido",
    )
    horas = models.DecimalField(
        max_digits=9,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    incluido = models.BooleanField(default=True)

    class Meta:
        ordering = ["plantilla__orden", "plantilla_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["vestido", "plantilla"],
                name="ajuste_unico_por_vestido_proceso",
            )
        ]

    def __str__(self):
        return f"{self.vestido.codigo} - {self.plantilla.operacion}: {self.horas} h"


class PasoVestido(models.Model):
    """
    Paso de la línea de producción de un vestido.

    Se generan a partir de la ruta (con los tiempos ajustados del
    vestido) más un paso final de entrega.
    """

    class Estado(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        EN_CURSO = "EN_CURSO", "En curso"
        COMPLETADO = "COMPLETADO", "Completado"

    vestido = models.ForeignKey(
        VestidoContrato,
        on_delete=models.CASCADE,
        related_name="pasos",
    )
    orden = models.PositiveIntegerField()
    # Nulo solo en el paso final de entrega.
    plantilla = models.ForeignKey(
        PlantillaOperacion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="pasos_vestido",
    )
    # Operación del catálogo (para pasos agregados por la jefa).
    operacion = models.ForeignKey(
        Operacion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="pasos_vestido",
    )
    nombre = models.CharField(max_length=120)
    es_entrega = models.BooleanField(default=False)
    # Paso agregado por la jefa (prueba extra, ajuste, etc.).
    es_adicional = models.BooleanField(default=False)
    tipo_tiempo = models.CharField(
        max_length=10,
        choices=PlantillaOperacion.TipoTiempo.choices,
        default=PlantillaOperacion.TipoTiempo.TRABAJO,
    )
    area = models.CharField(max_length=15, blank=True)
    horas_estimadas = models.DecimalField(
        max_digits=9,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    estado = models.CharField(
        max_length=12,
        choices=Estado.choices,
        default=Estado.PENDIENTE,
    )
    trabajadoras = models.ManyToManyField(
        "Trabajadora",
        blank=True,
        related_name="pasos_asignados",
    )
    # La jefa de taller inicia el proceso: desde aquí corre el tiempo.
    iniciado_en = models.DateTimeField(null=True, blank=True)
    iniciado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    completado_en = models.DateTimeField(null=True, blank=True)
    completado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["vestido", "orden"]
        constraints = [
            models.UniqueConstraint(
                fields=["vestido", "orden"],
                name="paso_unico_por_vestido_orden",
            )
        ]

    def __str__(self):
        return f"{self.vestido.codigo} - {self.orden}. {self.nombre}"


class NotaVestido(models.Model):
    """Observaciones e incidencias registradas sobre un vestido."""

    class Tipo(models.TextChoices):
        OBSERVACION = "OBSERVACION", "Observación"
        INCIDENCIA = "INCIDENCIA", "Incidencia"

    vestido = models.ForeignKey(
        VestidoContrato,
        on_delete=models.CASCADE,
        related_name="notas",
    )
    tipo = models.CharField(
        max_length=12,
        choices=Tipo.choices,
        default=Tipo.OBSERVACION,
    )
    texto = models.TextField()
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    autor_nombre = models.CharField(max_length=150, blank=True)
    creado_en = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-creado_en", "-id"]

    def __str__(self):
        return f"{self.vestido.codigo} - {self.get_tipo_display()}"


class ImagenNotaVestido(models.Model):
    """Fotos de los cambios o del estado del vestido."""

    nota = models.ForeignKey(
        NotaVestido,
        on_delete=models.CASCADE,
        related_name="imagenes",
    )
    archivo = models.ImageField(upload_to="vestidos/%Y/%m/")
    creado_en = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.archivo.name


class CargoAdicional(models.Model):
    """
    Cobro extra por modificaciones pedidas sobre un vestido.
    Se suma al costo del vestido y al monto total del contrato.
    """

    contrato = models.ForeignKey(
        Contrato,
        on_delete=models.PROTECT,
        related_name="cargos_adicionales",
    )
    vestido = models.ForeignKey(
        VestidoContrato,
        on_delete=models.PROTECT,
        related_name="cargos_adicionales",
    )
    nota = models.ForeignKey(
        NotaVestido,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cargos",
    )
    concepto = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True)
    monto = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    fecha = models.DateField(default=timezone.localdate)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    creado_en = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.vestido.codigo} - {self.concepto}: {self.monto}"


class Notificacion(models.Model):
    """Aviso para un usuario (asignaciones, pagos, recordatorios…)."""

    class Tipo(models.TextChoices):
        ASIGNACION = "ASIGNACION", "Asignación"
        PROCESO = "PROCESO", "Proceso"
        CONTRATO = "CONTRATO", "Contrato"
        PAGO = "PAGO", "Pago"
        COBRO = "COBRO", "Cobro adicional"
        RECORDATORIO = "RECORDATORIO", "Recordatorio"
        ATRASO = "ATRASO", "Atraso"
        JORNADA = "JORNADA", "Jornada"

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notificaciones",
    )
    tipo = models.CharField(max_length=15, choices=Tipo.choices)
    titulo = models.CharField(max_length=150)
    mensaje = models.TextField(blank=True)
    vestido = models.ForeignKey(
        VestidoContrato,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notificaciones",
    )
    contrato = models.ForeignKey(
        Contrato,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notificaciones",
    )
    # Evita repetir el mismo aviso automático (recordatorios, atrasos).
    clave = models.CharField(max_length=120, blank=True)
    leida = models.BooleanField(default=False)
    creada_en = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-creada_en", "-id"]
        indexes = [models.Index(fields=["usuario", "leida"])]
        constraints = [
            models.UniqueConstraint(
                fields=["usuario", "clave"],
                condition=~models.Q(clave=""),
                name="notificacion_unica_por_clave",
            )
        ]

    def __str__(self):
        return f"{self.usuario} - {self.titulo}"


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

    # Vestido sobre el que se registró el pago (desde el taller).
    vestido = models.ForeignKey(
        "VestidoContrato",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pagos",
    )

    observaciones = models.TextField(blank=True)

    # Número del pago del contrato (1 = primer pago, 2 = segundo pago…).
    # Es el mismo número en el contrato y en el taller. Nulo = otro pago.
    orden_adelanto = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["contrato", "orden_adelanto"],
                condition=models.Q(orden_adelanto__isnull=False),
                name="adelanto_unico_por_contrato",
            )
        ]

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

    # Un gasto pagado genera un único movimiento de egreso.
    gasto = models.OneToOneField(
        "Gasto",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="movimiento_financiero",
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

    # Día del mes en que se suele pagar (para avisar "vence el 30").
    dia_pago = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )

    def __str__(self):
        return self.nombre

    def monto_mensual(self):
        if self.frecuencia == self.Frecuencia.SEMANAL:
            return (self.importe * Decimal("52") / Decimal("12")).quantize(Decimal("0.01"))
        if self.frecuencia == self.Frecuencia.ANUAL:
            return (self.importe / Decimal("12")).quantize(Decimal("0.01"))
        return self.importe

    def aplica_en(self, mes):
        """¿Este gasto fijo corresponde al mes (primer día del mes)?"""
        if not self.activo:
            return False
        fin_mes = (mes.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        if self.fecha_inicio > fin_mes:
            return False
        if self.fecha_fin and self.fecha_fin < mes:
            return False
        if self.frecuencia == self.Frecuencia.UNICO:
            return mes <= self.fecha_inicio <= fin_mes
        return True


class Gasto(models.Model):
    """Gasto real del negocio (pagado o por pagar)."""

    class Estado(models.TextChoices):
        PAGADO = "PAGADO", "Pagado"
        PENDIENTE = "PENDIENTE", "Por pagar"

    fecha = models.DateField(default=timezone.localdate)
    concepto = models.CharField(max_length=200)
    categoria = models.ForeignKey(CategoriaFinanciera, on_delete=models.PROTECT, related_name="gastos")
    importe = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    metodo = models.CharField(max_length=20, choices=Pago.Metodo.choices, default=Pago.Metodo.EFECTIVO)
    proveedor = models.CharField(max_length=150, blank=True)
    comprobante = models.CharField(max_length=60, blank=True)
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.PAGADO)
    vence = models.DateField(null=True, blank=True)
    # Si es el pago de un gasto fijo, de qué fijo y de qué mes.
    costo_fijo = models.ForeignKey(
        CostoOperativo, on_delete=models.SET_NULL, null=True, blank=True, related_name="gastos"
    )
    mes_fijo = models.DateField(null=True, blank=True)
    observaciones = models.TextField(blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="gastos_registrados"
    )
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["costo_fijo", "mes_fijo"],
                condition=models.Q(costo_fijo__isnull=False),
                name="un_pago_por_fijo_y_mes",
            ),
        ]

    def save(self, *args, **kwargs):
        """Un gasto pagado se registra como egreso en los movimientos."""
        with transaction.atomic():
            super().save(*args, **kwargs)
            if self.estado == self.Estado.PAGADO:
                MovimientoFinanciero.objects.update_or_create(
                    gasto=self,
                    defaults={
                        "fecha": self.fecha,
                        "tipo": MovimientoFinanciero.Tipo.EGRESO,
                        "categoria": self.categoria,
                        "importe": self.importe,
                        "descripcion": self.concepto[:250],
                    },
                )
            else:
                MovimientoFinanciero.objects.filter(gasto=self).delete()

    def __str__(self):
        return f"{self.concepto} - {self.importe}"


class MetaMensual(models.Model):
    """Meta de ingresos de un mes (si no hay, se usa la meta general)."""

    mes = models.DateField(unique=True)
    meta = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    nota = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-mes"]


class ConfiguracionNegocio(models.Model):
    """Ajustes generales que configura gerencia (una sola fila)."""

    meta_mensual = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    margen_objetivo = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("30"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    nombre_negocio = models.CharField(max_length=120, default="Fiancée")
    actualizado_en = models.DateTimeField(auto_now=True)

    @classmethod
    def obtener(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def meta_de(self, mes):
        m = MetaMensual.objects.filter(mes=mes).first()
        return (m.meta, True) if m else (self.meta_mensual, False)


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


# Vestido que ya está hecho en tienda: solo pasa por modificaciones.
# Mismos procesos que el Taller C, sin compra de materiales.
# Las horas son referenciales y se ajustan por vestido en el contrato.
VESTIDO_EN_TIENDA = "Vestido en tienda"

TIEMPOS_VESTIDO_EN_TIENDA = {
    "prueba 1": 2,
    "entalle": 8,
    "prueba 2": 2,
    "acabados": 8,
    "basta": 4,
    "bordado": 0,
    "lavandería": 24,
    "prueba 3": 2,
}


def cargar_vestido_en_tienda():
    """Crea el tipo 'Vestido en tienda' con su ruta T. No pisa ediciones."""
    with transaction.atomic():
        vestido, _ = TipoVestido.objects.get_or_create(
            nombre=VESTIDO_EN_TIENDA,
            defaults={
                "descripcion": (
                    "Vestido de stock de la tienda que solo pasa por "
                    "modificaciones (sin compra de materiales)."
                )
            },
        )
        ruta, _ = RutaProduccion.objects.get_or_create(
            tipo_vestido=vestido,
            taller=RutaProduccion.Tipo.TIENDA,
            defaults={"descripcion": "Modificación de vestido en stock"},
        )
        for orden, (nombre, horas) in enumerate(
            TIEMPOS_VESTIDO_EN_TIENDA.items(), start=1
        ):
            operacion = Operacion.objects.filter(nombre__iexact=nombre).first()
            if operacion is None:
                continue
            PlantillaOperacion.objects.get_or_create(
                ruta=ruta,
                operacion=operacion,
                defaults={
                    "orden": orden,
                    "horas_estimadas": Decimal(str(horas)),
                    # Mismo tipo de tiempo que el proceso en las demás rutas.
                    "tipo_tiempo": (
                        PlantillaOperacion.objects.filter(operacion=operacion)
                        .exclude(ruta__taller=RutaProduccion.Tipo.TIENDA)
                        .values_list("tipo_tiempo", flat=True)
                        .first()
                        or PlantillaOperacion.TipoTiempo.TRABAJO
                    ),
                    "obligatoria": nombre != "bordado",
                    "activa": True,
                },
            )


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

    cargar_vestido_en_tienda()


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
    # Vestido del contrato al que corresponde la reserva.
    vestido = models.ForeignKey(
        "VestidoContrato",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reservas_produccion",
    )
    # Paso de la línea de producción que cubre la reserva.
    paso = models.ForeignKey(
        "PasoVestido",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="reservas",
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
                    "vestido",
                    "paso",
                    "trabajadora",
                    "plantilla",
                    "fecha",
                ],
                name="reserva_unica_paso_persona_operacion_dia",
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

    # Si la trabajadora no marcó su salida, se cierra sola con su horario.
    cierre_automatico = models.BooleanField(default=False)
    # Horas extra declaradas (fuera del horario), con su motivo.
    horas_extra = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    motivo_horas_extra = models.CharField(max_length=250, blank=True)

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



# ============================================================
# SESIONES DE TRABAJO POR VESTIDO
# ============================================================

class SesionVestido(models.Model):

    class Estado(models.TextChoices):
        EN_CURSO = "EN_CURSO", "En curso"
        PAUSADA = "PAUSADA", "Pausada"
        FINALIZADA = "FINALIZADA", "Finalizada"

    trabajadora = models.ForeignKey(
        "Trabajadora",
        on_delete=models.PROTECT,
        related_name="sesiones_vestidos",
    )

    jornada = models.ForeignKey(
        "RegistroAsistencia",
        on_delete=models.PROTECT,
        related_name="sesiones_vestidos",
    )

    vestido = models.ForeignKey(
        "VestidoContrato",
        on_delete=models.PROTECT,
        related_name="sesiones_trabajo",
    )

    # Paso de la línea de producción en el que se trabajó.
    paso = models.ForeignKey(
        PasoVestido,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sesiones",
    )

    inicio = models.DateTimeField(default=timezone.now)
    fin = models.DateTimeField(null=True, blank=True)

    estado = models.CharField(
        max_length=12,
        choices=Estado.choices,
        default=Estado.EN_CURSO,
    )

    observaciones = models.TextField(blank=True)

    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-inicio"]
        constraints = [
            models.UniqueConstraint(
                fields=["trabajadora"],
                condition=models.Q(
                    estado__in=["EN_CURSO", "PAUSADA"]
                ),
                name="una_sesion_abierta_por_trabajadora",
            ),
            models.UniqueConstraint(
                fields=["vestido"],
                condition=models.Q(
                    estado__in=["EN_CURSO", "PAUSADA"]
                ),
                name="una_sesion_abierta_por_vestido",
            ),
        ]

    @property
    def horas_efectivas(self):
        final = self.fin or timezone.now()

        segundos_totales = (final - self.inicio).total_seconds()

        segundos_pausa = 0

        for pausa in self.pausas.all():
            fin_pausa = pausa.fin or timezone.now()

            segundos_pausa += max(
                0,
                (fin_pausa - pausa.inicio).total_seconds(),
            )

        segundos_efectivos = max(
            0,
            segundos_totales - segundos_pausa,
        )

        return Decimal(str(segundos_efectivos / 3600))

    def __str__(self):
        return f"{self.vestido.codigo} - {self.trabajadora.nombre}"


class PausaSesionVestido(models.Model):

    sesion = models.ForeignKey(
        SesionVestido,
        on_delete=models.CASCADE,
        related_name="pausas",
    )

    inicio = models.DateTimeField(default=timezone.now)
    fin = models.DateTimeField(null=True, blank=True)

    motivo = models.CharField(
        max_length=200,
        blank=True,
    )

    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["inicio"]
        constraints = [
            models.UniqueConstraint(
                fields=["sesion"],
                condition=models.Q(fin__isnull=True),
                name="una_pausa_abierta_por_sesion",
            ),
        ]

    def __str__(self):
        return f"{self.vestido.codigo} - {self.trabajadora.nombre}"


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
