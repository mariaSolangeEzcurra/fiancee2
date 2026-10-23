import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, workerWeekHours } from '../../contexts/AppContext';
import { incomeItems, monthlyHistory } from '../../data/finance';
import { GoalProgress } from '../../components/finance/GoalProgress';
import { PageHeader } from '../../components/ui/PageHeader';
import { AreaId } from '../../types';
import { periodLoad } from '../../utils/capacity';
import { TODAY } from '../../utils/dates';
import { computeFinance } from '../../utils/finance';
import { emptyAreas, areaName, AREA_IDS } from '../../utils/processes';

const tooltipStyle = { background: '#FFFDF9', border: '1px solid #E7DCCE', borderRadius: 8, fontSize: 12 };
const axis = { fontSize: 11, fill: '#76604F' };

export function Kpi() {
  const { dresses, workers, logs, finance } = useApp();
  const week = useMemo(() => periodLoad(dresses, workers, TODAY, 0, 6), [dresses, workers]);
  const fin = useMemo(() => computeFinance(finance, incomeItems), [finance]);

  const utilization = week.map((l) => ({ area: areaName(l.area), Capacidad: l.capacity, Utilizada: Math.round(l.committed * 10) / 10 }));
  const byArea = emptyAreas();
  workers.forEach((w) => {
    const total = Object.values(w.areas).reduce<number>((s, h) => s + (h ?? 0), 0);
    const logged = workerWeekHours(w, logs);
    (Object.keys(w.areas) as AreaId[]).forEach((a) => {
      byArea[a] += total > 0 ? logged * ((w.areas[a] ?? 0) / total) : 0;
    });
  });
  const areaHours = AREA_IDS.map((a) => ({ area: areaName(a), Horas: Math.round(byArea[a]) }));
  const perWorker = workers.map((w) => ({
    name: w.name.split(' ')[0],
    Disponible: Object.values(w.areas).reduce<number>((s, h) => s + (h ?? 0), 0),
    Registrado: Math.round(workerWeekHours(w, logs) * 10) / 10
  }));
  const margin = monthlyHistory.map((m) => ({ ...m, Ingresos: m.income, Costos: m.costs, Margen: m.income - m.costs }));

  return (
    <div className="space-y-8">
      <PageHeader title="KPI" subtitle="Gráficos simples para seguir la salud del taller mes a mes." />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Utilización del taller" subtitle="Capacidad total vs. horas utilizadas esta semana, por área.">
          <BarChart data={utilization} barGap={2}>
            <CartesianGrid vertical={false} stroke="#E7DCCE" />
            <XAxis dataKey="area" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={32} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Capacidad" fill="#E8DCCB" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Utilizada" fill="#9A7640" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Horas trabajadas por área" subtitle="Horas registradas esta semana.">
          <BarChart data={areaHours}>
            <CartesianGrid vertical={false} stroke="#E7DCCE" />
            <XAxis dataKey="area" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={32} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="Horas" fill="#9E6A63" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Horas por trabajadora" subtitle="Capacidad disponible vs. horas registradas.">
          <BarChart data={perWorker} barGap={2}>
            <CartesianGrid vertical={false} stroke="#E7DCCE" />
            <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={32} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Disponible" fill="#E8DCCB" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Registrado" fill="#4E6E4A" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Producción mensual" subtitle="Vestidos terminados por mes (septiembre en curso).">
          <BarChart data={monthlyHistory}>
            <CartesianGrid vertical={false} stroke="#E7DCCE" />
            <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="finished" name="Terminados" fill="#CDB17A" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Margen mensual" subtitle="Ingresos − costos = margen.">
          <ComposedChart data={margin}>
            <CartesianGrid vertical={false} stroke="#E7DCCE" />
            <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `S/ ${Number(v).toLocaleString('en-US')}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Ingresos" fill="#E9D8B6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Costos" fill="#D8BFA8" radius={[4, 4, 0, 0]} />
            <Line dataKey="Margen" stroke="#4A3428" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ChartCard>

        <section className="rounded-2xl border border-line bg-paper p-6">
          <h2 className="font-display text-2xl font-semibold text-cocoa">Punto de equilibrio</h2>
          <p className="mt-1 text-xs text-cocoa-muted">Cuánto falta para cubrir los gastos mensuales y llegar a la meta.</p>
          <div className="mt-6">
            <GoalProgress settings={finance} summary={fin} />
          </div>
        </section>
      </div>
    </div>);

}

function ChartCard({ title, subtitle, children }: {title: string;subtitle: string;children: React.ReactElement;}) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h2 className="font-display text-2xl font-semibold text-cocoa">{title}</h2>
      <p className="mt-1 text-xs text-cocoa-muted">{subtitle}</p>
      <div className="mt-5 h-60">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </section>);

}