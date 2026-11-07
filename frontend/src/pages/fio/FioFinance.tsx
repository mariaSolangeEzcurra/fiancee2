import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { comercialApi, fmtFecha, fmtSoles, fmtSolesExacto, variacion } from '../../services/comercialApi';
import type { IncomeMonth } from '../../services/comercialApi';
import { cn, inputClass } from '../../utils/format';

type Origen = '' | 'contrato' | 'taller';

const METODOS = [
  { value: '', label: 'Todos' },
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'OTRO', label: 'Otro' },
];

const COLOR_METODO: Record<string, string> = {
  EFECTIVO: 'bg-emerald-500',
  TRANSFERENCIA: 'bg-sky-500',
  TARJETA: 'bg-violet-500',
  OTRO: 'bg-slate-400',
};

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moverMes(mes: string, delta: number) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Ingresos del mes (solo lo cobrado, sin gastos). */
export function FioFinance({
  month,
  embedded = false,
  contractsBase = '/fio/contratos',
}: {
  /** Mes controlado desde afuera (oculta el selector de mes). */
  month?: string;
  embedded?: boolean;
  contractsBase?: string;
} = {}) {
  const [mesPropio, setMes] = useState(mesActual);
  const mes = month ?? mesPropio;
  const [metodo, setMetodo] = useState('');
  const [origen, setOrigen] = useState<Origen>('');
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [data, setData] = useState<IncomeMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setBusqueda(q.trim()), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await comercialApi.income({ mes, metodo: metodo || undefined, origen: origen || undefined, q: busqueda || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los ingresos.');
    } finally {
      setLoading(false);
    }
  }, [mes, metodo, origen, busqueda]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data?.totals;
  const filtrando = !!(metodo || origen || busqueda);
  const cambio = t && !filtrando ? variacion(t.monthTotal, t.prevMonth) : null;
  const esteMes = mes === mesActual();

  const exportar = () => {
    if (!data) return;
    const filas = [
      ['Fecha', 'Contrato', 'Clienta', 'Concepto', 'Método', 'N.º operación', 'Origen', 'Vestido', 'Monto', 'Observación'],
      ...data.payments.map((p) => [
        p.date,
        p.contract,
        p.client,
        p.concept,
        p.methodLabel,
        p.reference,
        p.fromWorkshop ? 'Taller' : 'Contrato',
        p.dressCode ?? '',
        p.amount.toFixed(2),
        p.notes.replace(/\s+/g, ' '),
      ]),
    ];
    const csv = filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingresos-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxMes = useMemo(() => Math.max(1, ...(data?.months ?? []).map((m) => m.total)), [data]);

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="Ingresos"
          subtitle="Lo que se cobró en el mes: pagos de contratos y pagos registrados en el taller. No incluye gastos."
        />
      )}

      {/* Mes */}
      <div className="flex flex-wrap items-center gap-3">
        {!month && (
        <div className="flex items-center rounded-xl border border-line bg-paper">
          <button type="button" onClick={() => setMes(moverMes(mes, -1))} aria-label="Mes anterior" className="rounded-l-xl p-2.5 text-cocoa hover:bg-cream">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="min-w-[9.5rem] px-2 text-center font-display text-lg font-semibold capitalize text-cocoa">
            {data?.monthLabel ?? '…'}
          </span>
          <button
            type="button"
            onClick={() => setMes(moverMes(mes, 1))}
            disabled={esteMes}
            aria-label="Mes siguiente"
            className="rounded-r-xl p-2.5 text-cocoa hover:bg-cream disabled:opacity-30"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        )}
        {!esteMes && !month && (
          <button type="button" onClick={() => setMes(mesActual())} className="text-xs font-medium text-gold hover:underline">
            Ir al mes actual
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={exportar}
            disabled={!data?.payments.length}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-xs font-semibold text-cocoa hover:bg-cream disabled:opacity-40"
          >
            <DownloadIcon className="h-4 w-4" /> Descargar Excel (CSV)
          </button>
          <button type="button" onClick={() => void load()} aria-label="Actualizar" className="rounded-xl border border-line bg-paper p-2 text-cocoa hover:bg-cream">
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {/* Números */}
      {t && (
        <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', loading && 'opacity-60')}>
          <Kpi
            label={filtrando ? 'Cobrado (con filtros)' : 'Cobrado en el mes'}
            value={fmtSoles(t.total)}
            big
            foot={
              cambio ? (
                <span className={cn('inline-flex items-center gap-0.5 font-semibold', cambio.up ? 'text-emerald-700' : 'text-rose-700')}>
                  {cambio.up ? <ArrowUpRightIcon className="h-3.5 w-3.5" /> : <ArrowDownRightIcon className="h-3.5 w-3.5" />}
                  {cambio.text} vs. {fmtSoles(t.prevMonth)} del mes anterior
                </span>
              ) : filtrando ? (
                `de ${fmtSoles(t.monthTotal)} en total`
              ) : (
                'Sin datos del mes anterior'
              )
            }
          />
          <Kpi label="Pagos recibidos" value={String(t.count)} foot={t.count ? `Promedio ${fmtSoles(t.average)} · ${t.contracts} contrato(s)` : 'Ninguno todavía'} />
          <Kpi label="Vendido en el mes" value={fmtSoles(t.soldMonth)} foot={`${t.contractsSold} contrato(s) firmado(s)`} />
          <Kpi
            label="Falta cobrar"
            value={fmtSoles(t.toCollectMonth)}
            tone={t.toCollectMonth > 0 ? 'risk' : undefined}
            foot={`de recojos de este mes · total ${fmtSoles(t.toCollectAll)}`}
          />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          {METODOS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMetodo(m.value)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                metodo === m.value ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted hover:text-cocoa'
              )}
            >
              {m.value && <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', COLOR_METODO[m.value])} />}
              {m.label}
            </button>
          ))}
        </div>
        <div className="lg:w-72">
          <Segmented<Origen>
            ariaLabel="Dónde se registró"
            value={origen}
            onChange={setOrigen}
            options={[
              { value: '', label: 'Todo' },
              { value: 'contrato', label: 'En contrato' },
              { value: 'taller', label: 'En taller' },
            ]}
          />
        </div>
        <div className="relative lg:ml-auto lg:w-72">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cocoa-faint" />
          <input className={cn(inputClass, 'pl-9')} placeholder="Clienta, contrato o N.º de operación" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar pago" />
        </div>
      </div>

      {data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* Día a día */}
          <section className="min-w-0 rounded-2xl border border-line bg-paper p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-cocoa">Cobros día a día</h2>
              {t?.bestDay && (
                <span className="text-xs text-cocoa-muted">
                  Mejor día: <span className="font-semibold text-cocoa">{fmtFecha(t.bestDay.date, { weekday: 'short', day: 'numeric' })}</span> con {fmtSoles(t.bestDay.total)}
                </span>
              )}
            </div>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.days} margin={{ top: 4, right: 0, left: -14, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#76604F' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#76604F' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip
                    formatter={(v: number) => [fmtSolesExacto(v), 'Cobrado']}
                    labelFormatter={(d: number) => `Día ${d}`}
                    cursor={{ fill: '#F6EEDD' }}
                  />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                    {data.days.map((d) => (
                      <Cell key={d.day} fill={t?.bestDay?.day === d.day ? '#9A7640' : '#4A3428'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Cómo pagaron */}
          <section className="space-y-4 rounded-2xl border border-line bg-paper p-4">
            <div>
              <h2 className="text-sm font-semibold text-cocoa">¿Cómo pagaron?</h2>
              {data.byMethod.length === 0 ? (
                <p className="mt-2 text-xs text-cocoa-faint">Sin pagos.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.byMethod.map((m) => {
                    const pct = t && t.total ? m.total / t.total : 0;
                    return (
                      <li key={m.code}>
                        <div className="flex justify-between text-xs">
                          <span className="text-cocoa">{m.label} <span className="text-cocoa-faint">· {m.count}</span></span>
                          <span className="tabular font-semibold text-cocoa">{fmtSoles(m.total)} <span className="font-normal text-cocoa-muted">({Math.round(pct * 100)}%)</span></span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand/60">
                          <div className={cn('h-full rounded-full', COLOR_METODO[m.code] ?? 'bg-cocoa')} style={{ width: `${pct * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {data.byType.length > 0 && (
              <div className="border-t border-line pt-3">
                <h2 className="text-sm font-semibold text-cocoa">¿Qué pago fue?</h2>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {data.byType.map((x) => (
                    <div key={x.label} className="rounded-xl bg-cream/60 px-3 py-2">
                      <p className="text-[11px] text-cocoa-muted">{x.label} · {x.count}</p>
                      <p className="tabular text-sm font-semibold text-cocoa">{fmtSoles(x.total)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Últimos 12 meses */}
      {data && (
        <section className="rounded-2xl border border-line bg-paper p-4">
          <h2 className="text-sm font-semibold text-cocoa">Últimos 12 meses</h2>
          {!month && <p className="text-xs text-cocoa-muted">Toca un mes para verlo.</p>}
          <div className="mt-3 flex h-28 items-end gap-1.5 overflow-x-auto">
            {data.months.map((m) => (
              <button
                key={m.month}
                type="button"
                onClick={() => !month && setMes(m.month)}
                title={`${m.label}: ${fmtSoles(m.total)}`}
                className="group flex min-w-[2.25rem] flex-1 flex-col items-center gap-1"
              >
                <span className="flex h-20 w-full items-end">
                  <span
                    className={cn('w-full rounded-t-md transition-colors', m.month === mes ? 'bg-gold' : 'bg-cocoa/25 group-hover:bg-cocoa/50')}
                    style={{ height: `${Math.max(3, (m.total / maxMes) * 100)}%` }}
                  />
                </span>
                <span className={cn('text-[10px] capitalize', m.month === mes ? 'font-semibold text-cocoa' : 'text-cocoa-muted')}>
                  {m.label.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Detalle de pagos */}
      {data && (
        <section className="rounded-2xl border border-line bg-paper">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-cocoa">Detalle de pagos</h2>
            <span className="text-xs text-cocoa-muted">{data.payments.length} pago(s)</span>
          </div>
          {data.payments.length === 0 ? (
            <p className="p-8 text-center text-sm text-cocoa-faint">No hay pagos {filtrando ? 'con estos filtros' : 'en este mes'}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.payments.map((p) => (
                <li key={p.id}>
                  <Link to={`${contractsBase}?abrir=${p.contractId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream/50">
                    <span className="w-11 shrink-0 text-center">
                      <span className="tabular block text-base font-semibold leading-none text-cocoa">{fmtFecha(p.date, { day: 'numeric' })}</span>
                      <span className="block text-[10px] uppercase text-cocoa-muted">{fmtFecha(p.date, { weekday: 'short' })}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-cocoa">
                        {p.client || p.contract} <span className="font-normal text-cocoa-muted">· {p.concept}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-cocoa-muted">
                        <span className="inline-flex items-center gap-1">
                          <span className={cn('h-1.5 w-1.5 rounded-full', COLOR_METODO[p.method] ?? 'bg-cocoa')} /> {p.methodLabel}
                        </span>
                        <span>· {p.contract}</span>
                        {p.reference && <span>· Op. {p.reference}</span>}
                        {p.fromWorkshop && (
                          <span className="rounded-full bg-champagne-soft px-1.5 py-0.5 font-medium text-cocoa">taller{p.dressCode ? ` · ${p.dressCode}` : ''}</span>
                        )}
                      </span>
                      {p.notes && <span className="mt-0.5 block truncate text-[11px] italic text-cocoa-muted">{p.notes}</span>}
                    </span>
                    <span className="tabular shrink-0 text-sm font-semibold text-emerald-800">{fmtSolesExacto(p.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, foot, tone, big }: { label: string; value: string; foot: ReactNode; tone?: 'risk'; big?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-paper p-4', big && 'border-gold-soft bg-champagne-soft/40')}>
      <p className="text-xs font-medium text-cocoa-muted">{label}</p>
      <p className={cn('tabular mt-1 truncate text-2xl font-semibold', tone === 'risk' ? 'text-amber-800' : 'text-cocoa')}>{value}</p>
      <p className="mt-0.5 text-xs text-cocoa-muted">{foot}</p>
    </div>
  );
}
