/**
 * Gerencia: finanzas, gastos, gastos fijos, meta, horas e indicadores.
 * Backend: /api/core/gerencia/
 */
import { apiRequest } from './contractsApi';

const BASE = '/api/core/gerencia/';

export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';
export type Frecuencia = 'UNICO' | 'SEMANAL' | 'MENSUAL' | 'ANUAL';

export interface Category {
  id: number;
  name: string;
  type: string;
  active: boolean;
}

export interface Expense {
  id: number;
  date: string;
  concept: string;
  categoryId: number;
  category: string;
  amount: number;
  method: MetodoPago;
  methodLabel: string;
  supplier: string;
  receipt: string;
  status: 'PAGADO' | 'PENDIENTE';
  due: string | null;
  overdue: boolean;
  fixedId: number | null;
  fixedMonth: string | null;
  notes: string;
  by: string;
}

export interface ExpenseInput {
  concept?: string;
  amount?: string;
  categoryId?: number;
  date?: string;
  status?: 'PAGADO' | 'PENDIENTE';
  due?: string | null;
  method?: MetodoPago;
  supplier?: string;
  receipt?: string;
  notes?: string;
}

export interface FixedCost {
  id: number;
  name: string;
  categoryId: number;
  category: string;
  amount: number;
  monthly: number;
  frequency: Frecuencia;
  frequencyLabel: string;
  from: string;
  to: string | null;
  payDay: number | null;
  active: boolean;
  notes: string;
  appliesThisMonth?: boolean;
  due?: string | null;
  paid?: boolean;
  paidExpenseId?: number | null;
  paidAmount?: number | null;
  paidDate?: string | null;
}

export interface FixedInput {
  name?: string;
  amount?: string;
  categoryId?: number;
  frequency?: Frecuencia;
  from?: string;
  to?: string | null;
  payDay?: number | null;
  active?: boolean;
  notes?: string;
}

export interface ToPay {
  kind: 'gasto' | 'fijo';
  id: number;
  concept: string;
  category: string;
  amount: number;
  due: string | null;
  overdue: boolean;
  thisMonth: boolean;
}

export interface FinanceSummary {
  month: string;
  monthLabel: string;
  isCurrent: boolean;
  income: {
    total: number;
    count: number;
    prev: number;
    byMethod: { code: string; label: string; total: number }[];
    sold: number;
    contractsSold: number;
    toCome: number;
    toCollectAll: number;
  };
  expense: {
    paid: number;
    count: number;
    prev: number;
    pendingMonth: number;
    pendingAll: number;
    month: number;
    fixedMonthly: number;
    byCategory: { name: string; total: number }[];
    toPay: ToPay[];
  };
  result: { profit: number; profitEstimated: number; margin: number | null; targetMargin: number; breakEven: number };
  goal: { amount: number; custom: boolean; progress: number | null; missing: number; daysLeft: number; daysInMonth: number; perDay: number };
  days: { date: string; day: number; income: number; expense: number }[];
  months: { month: string; label: string; income: number; expense: number; profit: number; goal: number }[];
}

export interface BusinessConfig {
  businessName: string;
  monthlyGoal: number;
  targetMargin: number;
  customGoals: { month: string; label: string; goal: number; note: string }[];
  updatedAt: string;
}

export interface HoursRow {
  id: string;
  name: string;
  area: string;
  daysWorked: number;
  scheduled: number;
  worked: number;
  extra: number;
  inDresses: number;
  missed: number;
  absences: number;
  autoClosed: number;
  compliance: number | null;
  productive: number | null;
}

export interface HoursReport {
  from: string;
  to: string;
  totals: {
    scheduled: number;
    worked: number;
    extra: number;
    inDresses: number;
    missed: number;
    autoClosed: number;
    compliance: number | null;
    productive: number | null;
  };
  rows: HoursRow[];
}

export interface Indicators {
  from: string;
  to: string;
  months: number;
  sales: {
    contracts: number;
    sold: number;
    avgTicket: number;
    avgDressPrice: number;
    dresses: number;
    collectedRate: number | null;
    simulations: number;
    conversion: number | null;
  };
  production: {
    finished: number;
    onTime: number;
    onTimeRate: number | null;
    avgDays: number | null;
    processes: { name: string; count: number; estimated: number; real: number; diff: number | null }[];
  };
  people: { worked: number; inDresses: number; productive: number | null };
  money: { income: number; expense: number; profit: number; margin: number | null; targetMargin: number; goalsReached: number };
  topClients: { name: string; total: number }[];
  byEvent: Slice[];
  byWorkshop: Slice[];
  byModality: Slice[];
  paymentMethods: Slice[];
  expenseCategories: Slice[];
  receivables: { name: string; total: number }[];
  funnel: { name: string; value: number }[];
  hoursByProcess: { name: string; hours: number }[];
  series: {
    month: string;
    label: string;
    contracts: number;
    sold: number;
    income: number;
    expense: number;
    profit: number;
    margin: number | null;
    goal: number;
    goalReached: boolean;
    avgTicket: number;
    hoursWorked: number;
    hoursInDresses: number;
    deliveredOnTime: number;
    deliveredLate: number;
  }[];
}

export interface Slice {
  name: string;
  total: number;
  count: number;
}

const json = (body: unknown) => ({ body: body as Record<string, unknown> });

export const gerenciaApi = {
  finance: (mes?: string) => apiRequest<FinanceSummary>(`${BASE}finanzas/`, { query: { mes } }),

  expenses: (f: { mes?: string; estado?: string; categoria?: string; q?: string } = {}) =>
    apiRequest<{ total: number; items: Expense[] }>(`${BASE}gastos/`, { query: f }),
  addExpense: (data: ExpenseInput) => apiRequest<Expense>(`${BASE}gastos/`, { method: 'POST', ...json(data) }),
  updateExpense: (id: number, data: ExpenseInput) => apiRequest<Expense>(`${BASE}gastos/${id}/`, { method: 'PATCH', ...json(data) }),
  deleteExpense: (id: number) => apiRequest<null>(`${BASE}gastos/${id}/`, { method: 'DELETE' }),

  fixed: (mes?: string) =>
    apiRequest<{ month: string; monthlyTotal: number; paidTotal: number; items: FixedCost[] }>(`${BASE}fijos/`, { query: { mes } }),
  addFixed: (data: FixedInput) => apiRequest<FixedCost>(`${BASE}fijos/`, { method: 'POST', ...json(data) }),
  updateFixed: (id: number, data: FixedInput) => apiRequest<FixedCost>(`${BASE}fijos/${id}/`, { method: 'PATCH', ...json(data) }),
  deleteFixed: (id: number) => apiRequest<{ detail?: string } | null>(`${BASE}fijos/${id}/`, { method: 'DELETE' }),
  payFixed: (id: number, data: { month: string; amount?: string; date?: string; method?: MetodoPago; receipt?: string }) =>
    apiRequest<Expense>(`${BASE}fijos/${id}/pagar/`, { method: 'POST', ...json(data) }),

  categories: () => apiRequest<Category[]>(`${BASE}categorias/`),
  addCategory: (name: string) => apiRequest<Category>(`${BASE}categorias/`, { method: 'POST', ...json({ name }) }),
  updateCategory: (id: number, data: { name?: string; active?: boolean }) =>
    apiRequest<Category>(`${BASE}categorias/${id}/`, { method: 'PATCH', ...json(data) }),

  config: () => apiRequest<BusinessConfig>(`${BASE}configuracion/`),
  updateConfig: (data: { monthlyGoal?: string; targetMargin?: string; businessName?: string }) =>
    apiRequest<BusinessConfig>(`${BASE}configuracion/`, { method: 'PATCH', ...json(data) }),
  setMonthGoal: (month: string, goal: string | null, note = '') =>
    apiRequest<BusinessConfig>(`${BASE}metas/`, { method: 'POST', ...json({ month, goal, note }) }),

  hours: (desde?: string, hasta?: string) => apiRequest<HoursReport>(`${BASE}horas/`, { query: { desde, hasta } }),
  indicators: (meses = 6) => apiRequest<Indicators>(`${BASE}indicadores/`, { query: { meses: String(meses) } }),
};

export const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia / Yape / Plin' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'OTRO', label: 'Otro' },
];

export const FRECUENCIAS: { value: Frecuencia; label: string }[] = [
  { value: 'MENSUAL', label: 'Cada mes' },
  { value: 'SEMANAL', label: 'Cada semana' },
  { value: 'ANUAL', label: 'Una vez al año' },
  { value: 'UNICO', label: 'Una sola vez' },
];

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mesActualISO(): string {
  return hoyISO().slice(0, 7);
}

export function moverMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
