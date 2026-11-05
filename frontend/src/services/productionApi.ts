/**
 * Producción de vestidos (jefa de taller / gerencia).
 * Backend: /api/core/produccion/
 *
 * Cada vestido de un contrato con taller (A, C o Tienda) tiene su
 * línea de producción: los procesos de su ruta + la entrega.
 */

import { apiRequest } from './contractsApi';

const BASE = '/api/core/produccion/';

export type ProdStatus = 'En cola' | 'En producción' | 'Terminado';
export type ProdPriority = 'Alta' | 'Media' | 'Baja';
export type ProdWorkshop = 'Taller A' | 'Taller C' | 'Tienda';
export type NoteKind = 'observacion' | 'incidencia';

/** Una sesión de trabajo de una trabajadora (sale de su asistencia). */
export interface ProdSession {
  id: number;
  workerId: string;
  worker: string;
  stepIndex: number | null;
  process: string;
  status: 'Trabajando' | 'En pausa' | 'Finalizada';
  open: boolean;
  paused: boolean;
  start: string;
  end: string | null;
  hours: number; // horas efectivas (sin pausas)
  pauseMinutes: number;
  pauses: number;
  notes: string;
  shift: { date: string; checkIn: string | null; checkOut: string | null } | null;
}

export interface ProdWorkerSummary {
  workerId: string;
  worker: string;
  hours: number;
  sessions: number;
  processes: string[];
}

export interface ProdStep {
  id: number;
  index: number;
  process: string; // nombre de la operación (p. ej. "corte de tela")
  name: string; // nombre para mostrar
  area: string; // área responsable (CONFECCION, BORDADO…)
  timeType: 'TRABAJO' | 'ESPERA';
  isDelivery: boolean;
  estHours: number;
  workedHours: number;
  done: boolean;
  inProgress: boolean;
  workerIds: string[];
  workers: string[];
  completedAt: string | null;
  sessions: ProdSession[];
}

export interface ProdNote {
  id: string;
  kind: NoteKind;
  author: string;
  date: string;
  createdAt: string;
  text: string;
}

export interface ProdDress {
  id: string;
  vestidoId: number;
  code: string;
  contractId: number;
  contract: string;
  client: string;
  clientPhone: string;
  city: string;
  type: string; // tipo de evento (Novia, Quinceañera…)
  dressType: string; // tipo de vestido (Sirena, Vestido en tienda…)
  corteId: string;
  corteName: string;
  description: string;
  modality: string;
  workshop: ProdWorkshop;
  workshopCode: 'A' | 'C' | 'T';
  eventDate: string | null;
  pickupDate: string;
  deadline: string;
  estimatedEnd: string | null;
  priority: ProdPriority;
  status: ProdStatus;
  currentIndex: number;
  steps: ProdStep[];
  notes: ProdNote[];
  /** Quién tiene el vestido ahora mismo (sesión abierta). */
  activeSession: ProdSession | null;
  /** Todas las sesiones de trabajo, más reciente primero. */
  workLog: ProdSession[];
  workersSummary: ProdWorkerSummary[];
}

export interface ProdWorker {
  id: string;
  name: string;
  role: string;
  area: string;
  areas: Record<string, number>;
  skills: string[];
}

interface DressResponse {
  detail?: string;
  dress: ProdDress;
}

export const productionApi = {
  list: (filters: { q?: string; taller?: string; estado?: string } = {}) =>
    apiRequest<ProdDress[]>(`${BASE}vestidos/`, { query: filters }),

  get: (id: string) => apiRequest<DressResponse>(`${BASE}vestidos/${id}/`),

  workers: () => apiRequest<ProdWorker[]>(`${BASE}trabajadoras/`),

  completeStep: (id: string) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/completar-paso/`, { method: 'POST' }),

  setCurrentStep: (id: string, index: number) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/paso-actual/`, {
      method: 'POST',
      body: { index },
    }),

  setStepEstimate: (id: string, index: number, estHours: number) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/pasos/${index}/`, {
      method: 'PATCH',
      body: { estHours: estHours.toFixed(2) },
    }),

  toggleStepWorker: (id: string, index: number, workerId: string) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/pasos/${index}/trabajadoras/`, {
      method: 'POST',
      body: { workerId: Number(workerId) },
    }),

  update: (id: string, data: { deadline?: string | null; priority?: ProdPriority }) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/`, { method: 'PATCH', body: data }),

  addNote: (id: string, text: string, kind: NoteKind) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/notas/`, {
      method: 'POST',
      body: { text, kind },
    }),
};

// ============================================================
// FORMATO DE HORAS
// ============================================================

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const value = iso.length === 10 ? `${iso}T00:00:00` : iso;
  return new Date(value).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}

/** Horas efectivas de una sesión; si está corriendo, se calcula al momento. */
export function liveHours(s: ProdSession, now = Date.now()): number {
  if (!s.open || s.paused) return s.hours;
  const elapsed = (now - new Date(s.start).getTime()) / 3_600_000 - s.pauseMinutes / 60;
  return Math.max(s.hours, elapsed);
}

// ============================================================
// CÁLCULOS (equivalentes a dressTotals / dressRisk)
// ============================================================

export function prodTotals(d: ProdDress) {
  const work = d.steps.filter((s) => !s.isDelivery && s.timeType === 'TRABAJO');
  const est = work.reduce((s, x) => s + x.estHours, 0);
  const worked = work.reduce((s, x) => s + x.workedHours, 0);
  const remaining = work
    .filter((x) => !x.done)
    .reduce((s, x) => s + Math.max(x.estHours - x.workedHours, 0), 0);
  return { est, worked, remaining };
}

export type RiskTone = 'ok' | 'risk' | 'bad';

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prodRisk(d: ProdDress, today = todayISO()): { tone: RiskTone; label: string } {
  if (d.status === 'Terminado') return { tone: 'ok', label: 'Terminado' };
  const days = daysBetween(today, d.deadline);
  if (days < 0) return { tone: 'bad', label: `Atrasado ${-days} d` };
  if (d.estimatedEnd && d.estimatedEnd > d.deadline) return { tone: 'bad', label: 'No llega a la fecha' };

  // ~8 h de trabajo por día hábil como referencia rápida.
  const { remaining } = prodTotals(d);
  const neededDays = remaining / 8;
  if (days <= 7 || neededDays > days * 0.8) return { tone: 'risk', label: `Riesgo · ${days} d` };
  return { tone: 'ok', label: `A tiempo · ${days} d` };
}
