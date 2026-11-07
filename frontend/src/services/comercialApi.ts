/**
 * Área comercial (solo lectura): inicio e ingresos.
 * Backend: /api/core/comercial/
 */
import { apiRequest } from './contractsApi';

const BASE = '/api/core/comercial/';

export type DeliveryTone = 'ok' | 'late' | 'risk' | 'progress' | 'idle';

export interface Delivery {
  dressId: string | null;
  code: string;
  dressType: string;
  workshop: string;
  contractId: number;
  contract: string;
  client: string;
  phone: string;
  date: string;
  eventDate: string | null;
  daysLeft: number;
  status: 'LISTO' | 'SIN_TALLER' | 'SIN_INICIAR' | 'EN_PROCESO';
  statusLabel: string;
  tone: DeliveryTone;
  progress: number;
  currentProcess: string;
  balance: number;
}

export interface ComercialHome {
  today: string;
  monthLabel: string;
  kpis: {
    collectedMonth: number;
    collectedPrev: number;
    soldMonth: number;
    contractsMonth: number;
    toCollect: number;
    contractsWithBalance: number;
    inWorkshop: number;
    late: number;
    ready: number;
    simulations: number;
    simulationsAccepted: number;
  };
  deliveries: Delivery[];
  collect: {
    contractId: number;
    contract: string;
    client: string;
    phone: string;
    date: string;
    daysLeft: number;
    balance: number;
    total: number;
  }[];
  events: { contractId: number; contract: string; client: string; date: string; daysLeft: number; type: string }[];
  reminders: {
    code: string;
    client: string;
    phone: string;
    contractId: number;
    date: string;
    due: boolean;
    daysLeft: number;
    title: string;
    message: string;
  }[];
  months: { month: string; label: string; sold: number; contracts: number; collected: number }[];
}

export interface IncomePayment {
  id: number;
  date: string;
  amount: number;
  concept: string;
  number: number | null;
  method: string;
  methodLabel: string;
  reference: string;
  notes: string;
  contractId: number;
  contract: string;
  client: string;
  fromWorkshop: boolean;
  dressCode: string | null;
  by: string;
}

export interface IncomeMonth {
  month: string;
  monthLabel: string;
  isCurrent: boolean;
  filters: { metodo: string; origen: string; q: string };
  totals: {
    total: number;
    monthTotal: number;
    prevMonth: number;
    count: number;
    average: number;
    contracts: number;
    fromWorkshop: number;
    soldMonth: number;
    contractsSold: number;
    toCollectMonth: number;
    toCollectAll: number;
    bestDay: { date: string; day: number; total: number } | null;
  };
  byMethod: { code: string; label: string; total: number; count: number }[];
  byType: { label: string; total: number; count: number }[];
  days: { date: string; day: number; total: number }[];
  months: { month: string; label: string; total: number }[];
  payments: IncomePayment[];
}

export const comercialApi = {
  home: () => apiRequest<ComercialHome>(`${BASE}inicio/`),
  income: (f: { mes?: string; metodo?: string; origen?: string; q?: string }) =>
    apiRequest<IncomeMonth>(`${BASE}ingresos/`, { query: f }),
};

// ─── Formato peruano ───────────────────────────────────

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 0 });
const solesExactos = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

export const fmtSoles = (n: number) => soles.format(n || 0);
export const fmtSolesExacto = (n: number) => solesExactos.format(n || 0);

export function fmtFecha(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es-PE', opts);
}

export function cuandoFalta(dias: number): string {
  if (dias < -1) return `hace ${-dias} días`;
  if (dias === -1) return 'ayer';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

/** Variación porcentual entre dos montos ("+12%", "−5%"). */
export function variacion(actual: number, anterior: number): { text: string; up: boolean } | null {
  if (!anterior) return null;
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  return { text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct >= 0 };
}

export function whatsapp(phone: string, texto = ''): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  const numero = digits.length === 9 ? `51${digits}` : digits;
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

export const DELIVERY_TONE: Record<DeliveryTone, { dot: string; chip: string; border: string }> = {
  ok: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800', border: 'border-l-sky-400' },
  late: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', border: 'border-l-rose-500' },
  risk: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800', border: 'border-l-amber-400' },
  progress: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800', border: 'border-l-emerald-400' },
  idle: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700', border: 'border-l-slate-300' },
};
