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

  const response = await fetch(`${TALLER_URL}${endpoint}`, {
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

// ─── Tipos ─────────────────────────────────────────────

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

// ─── Trabajos asignados ────────────────────────────────

export async function obtenerMisTrabajos(): Promise<TrabajoTaller[]> {
  const respuesta = await requestTaller<ListaTrabajosTaller>(
    '/mis-trabajos/'
  );

  return respuesta.trabajos;
}

// ─── Sesiones de trabajo ───────────────────────────────

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
