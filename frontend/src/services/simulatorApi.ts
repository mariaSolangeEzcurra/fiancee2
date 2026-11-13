/**
 * Simulador de factibilidad (Django).
 * POST /api/core/simulador/
 *
 * Django calcula con los datos reales del taller: trabajos ya
 * comprometidos, horas de cada vestido, taller, horarios y ausencias
 * del personal. Devuelve FACTIBLE, FACTIBLE_CON_CONDICIONES o
 * NO_FACTIBLE, el área cuello de botella, la temporada alta y una
 * fecha alternativa cuando no llega.
 */

import type { AreaId, AreaNeed, SimulationResult, Tone } from '../types';
import { apiRequest } from './contractsApi';

export type BackendTaller = 'A' | 'C' | 'T';

export interface SimulacionItem {
  tipo_vestido: number;
  taller: BackendTaller;
  cantidad?: number;
  procesos?: { plantilla: number; horas: string; incluido: boolean }[];
}

export interface SimulacionInput {
  fecha_entrega: string;
  fecha_evento?: string | null;
  vestidos: SimulacionItem[];
}

export interface AreaSimulada {
  area: string;
  nombre: string;
  capacidad: number;
  comprometidas: number;
  disponibles: number;
  necesarias: number;
  sin_asignar: number;
  margen: number;
  utilizacion_actual: number;
  utilizacion_despues: number;
  estado: 'ok' | 'risk' | 'bad';
  trabajadoras: string[];
  trabajadoras_asignadas: string[];
}

export interface OperacionSimulada {
  plantilla_id: number;
  operacion: string;
  area: string;
  tipo_tiempo: 'TRABAJO' | 'ESPERA';
  horas: string;
  horas_con_holgura?: string;
  horas_sin_asignar?: string;
  inicio: string;
  fin: string;
  omitido?: boolean;
  regla?: string;
  trabajadoras: string[];
}

export interface SimulacionRespuesta {
  veredicto: 'FACTIBLE' | 'FACTIBLE_CON_CONDICIONES' | 'NO_FACTIBLE';
  estado: 'ok' | 'risk' | 'bad';
  titulo: string;
  mensaje: string;
  condiciones: string[];
  /** Explicación paso a paso del veredicto. */
  criterios?: { clave: string; estado: 'ok' | 'risk' | 'bad' | 'info'; titulo: string; detalle: string; lineas?: string[] }[];
  motivos: string[];
  advertencias: string[];
  notas: string[];
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_entrega: string;
  fecha_evento: string | null;
  margen_dias: number;
  margen_real_dias: number;
  /** Motivo principal cuando no llega (espera del proveedor, personal o días). */
  causa: {
    tipo: 'ESPERA' | 'CAPACIDAD' | 'TIEMPO';
    titulo: string;
    detalle: string;
    area: string | null;
    vestido: string;
  } | null;
  resumen_vestidos: {
    nombre: string;
    taller: BackendTaller;
    listo: string;
    a_tiempo: boolean;
    dias_margen: number;
    motivo: string | null;
  }[];
  horas_trabajo: number;
  horas_espera: number;
  horas_sin_asignar: number;
  cuello_botella: AreaSimulada | null;
  areas: AreaSimulada[];
  temporada_alta: {
    activa: boolean;
    carga: number;
    vestidos_en_produccion: number;
    umbral_carga: number;
    umbral_vestidos: number;
    factor: number;
    motivo: string;
  };
  cola: { vestidos_antes: number; horas_comprometidas: number };
  fecha_alternativa: string | null;
  vestidos: {
    nombre: string;
    taller: BackendTaller;
    fecha_inicio: string;
    fecha_fin: string;
    horas_trabajo: number;
    horas_espera: number;
    horas_sin_asignar: number;
    operaciones: OperacionSimulada[];
  }[];
}

export function simulate(data: SimulacionInput): Promise<SimulacionRespuesta> {
  return apiRequest<SimulacionRespuesta>('/api/core/simulador/', {
    method: 'POST',
    body: data,
  });
}

// ============================================================
// ADAPTADOR AL FORMATO QUE USAN LAS PANTALLAS (SimulationResult)
// ============================================================

const AREA_FRONT: Record<string, AreaId> = {
  CONFECCION: 'confeccion',
  BORDADO: 'bordado',
  PRUEBAS: 'pruebas',
  ACABADOS: 'acabados',
  LAVANDERIA: 'lavanderia',
};

function toDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function days(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

function toAreaNeed(a: AreaSimulada): AreaNeed {
  return {
    area: (AREA_FRONT[a.area] ?? a.area.toLowerCase()) as AreaId,
    label: a.nombre,
    capacity: a.capacidad,
    committed: a.comprometidas + a.necesarias,
    available: a.disponibles,
    utilization: a.utilizacion_actual,
    needed: a.necesarias,
    margin: a.margen,
    utilAfter: a.utilizacion_despues,
    readyDay: 0,
    tone: a.estado as Tone,
    staff: a.trabajadoras_asignadas.length ? a.trabajadoras_asignadas : a.trabajadoras,
    staffNeeded: a.trabajadoras_asignadas.length,
  };
}

export function toSimulationResult(r: SimulacionRespuesta): SimulationResult {
  const areas = r.areas.filter((a) => a.necesarias > 0).map(toAreaNeed);
  const critical = r.cuello_botella ? toAreaNeed(r.cuello_botella) : null;
  const operations = r.vestidos.flatMap((v) =>
    v.operaciones
      .filter((o) => !o.omitido)
      .map((o) => ({
        itemName: v.nombre,
        operationName: o.operacion.charAt(0).toUpperCase() + o.operacion.slice(1),
        operationId: o.plantilla_id,
        area: o.area,
        requiredHours: Number(o.horas_con_holgura ?? o.horas),
        assignedHours: Number(o.horas_con_holgura ?? o.horas) - Number(o.horas_sin_asignar ?? 0),
        startDate: String(o.inicio).slice(0, 10),
        finishDate: String(o.fin).slice(0, 10),
        workerIds: o.trabajadoras,
        waiting: o.tipo_tiempo === 'ESPERA',
      }))
  );

  const capacidadTotal = r.areas.reduce((s, a) => s + a.capacidad, 0);
  const comprometidas = r.areas.reduce((s, a) => s + a.comprometidas, 0);

  return {
    status: r.estado,
    totalHours: r.horas_trabajo,
    byProcess: [],
    operations,
    areas,
    start: toDate(r.fecha_inicio),
    finish: r.fecha_fin_estimada ? toDate(r.fecha_fin_estimada) : null,
    delivery: toDate(r.fecha_entrega),
    event: toDate(r.fecha_evento ?? r.fecha_entrega),
    deliveryDays: days(r.fecha_inicio, r.fecha_entrega),
    marginDays: r.margen_dias,
    availableHours: areas.reduce((s, a) => s + a.available, 0),
    marginHours: areas.reduce((s, a) => s + a.margin, 0),
    critical,
    queue: {
      dressesAhead: r.cola.vestidos_antes,
      hoursAhead: r.cola.horas_comprometidas,
      delayDays: null,
    },
    currentLoad: capacidadTotal > 0 ? comprometidas / capacidadTotal : 0,
    staffNeeded: new Set(operations.flatMap((o) => o.workerIds)).size,
    minLead: r.fecha_fin_estimada ? days(r.fecha_inicio, r.fecha_fin_estimada) : 0,
    reasons: [...r.motivos],
    alternativeDate: r.fecha_alternativa ? toDate(r.fecha_alternativa) : null,

    verdict: r.veredicto,
    verdictTitle: r.titulo,
    verdictMessage: r.mensaje,
    conditions: r.condiciones,
    criteria: (r.criterios ?? []).map((c) => ({ key: c.clave, tone: c.estado, title: c.titulo, detail: c.detalle, lines: c.lineas ?? [] })),
    notes: r.notas,
    warnings: r.advertencias,
    realMarginDays: r.margen_real_dias,
    cause: r.causa
      ? { type: r.causa.tipo, title: r.causa.titulo, detail: r.causa.detalle }
      : null,
    dressSummaries: r.resumen_vestidos.map((v) => ({
      name: v.nombre,
      workshop: v.taller,
      ready: String(v.listo).slice(0, 10),
      onTime: v.a_tiempo,
      marginDays: v.dias_margen,
      reason: v.motivo,
    })),
    bottleneck: r.cuello_botella
      ? {
          area: r.cuello_botella.area,
          name: r.cuello_botella.nombre,
          needed: r.cuello_botella.necesarias,
          available: r.cuello_botella.disponibles,
          utilAfter: r.cuello_botella.utilizacion_despues,
          missing: r.cuello_botella.sin_asignar,
        }
      : null,
    highSeason: {
      active: r.temporada_alta.activa,
      load: r.temporada_alta.carga,
      dressesInProduction: r.temporada_alta.vestidos_en_produccion,
      loadThreshold: r.temporada_alta.umbral_carga,
      dressesThreshold: r.temporada_alta.umbral_vestidos,
      factor: r.temporada_alta.factor,
      reason: r.temporada_alta.motivo,
    },
    dresses: r.vestidos.map((v) => ({
      name: v.nombre,
      workshop: v.taller,
      start: String(v.fecha_inicio).slice(0, 10),
      finish: String(v.fecha_fin).slice(0, 10),
      workHours: v.horas_trabajo,
      waitHours: v.horas_espera,
      missingHours: v.horas_sin_asignar,
    })),
  };
}
