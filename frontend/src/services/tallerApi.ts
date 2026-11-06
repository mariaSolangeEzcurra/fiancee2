
const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

const TALLER_URL = `${API_URL}/api/taller`;

type MetodoHTTP = 'GET' | 'POST';

async function requestTaller<T>(
  endpoint: string,
  method: MetodoHTTP = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const token = localStorage.getItem('fio_access');

  if (!token) {
    throw new Error('Tu sesión ha vencido. Inicia sesión nuevamente.');
  }

  let response: Response;

  try {
    response = await fetch(`${TALLER_URL}${endpoint}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(method === 'POST'
        ? { body: JSON.stringify(body ?? {}) }
        : {}),
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.detail ||
        data?.error ||
        data?.message ||
        `Error ${response.status} al consultar el módulo Taller.`
    );
  }

  return data as T;
}

// ─── Tipos: asistencia ─────────────────────────────────

export interface AsistenciaTrabajadora {
  id: number;
  fecha: string;
  entrada: string;
  salida: string | null;
  jornada_activa: boolean;
  horas_trabajadas: number | string;
  observaciones_entrada: string;
  observaciones_salida: string;
}

export interface SesionActivaTaller {
  id: number;
  reserva_id: number;
  inicio: string;
  observaciones: string;
}

export interface PanelTaller {
  trabajadora: {
    id: number;
    nombre: string;
    area: string;
  };
  fecha: string;
  asistencia: AsistenciaTrabajadora | null;
  sesion_activa: SesionActivaTaller | null;
}

// ─── Tipos: disponibilidad ─────────────────────────────

export interface DisponibilidadTrabajadora {
  id: number;
  dia_semana: number;
  dia_nombre: string;
  horas_disponibles: number | string;
}

export interface MiDisponibilidadTaller {
  trabajadora: string;
  total_dias_configurados: number;
  disponibilidad: DisponibilidadTrabajadora[];
}

// ─── Tipos: ausencias ──────────────────────────────────

export interface AusenciaTrabajadora {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  horas_no_disponibles: number | string;
  motivo: string;
}

export interface MisAusenciasTaller {
  trabajadora: string;
  total: number;
  ausencias: AusenciaTrabajadora[];
}

// ─── Tipos: historial ──────────────────────────────────

export interface RegistroHistorialTaller {
  id: number;
  fecha: string;
  entrada: string;
  salida: string | null;
  jornada_activa: boolean;
  horas_trabajadas: number | string;
  observaciones_entrada: string;
  observaciones_salida: string;
}

export interface SesionHistorialTaller {
  id: number;
  reserva_id: number;
  fecha: string;
  vestido: {
    contrato_id: number;
    numero: string | number;
    cliente: string;
    tipo: string;
  };
  proceso: {
    nombre: string;
    area: string;
  };
  estado_proceso: string;
  inicio: string;
  fin: string | null;
  sesion_activa: boolean;
  horas_trabajadas: number | string;
  observaciones_inicio: string;
  observaciones_fin: string;
}

export interface HistorialTaller {
  trabajadora: string;
  filtros: {
    desde: string | null;
    hasta: string | null;
  };
  asistencias: {
    total: number;
    registros: RegistroHistorialTaller[];
  };
  sesiones_trabajo: {
    total: number;
    registros: SesionHistorialTaller[];
  };
}

// ─── Tipos: resumen ────────────────────────────────────

export interface ResumenTaller {
  semana: {
    desde: string;
    hasta: string;
  };
  horas_trabajadas: number | string;
  registros_asistencia: number;
  vestidos_atendidos: number;
  procesos_trabajados: string[];
  procesos_completados: number;
}

// ─── Tipos: trabajos anteriores ────────────────────────

export interface TrabajoTaller {
  id: number;
  fecha: string;
  estado: string;
  horas_reservadas: number | string;
  horas_realizadas: number | string;
  horas_pendientes: number | string;
  vestido: {
    contrato_id: number;
    numero: string | number;
    cliente: string;
    tipo: string;
  };
  proceso: {
    plantilla_id: number;
    operacion_id: number;
    nombre: string;
    area: string;
  };
  puede_iniciar: boolean;
}

export interface ListaTrabajosTaller {
  fecha: string;
  total: number;
  trabajos: TrabajoTaller[];
}

export interface RespuestaOperacionTaller {
  detail?: string;
  asistencia?: AsistenciaTrabajadora;
  sesion?: {
    id: number;
    reserva_id?: number;
    inicio: string;
    fin?: string | null;
    horas_sesion?: number | string;
    observaciones?: string;
  };
  reserva?: {
    id: number;
    estado: string;
    horas_realizadas: number | string;
    horas_pendientes: number | string;
  };
  sesion_activa_id?: number;
}

// ─── Tipos: vestidos disponibles ───────────────────────

export interface VestidoDisponible {
  id: number;
  vestido_id: number;
  numero: number;
  codigo: string;
  estado: string;
  contrato: string;
  contrato_id: number;
  cliente?: string;
  tipo_vestido?: string;
  fecha_entrega?: string;
  /** Proceso que la jefa de taller ya inició. */
  proceso_actual?: string;
  es_de_mi_area?: boolean;
  asignada_a_mi?: boolean;
  /** Observaciones, fotos y cobros extra (visibles para todas). */
  observaciones?: {
    id: number;
    tipo: 'OBSERVACION' | 'INCIDENCIA';
    texto: string;
    autor: string;
    fecha: string;
    imagenes: string[];
    cobro_extra: number | null;
  }[];
}
// ─── Tipos: sesiones de vestidos ───────────────────────

export type EstadoSesionVestido =
  | 'EN_CURSO'
  | 'PAUSADA'
  | 'FINALIZADA';

export interface SesionVestido {
  id: number;
  vestido_id: number;
  codigo: string;
  contrato: string;
  inicio: string;
  fin: string | null;
  estado: EstadoSesionVestido;
  horas_efectivas: number | string;
  observaciones: string;
}

export interface RespuestaSesionVestido {
  detail: string;
  sesion: SesionVestido;
}

export interface ResumenDiarioVestidos {
  fecha: string;
  asistencia: {
    id: number;
    entrada: string;
    salida: string | null;
    horas_trabajadas: number | string;
  } | null;
  total_vestidos: number;
  horas_efectivas: number | string;
  vestidos?: SesionVestido[];
  sesiones?: SesionVestido[];
}

// ─── Panel ─────────────────────────────────────────────

export function obtenerMiPanel(): Promise<PanelTaller> {
  return requestTaller<PanelTaller>('/mi-panel/');
}

// ─── Jornada laboral ───────────────────────────────────

export function iniciarMiJornada(
  observaciones = ''
): Promise<RespuestaOperacionTaller> {
  return requestTaller<RespuestaOperacionTaller>(
    '/mi-jornada/iniciar/',
    'POST',
    { observaciones }
  );
}

export function finalizarMiJornada(
  observaciones = ''
): Promise<RespuestaOperacionTaller> {
  return requestTaller<RespuestaOperacionTaller>(
    '/mi-jornada/finalizar/',
    'POST',
    { observaciones }
  );
}

// ─── Disponibilidad ────────────────────────────────────

export function obtenerMiDisponibilidad(): Promise<MiDisponibilidadTaller> {
  return requestTaller<MiDisponibilidadTaller>(
    '/mi-disponibilidad/'
  );
}

// ─── Ausencias ─────────────────────────────────────────

export function obtenerMisAusencias(): Promise<MisAusenciasTaller> {
  return requestTaller<MisAusenciasTaller>('/mis-ausencias/');
}

// ─── Historial ─────────────────────────────────────────

export function obtenerMiHistorial(
  desde?: string,
  hasta?: string
): Promise<HistorialTaller> {
  const params = new URLSearchParams();

  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);

  const query = params.toString();

  return requestTaller<HistorialTaller>(
    `/mi-historial/${query ? `?${query}` : ''}`
  );
}

// ─── Resumen ───────────────────────────────────────────

export function obtenerMiResumen(): Promise<ResumenTaller> {
  return requestTaller<ResumenTaller>('/mi-resumen/');
}

// ─── Trabajos asignados (sistema anterior) ─────────────

export async function obtenerMisTrabajos(): Promise<TrabajoTaller[]> {
  const respuesta = await requestTaller<ListaTrabajosTaller>(
    '/mis-trabajos/'
  );

  return respuesta.trabajos ?? [];
}

// ─── Sesiones de trabajo (sistema anterior) ────────────

export function iniciarSesionTrabajo(
  reservaId: number,
  observaciones = ''
): Promise<RespuestaOperacionTaller> {
  return requestTaller<RespuestaOperacionTaller>(
    '/sesiones/iniciar/',
    'POST',
    {
      reserva_id: reservaId,
      observaciones,
    }
  );
}

export function finalizarSesionTrabajo(
  sesionId: number,
  observaciones = '',
  completar = false
): Promise<RespuestaOperacionTaller> {
  return requestTaller<RespuestaOperacionTaller>(
    `/sesiones/${sesionId}/finalizar/`,
    'POST',
    {
      observaciones,
      completar,
    }
  );
}

// ─── Vestidos disponibles ──────────────────────────────

export async function obtenerVestidosDisponibles(): Promise<VestidoDisponible[]> {
  // El backend devuelve directamente un array, no { total, vestidos }.
  const respuesta = await requestTaller<VestidoDisponible[]>(
    '/vestidos-disponibles/'
  );

  return Array.isArray(respuesta) ? respuesta : [];
}

// ─── Iniciar sesión de vestido ─────────────────────────

export function iniciarSesionVestido(
  vestidoId: number,
  observaciones = ''
): Promise<RespuestaSesionVestido> {
  return requestTaller<RespuestaSesionVestido>(
    '/sesiones-vestido/iniciar/',
    'POST',
    {
      vestido_id: vestidoId,
      observaciones,
    }
  );
}

// ─── Pausar sesión de vestido ──────────────────────────

export function pausarSesionVestido(
  sesionId: number,
  motivo = ''
): Promise<RespuestaSesionVestido> {
  return requestTaller<RespuestaSesionVestido>(
    `/sesiones-vestido/${sesionId}/pausar/`,
    'POST',
    { motivo }
  );
}

// ─── Reanudar sesión de vestido ────────────────────────

export function reanudarSesionVestido(
  sesionId: number
): Promise<RespuestaSesionVestido> {
  return requestTaller<RespuestaSesionVestido>(
    `/sesiones-vestido/${sesionId}/reanudar/`,
    'POST'
  );
}

// ─── Finalizar sesión de vestido ───────────────────────

export function finalizarSesionVestido(
  sesionId: number,
  observaciones = ''
): Promise<RespuestaSesionVestido> {
  return requestTaller<RespuestaSesionVestido>(
    `/sesiones-vestido/${sesionId}/finalizar/`,
    'POST',
    { observaciones }
  );
}

// ─── Resumen diario de vestidos ────────────────────────

export function obtenerResumenDiarioVestidos(): Promise<ResumenDiarioVestidos> {
  return requestTaller<ResumenDiarioVestidos>(
    '/mi-resumen-diario/'
  );
}
