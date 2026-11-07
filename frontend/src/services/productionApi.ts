/**
 * Producción de vestidos (jefa de taller / gerencia).
 * Backend: /api/core/produccion/
 *
 * Cada vestido de un contrato con taller (A, C o Tienda) tiene su
 * línea de producción: los procesos de su ruta + la entrega.
 */

import { apiRequest } from './contractsApi';

const BASE = '/api/core/produccion/';

export type ProdStatus = 'Sin iniciar' | 'En proceso' | 'Terminado';
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
  operationId: number | null;
  area: string; // área responsable (CONFECCION, BORDADO…)
  timeType: 'TRABAJO' | 'ESPERA';
  isDelivery: boolean;
  isExtra: boolean; // agregado por la jefa de taller
  status: 'PENDIENTE' | 'EN_CURSO' | 'COMPLETADO';
  /** La jefa inicia el proceso: desde aquí corre el tiempo. */
  startedAt: string | null;
  startedBy: string | null;
  completedBy: string | null;
  /** Horas de reloj desde el inicio (hasta ahora o hasta que terminó). */
  elapsedHours: number | null;
  estHours: number;
  workedHours: number;
  done: boolean;
  inProgress: boolean;
  workerIds: string[];
  workers: string[];
  /** Personal que sabe hacer este proceso (solo a ellas se puede asignar). */
  eligibleWorkerIds: string[];
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
  images: { id: number; url: string }[];
  extraCharge: { id: number; concept: string; amount: number } | null;
}

export interface ProdCharge {
  id: number;
  concept: string;
  description: string;
  amount: number;
  date: string;
  by: string | null;
  noteId: string | null;
}

export interface ProdPayment {
  id: number;
  amount: number;
  date: string;
  method: string;
  concept: string;
  reference: string;
  notes: string;
  /** 1 = Primer pago, 2 = Segundo pago… (mismo número que en el contrato). */
  number: number | null;
  /** Registrado desde el taller (va ligado a un vestido). */
  fromWorkshop: boolean;
  dressCode: string | null;
}

export interface ProdFinance {
  dressPrice: number; // precio del vestido en el contrato
  dressExtras: number; // cobros extra del vestido
  dressTotal: number;
  contractTotal: number; // incluye todos los cobros extra
  contractPaid: number;
  contractBalance: number;
  charges: ProdCharge[];
  payments: ProdPayment[];
  /** Números de pago ya usados en el contrato. */
  usedPaymentNumbers: number[];
}

export interface ProdReminder {
  type: 'PRIMERA_PRUEBA' | 'BORDADO';
  date: string;
  due: boolean;
  daysLeft: number;
  title: string;
  message: string;
  // Solo en /recordatorios/
  dressId?: string;
  code?: string;
  client?: string;
  contract?: string;
}

export interface ProdOperation {
  id: number;
  name: string;
  area: string;
}

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';

export interface ProdDress {
  id: string;
  vestidoId: number;
  code: string;
  contractId: number;
  contract: string;
  contractDate: string;
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
  finance: ProdFinance;
  reminders: ProdReminder[];
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
  skillIds: number[];
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

  operations: () => apiRequest<ProdOperation[]>(`${BASE}operaciones/`),

  reminders: () => apiRequest<ProdReminder[]>(`${BASE}recordatorios/`),

  /** La jefa inicia el proceso actual (empieza a contar el tiempo). */
  startStep: (id: string) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/iniciar-proceso/`, { method: 'POST' }),

  /** Agrega un proceso (prueba extra, ajuste…) a la cola del vestido. */
  addStep: (id: string, data: { operationId: number; hours: number; after?: number; name?: string }) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/pasos/`, {
      method: 'POST',
      body: { ...data, hours: data.hours.toFixed(2) },
    }),

  removeStep: (id: string, index: number) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/pasos/${index}/`, { method: 'DELETE' }),

  addPayment: (
    id: string,
    data: {
      amount: number;
      method?: PaymentMethod;
      date?: string;
      reference?: string;
      concept?: string;
      number?: number;
      notes?: string;
    }
  ) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/pagos/`, {
      method: 'POST',
      body: { ...data, amount: data.amount.toFixed(2) },
    }),

  addCharge: (id: string, data: { concept: string; amount: number; description?: string }) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/cargos/`, {
      method: 'POST',
      body: { ...data, amount: data.amount.toFixed(2) },
    }),

  removeCharge: (id: string, chargeId: number) =>
    apiRequest<DressResponse>(`${BASE}vestidos/${id}/cargos/${chargeId}/`, { method: 'DELETE' }),

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

  /** Observación o incidencia con fotos y, si se pide, un cobro extra. */
  addNote: (
    id: string,
    text: string,
    kind: NoteKind,
    options: { images?: File[]; extraAmount?: number | null; extraConcept?: string } = {}
  ) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('text', text);
    for (const image of options.images ?? []) form.append('images', image);
    if (options.extraAmount && options.extraAmount > 0) {
      form.append('extraAmount', options.extraAmount.toFixed(2));
      if (options.extraConcept) form.append('extraConcept', options.extraConcept);
    }
    return apiRequest<DressResponse>(`${BASE}vestidos/${id}/notas/`, { method: 'POST', body: form });
  },
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

// ============================================================
// PAGOS NUMERADOS (iguales a los del contrato)
// ============================================================

export const PAYMENT_ORDINALS = [
  'Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo',
];

export function paymentName(n: number | null | undefined): string {
  if (!n) return 'Pago';
  return n <= PAYMENT_ORDINALS.length ? `${PAYMENT_ORDINALS[n - 1]} pago` : `Pago ${n}`;
}

/** Estado visual del vestido para colorear la lista de la jefa. */
export type DressTone = 'idle' | 'progress' | 'risk' | 'late' | 'done';

export function dressTone(d: ProdDress, today = todayISO()): DressTone {
  if (d.status === 'Terminado') return 'done';
  const risk = prodRisk(d, today);
  if (risk.tone === 'bad') return 'late';
  if (risk.tone === 'risk') return 'risk';
  return d.status === 'Sin iniciar' ? 'idle' : 'progress';
}

export const TONE_STYLES: Record<DressTone, { label: string; dot: string; chip: string; row: string }> = {
  idle: { label: 'Sin iniciar', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700', row: 'border-l-slate-300' },
  progress: { label: 'En proceso', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', row: 'border-l-emerald-400' },
  risk: { label: 'Ojo con la fecha', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800', row: 'border-l-amber-400' },
  late: { label: 'Atrasado', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', row: 'border-l-rose-500' },
  done: { label: 'Terminado', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700', row: 'border-l-sky-400' },
};
