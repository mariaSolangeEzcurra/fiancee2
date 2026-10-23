import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, workerWeekHours } from '../../contexts/AppContext';
import { incomeItems, monthlyHistory } from '../../data/finance';
import { AlertItem } from '../../components/alerts/AlertItem';
import { BottleneckBanner } from '../../components/capacity/BottleneckBanner';
import { GoalProgress } from '../../components/finance/GoalProgress';
import { PageHeader } from '../../components/ui/PageHeader';
import { buildAlerts } from '../../utils/alerts';
import { periodLoad } from '../../utils/capacity';
import { TODAY } from '../../utils/dates';
import { dressRisk, dressTotals } from '../../utils/dresses';
import { computeFinance } from '../../utils/finance';
import { fmtH, fmtMoney, fmtPct } from '../../utils/format';
import { areaName } from '../../utils/processes';

export function Dashboard() {
  const { dresses, workers, logs, finance } = useApp();
  const week = useMemo(() => periodLoad(dresses, workers, TODAY, 0, 6), [dresses, workers]);
  const alerts = useMemo(() => buildAlerts(dresses, workers, TODAY), [dresses, workers]);
  const fin = useMemo(() => computeFinance(finance, incomeItems), [finance]);
  const active = dresses.filter((d) => d.status !== 'Terminado');

  const cap = week.reduce((s, l) => s + l.capacity, 0);
  const used = week.reduce((s, l) => s + Math.min(l.committed, l.capacity), 0);
  const overload = week.reduce((s, l) => s + Math.max(0, l.committed - l.capacity), 0);
  const logged = workers.reduce((s, w) => s + workerWeekHours(w, logs), 0);
  const paid = workers.reduce((s, w) => s + w.paidHours, 0);
  const chart = week.map((l) => ({ area: areaName(l.area), Capacidad: l.capacity, Comprometido: Math.round(l.committed * 10) / 10 }));
  const finished = monthlyHistory[monthlyHistory.length - 1].finished;

  return (
    <div className="space-y-8">
      <PageHeader title="Indicadores del taller" subtitle="Producción, personal, capacidad y finanzas integrados. Semana actual y mes de septiembre." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="rounded-2xl border border-line bg-paper p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs text-cocoa-muted">Utilización del taller · esta semana</p>
              <p className="tabular font-display text-6xl font-semibold leading-none text-cocoa">{fmtPct(used / cap)}</p>
            </div>
            <dl className="grid grid-cols-3 gap-6 text-sm">
              <Mini label="Capacidad total" value={fmtH(cap)} />
              <Mini label="Disponible" value={fmtH(cap - used)} />
              <Mini label="Sobrecarga" value={fmtH(overload)} bad={overload > 0} />
            </dl>
          </div>
          <div className="mt-6 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} barGap={2}>
                <CartesianGrid vertical={false} stroke="#E7DCCE" />
                <XAxis dataKey="area" tick={{ fontSize: 11, fill: '#76604F' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#76604F' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ background: '#FFFDF9', border: '1px solid #E7DCCE', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="Capacidad" fill="#E8DCCB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Comprometido" fill="#9A7640" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <BottleneckBanner loads={week} className="mt-4" />
        </section>

        <section className="rounded-2xl border border-line bg-paper p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Finanzas del mes</h2>
            <Link to="/gerencia/finanzas" className="text-xs font-medium text-gold hover:underline">
              Detalle
            </Link>
          </div>
          <div className="mt-4">
            <GoalProgress settings={finance} summary={fin} size="sm" />
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 text-sm">
            <Mini label="Gastos fijos" value={fmtMoney(fin.fixed)} />
            <Mini label="Costos totales" value={fmtMoney(fin.costs)} />
            <Mini label="Margen" value={fmtPct(fin.margin)} bad={fin.margin < 0} />
            <Mini label="Utilidad" value={fmtMoney(fin.profit)} bad={fin.profit < 0} />
          </dl>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section>
          <h2 className="font-display text-2xl font-semibold text-cocoa">Producción</h2>
          <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
            <Row label="Vestidos en producción" value={active.filter((d) => d.status === 'En producción').length} />
            <Row label="Vestidos terminados (mes)" value={finished} />
            <Row label="Vestidos atrasados o en riesgo alto" value={active.filter((d) => dressRisk(d, TODAY).tone === 'bad').length} />
            <Row label="Vestidos en cola" value={active.filter((d) => d.status === 'En cola').length} />
            <Row label="Horas producidas (semana)" value={fmtH(logged)} />
            <Row label="Horas pendientes" value={fmtH(active.reduce((s, d) => s + dressTotals(d).remaining, 0))} />
          </dl>
        </section>
        <section>
          <h2 className="font-display text-2xl font-semibold text-cocoa">Personal</h2>
          <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
            <Row label="Trabajadoras activas" value={workers.length} />
            <Row label="Horas disponibles" value={fmtH(cap)} />
            <Row label="Horas trabajadas" value={fmtH(logged)} />
            <Row label="Horas pagadas" value={fmtH(paid)} />
            <Row label="Utilización del personal" value={fmtPct(logged / cap)} />
            <Row label="Horas por trabajadora" value={fmtH(logged / workers.length)} />
          </dl>
        </section>
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Alertas</h2>
            <Link to="/gerencia/kpi" className="text-xs font-medium text-gold hover:underline">
              Ver KPI
            </Link>
          </div>
          <div className="mt-1 divide-y divide-line">
            {alerts.slice(0, 4).map((a) =>
            <AlertItem key={a.id} alert={a} compact />
            )}
          </div>
        </section>
      </div>
    </div>);

}

function Mini({ label, value, bad }: {label: string;value: string;bad?: boolean;}) {
  return (
    <div>
      <dt className="text-[11px] text-cocoa-muted">{label}</dt>
      <dd className={`tabular font-semibold ${bad ? 'text-bad' : 'text-cocoa'}`}>{value}</dd>
    </div>);

}

function Row({ label, value }: {label: string;value: string | number;}) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-cocoa-muted">{label}</dt>
      <dd className="tabular font-medium text-cocoa">{value}</dd>
    </div>);

}