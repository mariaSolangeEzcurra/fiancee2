/**
 * Personal y capacidad del taller (vista de la jefa, solo lectura).
 * Backend: /api/core/produccion/personal/ y /capacidad-areas/
 */
import { apiRequest } from './contractsApi';

const BASE = '/api/core/produccion/';

export type TodayStatus = 'TRABAJANDO' | 'TERMINO' | 'SIN_MARCAR' | 'DESCANSO' | 'PERMISO';
export type DayStatus =
  | 'TRABAJANDO'
  | 'COMPLETO'
  | 'SALIO_ANTES'
  | 'CIERRE_AUTOMATICO'
  | 'NO_VINO'
  | 'PERMISO';
export type AreaStatus = 'SIN_PERSONAL' | 'LLENA' | 'CASI_LLENA' | 'CON_ESPACIO' | 'LIBRE';

export interface ScheduleDay {
  day: number;
  label: string;
  longLabel: string;
  hours: number;
}

export interface Skill {
  id: number;
  name: string;
  area: string;
}

export interface Absence {
  id: number;
  from: string;
  to: string;
  hours: number;
  reason: string;
}

export interface StaffMember {
  id: string;
  name: string;
  initials: string;
  area: string;
  areaCode: string;
  skills: Skill[];
  schedule: ScheduleDay[];
  weekHours: number;
  weekWorked: number;
  today: {
    status: TodayStatus;
    scheduled: number;
    checkIn: string | null;
    checkOut: string | null;
    absence: Absence | null;
  };
  activeSession: { dress: string; process: string; paused: boolean; start: string } | null;
  assignedDresses: number;
  upcomingAbsences: Absence[];
}

export interface HistorySession {
  id: number;
  dress: string;
  process: string;
  start: string;
  end: string | null;
  hours: number;
  pauses: number;
  notes: string;
  open: boolean;
}

export interface HistoryDay {
  date: string;
  status: DayStatus;
  scheduled: number;
  checkIn?: string;
  checkOut?: string | null;
  hours?: number;
  extra?: number;
  extraReason?: string;
  auto?: boolean;
  notesIn?: string;
  notesOut?: string;
  sessions: HistorySession[];
  absence?: Absence | null;
}

export interface StaffDetail {
  id: string;
  name: string;
  initials: string;
  area: string;
  notes: string;
  skills: Skill[];
  schedule: ScheduleDay[];
  weekHours: number;
  absences: Absence[];
  range: { from: string; to: string; days: number };
  totals: {
    daysWorked: number;
    hours: number;
    extraHours: number;
    avgHours: number;
    autoClosed: number;
    missed: number;
    absences: number;
    dresses: number;
  };
  history: HistoryDay[];
}

export interface AreaWorker {
  id: string;
  name: string;
  initials: string;
  mainArea: string;
  processes: string[];
  hours: number;
  busy: number;
  free: number;
}

export interface AreaCapacity {
  code: string;
  name: string;
  status: AreaStatus;
  capacity: number;
  busy: number;
  free: number;
  pendingHours: number;
  utilization: number;
  people: number;
  workers: AreaWorker[];
  processes: { id: number; name: string; workers: string[]; pendingHours: number }[];
  days: { date: string; label: string; capacity: number; busy: number }[];
}

export interface CapacityWeek {
  week: number;
  from: string;
  to: string;
  totals: { people: number; pendingHours: number; capacity: number; busy: number };
  areas: AreaCapacity[];
}

export const staffApi = {
  list: () => apiRequest<StaffMember[]>(`${BASE}personal/`),
  detail: (id: string, days = 30) => apiRequest<StaffDetail>(`${BASE}personal/${id}/`, { query: { dias: String(days) } }),
  capacity: (week = 0) => apiRequest<CapacityWeek>(`${BASE}capacidad-areas/`, { query: { semana: String(week) } }),
};

// ─── Etiquetas y colores ───────────────────────────────

export const TODAY_STYLE: Record<TodayStatus, { label: string; dot: string; chip: string }> = {
  TRABAJANDO: { label: 'Trabajando', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800' },
  TERMINO: { label: 'Ya salió', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800' },
  SIN_MARCAR: { label: 'Aún no marca', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800' },
  DESCANSO: { label: 'Descanso', dot: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600' },
  PERMISO: { label: 'Con permiso', dot: 'bg-violet-400', chip: 'bg-violet-50 text-violet-800' },
};

export const DAY_STYLE: Record<DayStatus, { label: string; dot: string; chip: string }> = {
  TRABAJANDO: { label: 'En curso', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800' },
  COMPLETO: { label: 'Completo', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800' },
  SALIO_ANTES: { label: 'Salió antes', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800' },
  CIERRE_AUTOMATICO: { label: 'No marcó salida', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-800' },
  NO_VINO: { label: 'No vino', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700' },
  PERMISO: { label: 'Permiso', dot: 'bg-violet-400', chip: 'bg-violet-50 text-violet-800' },
};

export const AREA_STYLE: Record<AreaStatus, { label: string; dot: string; chip: string; bar: string; border: string }> = {
  SIN_PERSONAL: { label: 'Sin personal', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500', border: 'border-l-rose-500' },
  LLENA: { label: 'Llena', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500', border: 'border-l-rose-500' },
  CASI_LLENA: { label: 'Casi llena', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500', border: 'border-l-amber-400' },
  CON_ESPACIO: { label: 'Con espacio', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800', bar: 'bg-emerald-500', border: 'border-l-emerald-400' },
  LIBRE: { label: 'Libre', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800', bar: 'bg-sky-500', border: 'border-l-sky-400' },
};

// ─── Formato ───────────────────────────────────────────

export function horas(valor?: number | null): string {
  const h = Number(valor ?? 0);
  if (!Number.isFinite(h) || h <= 0) return '0 h';
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export function horaCorta(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function fechaCorta(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

export function diaSemana(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es-PE', { weekday: 'short' });
}
