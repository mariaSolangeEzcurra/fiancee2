import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TargetIcon,
  Trash2Icon,
} from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { ExpenseModal, FixedModal, PayFixedModal } from '../../components/finance/ExpenseForms';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { fmtFecha, fmtSoles, fmtSolesExacto, variacion } from '../../services/comercialApi';
import { gerenciaApi, mesActualISO, moverMes, pct } from '../../services/gerenciaApi';
import type { Category, Expense, FinanceSummary, FixedCost } from '../../services/gerenciaApi';
import { cn, inputClass } from '../../utils/format';
import { FioFinance } from '../fio/FioFinance';

type Tab = 'resumen' | 'gastos' | 'fijos' | 'ingresos';

const axis = { fontSize: 11, fill: '#76604F' };
const miles = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

/** Finanzas de gerencia: ingresos, gastos, gastos fijos y meta del mes. */
export function GerenciaFinance() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [mes, setMes] = useState(mesActualISO);
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [version, setVersion] = useState(0);
  const [metaOpen, setMetaOpen] = useState(false);
  const [expenseModal, setExpenseModal] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });
  const [payFixed, setPayFixed] = useState<{ id: number; name: string; monthly: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await gerenciaApi.finance(mes));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    } finally {
      setLoading(false);
    }
  }, [mes]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    gerenciaApi.categories().then(setCategories).catch(() => undefined);
  }, []);

  const refrescar = () => setVersion((v) => v + 1);
  const esActual = mes === mesActualISO();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'gastos', label: 'Gastos' },
    { id: 'fijos', label: 'Gastos fijos' },
    { id: 'ingresos', label: 'Ingresos' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finanzas"
        subtitle="Cuánto entró, cuánto salió y cuánto quedó. Registra aquí los gastos para que todo cuadre."
        actions={
          <button
            type="button"
            onClick={() => setExpenseModal({ open: true, expense: null })}
            className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-[#3a281f]"
          >
            <PlusIcon className="h-4 w-4" /> Nuevo gasto
          </button>
        }
      />

      {/* Mes + pestañas */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex items-center self-start rounded-xl border border-line bg-paper">
          <button type="button" onClick={() => setMes(moverMes(mes, -1))} aria-label="Mes anterior" className="rounded-l-xl p-2.5 text-cocoa hover:bg-cream">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="min-w-[9.5rem] px-2 text-center font-display text-lg font-semibold capitalize text-cocoa">{data?.monthLabel ?? '…'}</span>
          <button type="button" onClick={() => setMes(moverMes(mes, 1))} disabled={esActual} aria-label="Mes siguiente" className="rounded-r-xl p-2.5 text-cocoa hover:bg-cream disabled:opacity-30">
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <nav role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-cream/60 p-1 md:ml-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-paper text-cocoa shadow-sm ring-1 ring-line' : 'text-cocoa-muted hover:text-cocoa'
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button type="button" onClick={refrescar} aria-label="Actualizar" className="hidden rounded-xl border border-line bg-paper p-2.5 text-cocoa hover:bg-cream md:block">
          <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {tab === 'resumen' && data && (
        <Resumen
          d={data}
          loading={loading}
          onMeta={() => setMetaOpen(true)}
          onPayFixed={(x) => setPayFixed(x)}
          onPaidExpense={async (id) => {
            try {
              await gerenciaApi.updateExpense(id, { status: 'PAGADO' });
              toast.success('Marcado como pagado.');
              refrescar();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'No se pudo.');
            }
          }}
        />
      )}
      {tab === 'gastos' && (
        <GastosTab mes={mes} version={version} categories={categories} onEdit={(e) => setExpenseModal({ open: true, expense: e })} onChanged={refrescar} />
      )}
      {tab === 'fijos' && (
        <FijosTab
          mes={mes}
          monthLabel={data?.monthLabel ?? ''}
          version={version}
          categories={categories}
          onCategoriesChange={setCategories}
          onPay={(x) => setPayFixed(x)}
          onChanged={refrescar}
        />
      )}
      {tab === 'ingresos' && <FioFinance embedded month={mes} contractsBase="/gerencia/contratos" />}

      <ExpenseModal
        open={expenseModal.open}
        expense={expenseModal.expense}
        categories={categories}
        onCategoriesChange={setCategories}
        onClose={() => setExpenseModal({ open: false, expense: null })}
        onSaved={refrescar}
      />
      <PayFixedModal fixed={payFixed} month={mes} monthLabel={data?.monthLabel ?? ''} onClose={() => setPayFixed(null)} onSaved={refrescar} />
      <MetaModal open={metaOpen} mes={mes} monthLabel={data?.monthLabel ?? ''} current={data?.goal} onClose={() => setMetaOpen(false)} onSaved={refrescar} />
    </div>
  );
}

// ─── Resumen ───────────────────────────────────────────

function Resumen({
  d,
  loading,
  onMeta,
  onPayFixed,
  onPaidExpense,
}: {
  d: FinanceSummary;
  loading: boolean;
  onMeta: () => void;
  onPayFixed: (x: { id: number; name: string; monthly: number }) => void;
  onPaidExpense: (id: number) => Promise<void>;
}) {
  const g = d.goal;
  const r = d.result;
  const vIng = variacion(d.income.total, d.income.prev);
  const vGas = variacion(d.expense.month, d.expense.prev);
  const progreso = Math.min(1, g.progress ?? 0);
  const buenMargen = r.margin !== null && r.margin * 100 >= r.targetMargin;
  const maxCat = Math.max(1, ...d.expense.byCategory.map((c) => c.total));

  return (
    <div className={cn('space-y-5', loading && 'opacity-60')}>
      {/* Meta */}
      <section className="rounded-2xl border border-gold-soft bg-champagne-soft/40 p-5">
        {g.amount > 0 ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
                  <TargetIcon className="h-4 w-4 text-gold" /> Meta de {d.monthLabel.split(' ')[0]} {g.custom ? '(solo este mes)' : ''}
                </p>
                <p className="mt-1 font-display text-3xl font-semibold text-cocoa">
                  {fmtSoles(d.income.total)} <span className="text-lg font-normal text-cocoa-muted">de {fmtSoles(g.amount)}</span>
                </p>
              </div>
              <button type="button" onClick={onMeta} className="inline-flex items-center gap-1.5 rounded-lg border border-gold-soft bg-paper px-3 py-1.5 text-xs font-semibold text-cocoa hover:bg-champagne-soft">
                <PencilIcon className="h-3.5 w-3.5" /> Cambiar meta
              </button>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-paper">
              <div className={cn('h-full rounded-full transition-all', progreso >= 1 ? 'bg-emerald-500' : 'bg-gold')} style={{ width: `${progreso * 100}%` }} />
            </div>
            <p className="mt-2 text-sm text-cocoa">
              {progreso >= 1 ? (
                <span className="font-semibold text-emerald-700">¡Meta cumplida! 🎉 Llevas {pct(g.progress)} de la meta.</span>
              ) : (
                <>
                  Vas en <b>{pct(g.progress)}</b>. Faltan <b>{fmtSoles(g.missing)}</b>
                  {g.daysLeft > 0 && (
                    <>
                      {' '}en {g.daysLeft} días: unos <b>{fmtSoles(g.perDay)} por día</b>.
                    </>
                  )}
                  {d.income.toCome > 0 && (
                    <span className="text-cocoa-muted"> Hay {fmtSoles(d.income.toCome)} por cobrar en recojos de este mes.</span>
                  )}
                </>
              )}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-display text-xl font-semibold text-cocoa">Aún no tienes una meta para este mes</p>
              <p className="text-sm text-cocoa-muted">Ponle una meta de ingresos y verás cuánto te falta día a día.</p>
            </div>
            <button type="button" onClick={onMeta} className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory">
              <TargetIcon className="h-4 w-4" /> Poner meta
            </button>
          </div>
        )}
      </section>

      {/* 4 números */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Entró (ingresos)" value={fmtSoles(d.income.total)} tone="ok" foot={vIng ? <Cambio v={vIng} /> : `${d.income.count} pago(s)`} />
        <Kpi
          label="Salió (gastos)"
          value={fmtSoles(d.expense.month)}
          tone="bad"
          foot={
            <>
              {fmtSoles(d.expense.paid)} pagado
              {d.expense.pendingMonth > 0 && ` · ${fmtSoles(d.expense.pendingMonth)} por pagar`}
            </>
          }
        />
        <Kpi
          label="Quedó (utilidad)"
          value={fmtSoles(r.profitEstimated)}
          tone={r.profitEstimated >= 0 ? 'ok' : 'bad'}
          foot={
            r.margin === null ? (
              'Sin ingresos todavía'
            ) : (
              <span className={buenMargen ? 'text-emerald-700' : 'text-amber-800'}>
                Margen {pct(r.margin)} · objetivo {r.targetMargin}%
              </span>
            )
          }
          big
        />
        <Kpi label="Por cobrar a clientas" value={fmtSoles(d.income.toCollectAll)} tone="risk" foot={`Vendido este mes: ${fmtSoles(d.income.sold)}`} />
      </div>
      {vGas && d.expense.prev > 0 && (
        <p className="-mt-2 text-xs text-cocoa-muted">
          Gastos frente al mes anterior: <Cambio v={vGas} invert />. Para no perder este mes necesitas cobrar al menos <b>{fmtSoles(r.breakEven)}</b>.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* 12 meses */}
        <section className="min-w-0 rounded-2xl border border-line bg-paper p-4">
          <h2 className="text-sm font-semibold text-cocoa">Últimos 12 meses</h2>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.months} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#EDE3D6" />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: string) => v.split(' ')[0]} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={miles} />
                <Tooltip formatter={(v: number, n: string) => [fmtSoles(v), n]} cursor={{ fill: '#F6EEDD' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Gastos" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Line dataKey="goal" name="Meta" stroke="#9A7640" strokeDasharray="5 4" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Por pagar */}
        <section className="min-w-0 rounded-2xl border border-line bg-paper p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-cocoa">Por pagar</h2>
            <span className="tabular text-sm font-semibold text-rose-700">{fmtSoles(d.expense.pendingAll)}</span>
          </div>
          {d.expense.toPay.length === 0 ? (
            <p className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-emerald-800">
              <CheckCircle2Icon className="h-6 w-6" /> Todo pagado este mes.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.expense.toPay.slice(0, 8).map((x) => (
                <li key={`${x.kind}-${x.id}`} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', x.overdue ? 'border-rose-200 bg-rose-50/60' : 'border-line')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-cocoa">{x.concept}</span>
                    <span className={cn('block text-[11px]', x.overdue ? 'font-semibold text-rose-700' : 'text-cocoa-muted')}>
                      {x.kind === 'fijo' ? 'Fijo · ' : ''}
                      {x.due ? `${x.overdue ? 'Venció' : 'Vence'} el ${fmtFecha(x.due)}` : 'Sin fecha'}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-cocoa">{fmtSoles(x.amount)}</span>
                  <button
                    type="button"
                    onClick={() => (x.kind === 'fijo' ? onPayFixed({ id: x.id, name: x.concept, monthly: x.amount }) : void onPaidExpense(x.id))}
                    className="shrink-0 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    Pagar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* En qué se gastó */}
        <section className="rounded-2xl border border-line bg-paper p-4">
          <h2 className="text-sm font-semibold text-cocoa">¿En qué se gastó?</h2>
          {d.expense.byCategory.length === 0 ? (
            <p className="mt-3 text-sm text-cocoa-faint">Todavía no hay gastos pagados este mes.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {d.expense.byCategory.map((c) => (
                <li key={c.name}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span className="truncate text-cocoa">{c.name}</span>
                    <span className="tabular shrink-0 font-semibold text-cocoa">{fmtSoles(c.total)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand/60">
                    <div className="h-full rounded-full bg-rose-400" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Día a día */}
        <section className="min-w-0 rounded-2xl border border-line bg-paper p-4">
          <h2 className="text-sm font-semibold text-cocoa">Día a día</h2>
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.days} margin={{ top: 4, right: 0, left: -14, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ ...axis, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ ...axis, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={miles} />
                <Tooltip formatter={(v: number, n: string) => [fmtSolesExacto(v), n]} labelFormatter={(x: number) => `Día ${x}`} cursor={{ fill: '#F6EEDD' }} />
                <Bar dataKey="income" name="Entró" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Salió" fill="#f43f5e" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Gastos ────────────────────────────────────────────

function GastosTab({
  mes,
  version,
  categories,
  onEdit,
  onChanged,
}: {
  mes: string;
  version: number;
  categories: Category[];
  onEdit: (e: Expense) => void;
  onChanged: () => void;
}) {
  const [estado, setEstado] = useState('');
  const [categoria, setCategoria] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      gerenciaApi
        .expenses({ mes, estado: estado || undefined, categoria: categoria || undefined, q: q.trim() || undefined })
        .then((r) => alive && setItems(r.items))
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [mes, estado, categoria, q, version]);

  const total = items.reduce((s, x) => s + x.amount, 0);
  const borrar = async (e: Expense) => {
    if (!window.confirm(`¿Borrar el gasto "${e.concept}"?`)) return;
    try {
      await gerenciaApi.deleteExpense(e.id);
      toast.success('Gasto borrado.');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo borrar.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1.5">
          {[
            ['', 'Todos'],
            ['PAGADO', 'Pagados'],
            ['PENDIENTE', 'Por pagar'],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setEstado(v)}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-medium', estado === v ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted')}
            >
              {l}
            </button>
          ))}
        </div>
        <select className={cn(inputClass, 'lg:w-60')} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="relative lg:ml-auto lg:w-72">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cocoa-faint" />
          <input className={cn(inputClass, 'pl-9')} placeholder="Concepto, proveedor o boleta" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-paper">
        <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-cocoa">Gastos del mes</h2>
          <span className="tabular text-sm font-semibold text-rose-700">{fmtSolesExacto(total)}</span>
        </div>
        {loading && items.length === 0 ? (
          <p className="p-6 text-sm text-cocoa-muted">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-cocoa-faint">No hay gastos con estos filtros. Usa «Nuevo gasto» para registrar uno.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-11 shrink-0 text-center">
                  <span className="tabular block text-base font-semibold leading-none text-cocoa">{fmtFecha(e.date, { day: 'numeric' })}</span>
                  <span className="block text-[10px] uppercase text-cocoa-muted">{fmtFecha(e.date, { month: 'short' })}</span>
                </span>
                <button type="button" onClick={() => onEdit(e)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-cocoa">{e.concept}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-cocoa-muted">
                    <span>{e.category}</span>
                    {e.supplier && <span>· {e.supplier}</span>}
                    {e.receipt && <span>· {e.receipt}</span>}
                    {e.status === 'PENDIENTE' ? (
                      <span className={cn('rounded-full px-1.5 py-0.5 font-semibold', e.overdue ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800')}>
                        {e.overdue ? 'Vencido' : 'Por pagar'}
                        {e.due ? ` · ${fmtFecha(e.due)}` : ''}
                      </span>
                    ) : (
                      <span>· {e.methodLabel}</span>
                    )}
                    {e.fixedId && <span className="rounded-full bg-cream px-1.5 py-0.5">fijo</span>}
                  </span>
                </button>
                <span className="tabular shrink-0 text-sm font-semibold text-cocoa">{fmtSolesExacto(e.amount)}</span>
                <button type="button" onClick={() => void borrar(e)} aria-label="Borrar gasto" className="shrink-0 rounded-lg p-1.5 text-cocoa-faint hover:bg-rose-50 hover:text-rose-700">
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Gastos fijos ──────────────────────────────────────

function FijosTab({
  mes,
  monthLabel,
  version,
  categories,
  onCategoriesChange,
  onPay,
  onChanged,
}: {
  mes: string;
  monthLabel: string;
  version: number;
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
  onPay: (x: { id: number; name: string; monthly: number }) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ monthlyTotal: number; paidTotal: number; items: FixedCost[] } | null>(null);
  const [modal, setModal] = useState<{ open: boolean; fixed: FixedCost | null }>({ open: false, fixed: null });

  useEffect(() => {
    gerenciaApi.fixed(mes).then(setData).catch(() => setData(null));
  }, [mes, version]);

  const activos = useMemo(() => (data?.items ?? []).filter((x) => x.active), [data]);
  const inactivos = useMemo(() => (data?.items ?? []).filter((x) => !x.active), [data]);

  const quitar = async (x: FixedCost) => {
    if (!window.confirm(`¿Quitar "${x.name}" de los gastos fijos?`)) return;
    try {
      const r = await gerenciaApi.deleteFixed(x.id);
      toast.success(r && 'detail' in r && r.detail ? r.detail : 'Gasto fijo quitado.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Gastos fijos al mes" value={fmtSoles(data?.monthlyTotal ?? 0)} foot={`${activos.length} activo(s)`} />
        <Kpi label={`Pagado en ${monthLabel.split(' ')[0]}`} value={fmtSoles(data?.paidTotal ?? 0)} tone="ok" foot="de los fijos" />
        <div className="col-span-2 flex items-center sm:col-span-1">
          <button
            type="button"
            onClick={() => setModal({ open: true, fixed: null })}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gold-soft bg-paper px-4 py-4 text-sm font-semibold text-cocoa hover:bg-champagne-soft/40"
          >
            <PlusIcon className="h-4 w-4" /> Agregar gasto fijo
          </button>
        </div>
      </div>

      {activos.length === 0 ? (
        <p className="rounded-2xl border border-line bg-paper p-10 text-center text-sm text-cocoa-faint">
          Agrega lo que pagas todos los meses (alquiler, planilla, luz, internet…) y se contará solo cada mes.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {activos.map((x) => (
            <li key={x.id} className={cn('flex flex-col rounded-2xl border border-l-4 bg-paper p-4', x.paid ? 'border-line border-l-emerald-400' : x.appliesThisMonth ? 'border-line border-l-amber-400' : 'border-line border-l-slate-300')}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => setModal({ open: true, fixed: x })} className="min-w-0 text-left">
                  <span className="block truncate font-medium text-cocoa">{x.name}</span>
                  <span className="block text-xs text-cocoa-muted">
                    {x.category} · {x.frequencyLabel.toLowerCase()}
                    {x.payDay ? ` · día ${x.payDay}` : ''}
                  </span>
                </button>
                <button type="button" onClick={() => void quitar(x)} aria-label="Quitar" className="rounded-lg p-1 text-cocoa-faint hover:bg-rose-50 hover:text-rose-700">
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
              <p className="tabular mt-2 text-xl font-semibold text-cocoa">
                {fmtSoles(x.monthly)} <span className="text-xs font-normal text-cocoa-muted">al mes</span>
              </p>
              <div className="mt-auto pt-3">
                {!x.appliesThisMonth ? (
                  <span className="text-xs text-cocoa-faint">No corresponde a este mes</span>
                ) : x.paid ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2Icon className="h-4 w-4" /> Pagado {x.paidDate ? `el ${fmtFecha(x.paidDate)}` : ''} · {fmtSoles(x.paidAmount ?? 0)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPay({ id: x.id, name: x.name, monthly: x.monthly })}
                    className="w-full rounded-xl bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    Pagar {monthLabel.split(' ')[0]}
                    {x.due ? ` (vence ${fmtFecha(x.due)})` : ''}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {inactivos.length > 0 && (
        <details className="rounded-2xl border border-line bg-paper p-4 text-sm">
          <summary className="cursor-pointer text-cocoa-muted">Gastos fijos que ya no se pagan ({inactivos.length})</summary>
          <ul className="mt-2 space-y-1">
            {inactivos.map((x) => (
              <li key={x.id} className="flex justify-between gap-3 text-cocoa-muted">
                <span>{x.name}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-gold hover:underline"
                  onClick={() => void gerenciaApi.updateFixed(x.id, { active: true, to: null }).then(onChanged)}
                >
                  Volver a activar
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <FixedModal
        open={modal.open}
        fixed={modal.fixed}
        categories={categories}
        onCategoriesChange={onCategoriesChange}
        onClose={() => setModal({ open: false, fixed: null })}
        onSaved={onChanged}
      />
    </div>
  );
}

// ─── Meta ──────────────────────────────────────────────

function MetaModal({
  open,
  mes,
  monthLabel,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  mes: string;
  monthLabel: string;
  current?: FinanceSummary['goal'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [monto, setMonto] = useState('');
  const [todos, setTodos] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMonto(current?.amount ? String(current.amount) : '');
      setTodos(!current?.custom);
    }
  }, [open, current]);

  const guardar = async () => {
    if (!(Number(monto) >= 0) || monto === '') return toast.error('Ingresa la meta.');
    setSaving(true);
    try {
      if (todos) {
        await gerenciaApi.updateConfig({ monthlyGoal: Number(monto).toFixed(2) });
        if (current?.custom) await gerenciaApi.setMonthGoal(mes, null);
      } else {
        await gerenciaApi.setMonthGoal(mes, Number(monto).toFixed(2));
      }
      toast.success('Meta guardada.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Meta de ingresos" subtitle="¿Cuánto quieres cobrar en el mes?">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-cocoa-muted">Meta (S/)</span>
          <input type="number" min={0} step={100} inputMode="decimal" autoFocus className={cn(inputClass, 'tabular text-lg')} value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej.: 40000" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            [true, 'Para todos los meses', 'Es tu meta general.'],
            [false, `Solo para ${monthLabel}`, 'Por ejemplo, en temporada alta.'],
          ].map(([v, l, h]) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setTodos(v as boolean)}
              className={cn('rounded-xl border p-3 text-left', todos === v ? 'border-cocoa ring-1 ring-cocoa' : 'border-line')}
            >
              <span className="block text-sm font-semibold capitalize text-cocoa">{l as string}</span>
              <span className="block text-xs text-cocoa-muted">{h as string}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-cocoa">
            Cancelar
          </button>
          <button type="button" disabled={saving} onClick={() => void guardar()} className="rounded-xl bg-cocoa px-5 py-2.5 text-sm font-semibold text-ivory disabled:opacity-50">
            Guardar meta
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Piezas ────────────────────────────────────────────

function Cambio({ v, invert = false }: { v: { text: string; up: boolean }; invert?: boolean }) {
  const bueno = invert ? !v.up : v.up;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold', bueno ? 'text-emerald-700' : 'text-rose-700')}>
      {v.up ? <ArrowUpRightIcon className="h-3.5 w-3.5" /> : <ArrowDownRightIcon className="h-3.5 w-3.5" />}
      {v.text} vs. mes pasado
    </span>
  );
}

function Kpi({ label, value, foot, tone, big }: { label: string; value: string; foot: ReactNode; tone?: 'ok' | 'bad' | 'risk'; big?: boolean }) {
  return (
    <div className={cn('rounded-2xl border bg-paper p-4', big ? 'border-gold-soft' : 'border-line')}>
      <p className="text-xs font-medium text-cocoa-muted">{label}</p>
      <p
        className={cn(
          'tabular mt-1 truncate text-2xl font-semibold',
          tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : tone === 'risk' ? 'text-amber-800' : 'text-cocoa'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-cocoa-muted">{foot}</p>
    </div>
  );
}
