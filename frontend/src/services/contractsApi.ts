/**
 * Conexión del frontend con el módulo de contratos de Django.
 *
 * Endpoints: /api/core/contratos/ (ver CONTRATOS_API.md en el backend).
 *
 * Si ya tienes un cliente HTTP propio (axios o un apiFetch con el
 * token JWT), reemplaza solo la función `request` de este archivo.
 * Todo lo demás puede quedarse igual.
 */

// ============================================================
// CONFIGURACIÓN HTTP
// ============================================================

import { authorizedFetch } from './core';

const CONTRACTS = '/api/core/contratos/';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(extractErrorMessage(data) || `Error ${status}`);
    this.status = status;
    this.data = data;
  }
}

/** Las rutas se escriben como /api/...; VITE_API_URL ya termina en /api. */
function relativePath(path: string): string {
  return path.startsWith('/api/') ? path.slice(4) : path;
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
  } = {}
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const query = params.toString();

  const body =
    options.body === undefined
      ? undefined
      : options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body);

  const response = await authorizedFetch(
    `${relativePath(path)}${query ? `?${query}` : ''}`,
    { method: options.method ?? 'GET', body }
  );

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new ApiError(403, { error: 'No tienes permisos para esta acción.' });
    }
    if (response.status === 404 && typeof data === 'string') {
      throw new ApiError(404, {
        error: 'El servidor no tiene esta ruta. Actualiza el backend y ejecuta las migraciones.',
      });
    }
    throw new ApiError(response.status, data);
  }

  return data as T;
}

/**
 * Convierte los errores de DRF ({campo: [msg]}, listas anidadas de
 * vestidos, {error: msg}, {detail: msg}) en un texto legible.
 */
export function extractErrorMessage(data: unknown, prefix = ''): string {
  if (data == null) return '';
  if (typeof data === 'string') return prefix ? `${prefix}: ${data}` : data;

  if (Array.isArray(data)) {
    return data
      .map((item, index) => {
        if (typeof item === 'string') return extractErrorMessage(item, prefix);
        const label = prefix ? `${prefix} ${index + 1}` : `Ítem ${index + 1}`;
        return extractErrorMessage(item, label);
      })
      .filter(Boolean)
      .join(' · ');
  }

  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([field, value]) => {
        const label = ['error', 'detail', 'non_field_errors', 'mensaje'].includes(field)
          ? prefix
          : [prefix, FIELD_LABELS[field] ?? field].filter(Boolean).join(' › ');
        return extractErrorMessage(value, label);
      })
      .filter(Boolean)
      .join(' · ');
  }

  return String(data);
}

const FIELD_LABELS: Record<string, string> = {
  cliente: 'Clienta',
  datos_cliente: 'Clienta',
  nombre: 'Nombre',
  documento: 'DNI',
  fecha_entrega: 'Fecha de recojo',
  fecha_evento: 'Fecha del evento',
  fecha_devolucion: 'Fecha de devolución',
  fecha_devolucion_fotos: 'Devolución sesión de fotos',
  tipo_evento_detalle: 'Tipo de evento',
  vestidos: 'Vestidos',
  tipo_vestido: 'Tipo de vestido',
  adelantos: 'Adelantos',
  numero: 'N.º de contrato',
};

// ============================================================
// TIPOS (respuestas del backend)
// ============================================================

export type Taller = 'A' | 'C' | 'T';

export const TALLER_LABELS: Record<Taller, string> = {
  A: 'Taller A · Confección desde cero',
  C: 'Taller C · Compra y modificación',
  T: 'Tienda · Modificación de vestido en stock',
};
export type Modalidad = 'ALQUILER' | 'VENTA';
export type TipoEvento = 'NOVIA' | 'QUINCEANERA' | 'OTRO';
export type EstadoContrato = 'ACTIVO' | 'EN_PRODUCCION' | 'ENTREGADO' | 'CANCELADO';
export type EstadoVestido = 'PENDIENTE' | 'EN_PROCESO' | 'FINALIZADO';
export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';

export const ESTADOS_CONTRATO: { value: EstadoContrato; label: string }[] = [
  { value: 'ACTIVO', label: 'Activo' },
  { value: 'EN_PRODUCCION', label: 'En producción' },
  { value: 'ENTREGADO', label: 'Entregado' },
  { value: 'CANCELADO', label: 'Cancelado' },
];

export const TIPOS_EVENTO: { value: TipoEvento; label: string }[] = [
  { value: 'NOVIA', label: 'Novia' },
  { value: 'QUINCEANERA', label: 'Quinceañera' },
  { value: 'OTRO', label: 'Otros' },
];

export const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'OTRO', label: 'Otro' },
];

export interface Cliente {
  id: number;
  nombre: string;
  documento: string;
  telefono: string;
  correo: string;
  direccion: string;
  observaciones?: string;
}

/** Proceso de la ruta de un vestido, con su tiempo base y el aplicado. */
export interface ProcesoVestido {
  plantilla: number;
  operacion: string;
  orden: number;
  tipo_tiempo: 'TRABAJO' | 'ESPERA';
  horas_base: string;
  horas: string;
  incluido: boolean;
  ajustado: boolean;
}

export interface VestidoContrato {
  id: number;
  numero: number;
  codigo: string;
  tipo_vestido: number | null;
  tipo_vestido_nombre: string | null;
  ruta: number | null;
  taller: Taller | null;
  taller_display: string;
  descripcion: string;
  modalidad: Modalidad;
  modalidad_display: string;
  precio: string;
  precio_alquiler: string;
  precio_venta: string;
  precio_otros: string;
  precio_total: string;
  estado: EstadoVestido;
  estado_display: string;
  fecha_fin_estimada: string | null;
  horas_sin_asignar: string;
  procesos: ProcesoVestido[];
  observaciones: string;
}

export interface Adelanto {
  id: number;
  orden_adelanto: number;
  concepto: string;
  importe: string;
  fecha: string;
  metodo: MetodoPago;
  referencia: string;
  observaciones?: string;
  confirmado: boolean;
}

export interface Contrato {
  id: number | null; // null en la vista previa
  numero: string;
  origen: 'MANUAL' | 'SIMULADOR';
  simulacion: number | null;
  estado: EstadoContrato;
  estado_display: string;
  cliente: Cliente | null;
  servicio_alquiler: boolean;
  servicio_venta: boolean;
  servicio_confeccion: boolean;
  fecha_evento: string | null;
  tipo_evento: TipoEvento;
  tipo_evento_display: string;
  tipo_evento_detalle: string;
  fecha_entrega: string;
  fecha_devolucion: string | null;
  fecha_recojo_fotos: string | null;
  fecha_devolucion_fotos: string | null;
  servicio_lavanderia: string;
  precio_total: string; // incluye los cobros extra del taller
  total_cargos: string;
  cargos_adicionales: {
    id: number;
    vestido: number;
    vestido_codigo: string;
    concepto: string;
    descripcion: string;
    monto: string;
    fecha: string;
  }[];
  adelantos: Adelanto[];
  /** Todos los pagos confirmados (adelantos y pagos recibidos en taller). */
  pagos: (Adelanto & { vestido: number | null; vestido_codigo: string | null })[];
  total_pagado: string;
  saldo_pendiente: string;
  garantia: string;
  garantia_detalle: string;
  vestidos: VestidoContrato[];
  total_vestidos: number;
  fecha_fin_produccion_estimada: string | null;
  fecha_firma: string;
  asesora: number | null;
  asesora_nombre: string | null;
  condiciones_pago: string;
  observaciones: string;
  creado_en: string;
  actualizado_en: string;
}

export interface ContratoResumen {
  id: number;
  numero: string;
  origen: 'MANUAL' | 'SIMULADOR';
  estado: EstadoContrato;
  estado_display: string;
  cliente_nombre: string | null;
  cliente_documento: string | null;
  tipo_evento: TipoEvento;
  tipo_evento_display: string;
  fecha_evento: string | null;
  fecha_firma: string;
  fecha_entrega: string;
  precio_total: string;
  total_vestidos: number;
  resumen_vestidos: {
    codigo: string;
    tipo_vestido: string;
    taller: Taller | null;
    estado: EstadoVestido;
  }[];
}

export interface AsignacionPlan {
  trabajadora_id: number;
  trabajadora: string;
  fecha: string;
  horas: string;
}

export interface OperacionPlan {
  plantilla_id: number;
  operacion: string;
  tipo_tiempo: 'TRABAJO' | 'ESPERA';
  horas: string;
  inicio: string;
  fin: string;
  asignaciones: AsignacionPlan[];
  horas_sin_asignar?: string;
  omitido?: boolean; // proceso quitado para este vestido
  ajustado?: boolean; // horas cambiadas para este vestido
}

export interface PlanVestido {
  vestido_id: number;
  codigo: string;
  tipo_vestido?: string | null;
  taller?: Taller | null;
  planificado: boolean;
  fecha_inicio_estimada?: string | null;
  fecha_fin_estimada?: string | null;
  fecha_limite?: string;
  a_tiempo?: boolean | null;
  horas_trabajo?: string;
  horas_espera?: string;
  horas_sin_asignar?: string;
  operaciones?: OperacionPlan[];
  advertencias: string[];
}

export interface ContratoGuardado {
  mensaje: string;
  cliente_creado?: boolean;
  cliente_nuevo?: boolean; // vista previa
  contrato: Contrato;
  planificacion: PlanVestido[];
}

export interface ReservaPlan {
  id: number;
  fecha: string;
  operacion: string;
  orden: number;
  trabajadora_id: number;
  trabajadora: string;
  horas_reservadas: string;
  horas_realizadas: string;
  estado: string;
}

export interface PlanificacionContrato {
  contrato_id: number;
  numero: string;
  fecha_entrega: string;
  vestidos: {
    vestido_id: number;
    codigo: string;
    tipo_vestido: string | null;
    taller: Taller | null;
    estado: EstadoVestido;
    fecha_fin_estimada: string | null;
    a_tiempo: boolean | null;
    horas_sin_asignar: string;
    horas_reservadas: string | number;
    reservas: ReservaPlan[];
  }[];
}

/** Catálogo existente: GET /api/core/catalogo/ */
export interface CatalogoVestido {
  id: number;
  nombre: string;
  descripcion: string;
  /** false = ya no se ofrece para vestidos nuevos (se mantiene en los antiguos). */
  activo?: boolean;
  rutas: {
    id: number;
    taller: Taller;
    descripcion: string;
    operaciones: CatalogoOperacion[];
  }[];
}

export interface CatalogoOperacion {
  id: number; // id de PlantillaOperacion (se envía como "plantilla")
  operacion_id: number;
  nombre: string;
  area: string;
  orden: number;
  tipo_tiempo: 'TRABAJO' | 'ESPERA';
  horas_estimadas: string;
  obligatoria: boolean;
}

/** Nombre del tipo de vestido de stock (ruta T). */
export const VESTIDO_EN_TIENDA = 'Vestido en tienda';

// ============================================================
// TIPOS (lo que se envía)
// ============================================================

export interface DatosClienteInput {
  nombre: string;
  documento?: string;
  telefono?: string;
  correo?: string;
  direccion?: string;
}

export interface ItemContratoInput {
  id?: number; // solo al editar un ítem existente
  tipo_vestido: number | null;
  taller: Taller | '' | null; // vacío = no pasa por el taller
  descripcion?: string;
  modalidad: Modalidad;
  precio: string;
  precio_otros?: string;
  observaciones?: string;
  /**
   * Tiempos por proceso para este vestido. Si no se envía, se usan los
   * de la plantilla (o los ajustes ya guardados al editar).
   */
  procesos?: { plantilla: number; horas: string; incluido: boolean }[];
}

export interface AdelantoInput {
  importe: string; // "0" elimina el adelanto al editar
  fecha?: string | null;
  metodo?: MetodoPago;
  referencia?: string;
  /** Nombre del pago (por defecto "Primer pago", "Segundo pago"…). */
  concepto?: string;
  observaciones?: string;
}

export interface ContratoInput {
  numero?: string;
  cliente?: number | null;
  datos_cliente?: DatosClienteInput | null;
  fecha_firma?: string;
  fecha_entrega: string; // fecha de recojo del vestido
  servicio_alquiler?: boolean;
  servicio_venta?: boolean;
  servicio_confeccion?: boolean;
  fecha_evento?: string | null;
  tipo_evento?: TipoEvento;
  tipo_evento_detalle?: string;
  fecha_devolucion?: string | null;
  fecha_recojo_fotos?: string | null;
  fecha_devolucion_fotos?: string | null;
  servicio_lavanderia?: string;
  garantia?: string;
  garantia_detalle?: string;
  condiciones_pago?: string;
  observaciones?: string;
  asesora?: number | null;
  vestidos: ItemContratoInput[];
  adelantos?: AdelantoInput[];
}

export type ContratoUpdate = Partial<ContratoInput> & {
  estado?: EstadoContrato;
  replanificar?: boolean;
};

export interface FiltrosContratos {
  q?: string;
  estado?: EstadoContrato | '';
  origen?: 'MANUAL' | 'SIMULADOR' | '';
  desde?: string;
  hasta?: string;
}

// ============================================================
// ENDPOINTS
// ============================================================

export const contractsApi = {
  list: (filtros: FiltrosContratos = {}) =>
    request<{ total: number; contratos: ContratoResumen[] }>(CONTRACTS, {
      query: { ...filtros },
    }),

  get: (id: number) => request<Contrato>(`${CONTRACTS}${id}/`),

  create: (data: ContratoInput) =>
    request<ContratoGuardado>(CONTRACTS, { method: 'POST', body: data }),

  /** Calcula la planificación del taller sin guardar nada. */
  preview: (data: ContratoInput) =>
    request<ContratoGuardado>(`${CONTRACTS}previsualizar/`, {
      method: 'POST',
      body: data,
    }),

  update: (id: number, data: ContratoUpdate) =>
    request<ContratoGuardado>(`${CONTRACTS}${id}/`, {
      method: 'PATCH',
      body: data,
    }),

  cancel: (id: number) =>
    request<ContratoGuardado>(`${CONTRACTS}${id}/`, {
      method: 'PATCH',
      body: { estado: 'CANCELADO' },
    }),

  planning: (id: number) =>
    request<PlanificacionContrato>(`${CONTRACTS}${id}/planificacion/`),

  replan: (id: number) =>
    request<ContratoGuardado>(`${CONTRACTS}${id}/planificacion/`, {
      method: 'POST',
    }),

  searchClients: (q: string) =>
    request<Cliente[]>(`${CONTRACTS}clientes/`, { query: { q } }),

  catalog: async (): Promise<CatalogoVestido[]> => {
    const data = await request<{ vestidos: CatalogoVestido[] }>('/api/core/catalogo/', { query: { incluir_inactivos: '1' } });
    return data.vestidos;
  },
};

// ============================================================
// DEL SIMULADOR AL CONTRATO
// ============================================================

/**
 * El simulador calcula en el navegador y no guarda simulaciones en
 * Django. Para "Aceptar contrato" desde el simulador se pasan sus
 * vestidos al formulario de contratos (prellenado) y se guarda con el
 * mismo POST que la creación manual.
 */
export const CONTRACT_PREFILL_KEY = 'fiancee:contract-prefill';

export interface SimulatorItemLike {
  client: string;
  corteId: string | number;
  workshop: string; // p. ej. "A", "Taller A", "Taller C - Compra…", "Tienda"
  eventDate: string;
  deliveryDate: string;
  price: number;
  backendDressId?: string | number | null;
}

export interface ContractPrefill {
  cliente_nombre: string;
  fecha_evento: string;
  fecha_entrega: string;
  vestidos: { corte: string; backendDressId?: string | number | null; taller: Taller | ''; precio: number }[];
}

export function tallerFromWorkshop(workshop: string): Taller | '' {
  const text = String(workshop).toUpperCase();
  if (text.includes('TIENDA')) return 'T';
  const match = text.match(/(?:TALLER\s*)?\b([ACT])\b/);
  return (match?.[1] as Taller | undefined) ?? '';
}

/** Guárdalo antes de navegar a la pantalla de contratos. */
export function saveSimulatorPrefill(items: SimulatorItemLike[]): void {
  if (items.length === 0) return;
  const prefill: ContractPrefill = {
    cliente_nombre: items[0].client,
    fecha_evento: items[0].eventDate,
    // la fecha de recojo más temprana de la lista
    fecha_entrega: items.map((i) => i.deliveryDate).sort()[0],
    vestidos: items.map((item) => ({
      corte: String(item.corteId),
      backendDressId: item.backendDressId ?? null,
      taller: tallerFromWorkshop(item.workshop),
      precio: item.price,
    })),
  };
  sessionStorage.setItem(CONTRACT_PREFILL_KEY, JSON.stringify(prefill));
}

export function takeSimulatorPrefill(): ContractPrefill | null {
  const raw = sessionStorage.getItem(CONTRACT_PREFILL_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(CONTRACT_PREFILL_KEY);
  try {
    return JSON.parse(raw) as ContractPrefill;
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Encuentra el tipo de vestido del catálogo por id del backend o por nombre. */
export function matchCatalogDress(
  catalog: CatalogoVestido[],
  corte: string,
  backendDressId?: string | number | null
): CatalogoVestido | undefined {
  const byId = catalog.find(
    (v) => String(v.id) === String(backendDressId ?? '') || String(v.id) === corte
  );
  if (byId) return byId;
  const target = normalize(corte);
  return catalog.find((v) => normalize(v.nombre) === target || target.includes(normalize(v.nombre)));
}

/** Cliente HTTP compartido (JWT + errores legibles). */
export { request as apiRequest };
