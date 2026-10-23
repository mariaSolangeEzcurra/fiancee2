import React, { useMemo, useState } from 'react';
import { useApp, workerWeekHours } from '../../contexts/AppContext';
import { AreaCapacityList } from '../../components/capacity/AreaCapacityList';
import { BottleneckBanner } from '../../components/capacity/BottleneckBanner';
import { Meter } from '../../components/ui/Meter';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { Stat } from '../../components/ui/Stat';
import { AreaId, AreaLoad } from '../../types';
import { periodLoad, weeklyCapacity } from '../../utils/capacity';
import { addWorkingDays, fmtShort, TODAY } from '../../utils/dates';
import { cn, fmtH, fmtNum, fmtPct, toneSoft, utilTone } from '../../utils/format';
import { AREA_IDS, areaName } from '../../utils/processes';

type View = 'area' | 'semana' | 'dia' | 'trabajador';

export function Capacity() {
  const { dresses, workers, logs } = useApp();
  const [view, setView] = useState<View>('area');
  const week = useMemo(() => periodLoad(dresses, workers, TODAY, 0, 6), [dresses, workers]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => periodLoad(dresses, workers, TODAY, w * 6, w * 6 + 6)), [dresses, workers]);
  const days = useMemo(() => Array.from({ length: 6 }, (_, d) => periodLoad(dresses, workers, TODAY, d, d + 1)), [dresses, workers]);
  const cap = weeklyCapacity(workers);

  const totalCap = week.reduce((s, l) => s + l.capacity, 0);
  const totalCommitted = week.reduce((s, l) => s + l.committed, 0);
  const overload = week.reduce((s, l) => s + Math.max(0, l.committed - l.capacity), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capacidad"
        subtitle="Capacidad real = horas disponibles del personal − horas ya comprometidas. Se calcula por proceso: un proceso saturado limita a todo el taller." />
      

      <div className="grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-4">
        <Stat label="Capacidad semanal" value={fmtH(totalCap)} sub={`${workers.length} trabajadoras`} />
        <Stat label="Comprometido" value={fmtH(totalCommitted)} sub={fmtPct(totalCommitted / totalCap)} />
        <Stat label="Disponible" value={fmtH(week.reduce((s, l) => s + l.available, 0))} tone="ok" />
        <Stat label="Sobrecarga" value={fmtH(overload)} tone={overload > 0 ? 'bad' : 'ok'} sub="horas por encima de la capacidad" />
      </div>

      <BottleneckBanner loads={week} />

      <div className="max-w-lg">
        <Segmented<View>
          ariaLabel="Vista de capacidad"
          value={view}
          onChange={setView}
          options={[
          { value: 'area', label: 'Área / proceso' },
          { value: 'semana', label: 'Semana' },
          { value: 'dia', label: 'Día' },
          { value: 'trabajador', label: 'Trabajadora' }]
          } />
        
      </div>

      <section className="rounded-2xl border border-line bg-paper px-6 py-2">
        {view === 'area' &&
        <>
            <p className="pt-4 text-xs text-cocoa-muted">Semana actual · {fmtShort(addWorkingDays(TODAY, 1))} al {fmtShort(addWorkingDays(TODAY, 6))}</p>
            <div className="hidden grid-cols-[10rem_repeat(3,minmax(0,6.5rem))_minmax(0,1fr)] gap-3 border-b border-line pb-2 pt-4 text-xs text-cocoa-muted md:grid">
              <span>Área</span>
              <span>Capacidad</span>
              <span>Comprometido</span>
              <span>Disponible</span>
              <span>Utilización</span>
            </div>
            <AreaCapacityList loads={week} />
          </>
        }
        {view === 'semana' &&
        <HeatTable
          columns={weeks.map((_, i) => `Sem. ${fmtShort(addWorkingDays(TODAY, i * 6 + 1))}`)}
          data={weeks}
          caption="Utilización prevista por semana. Las horas pendientes de cada vestido se reparten hasta su fecha límite." />

        }
        {view === 'dia' &&
        <HeatTable
          columns={days.map((_, i) => fmtShort(addWorkingDays(TODAY, i + 1)))}
          data={days}
          caption="Utilización prevista por día hábil de la próxima semana." />

        }
        {view === 'trabajador' &&
        <div className="overflow-x-auto py-4">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-cocoa-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">Trabajadora</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Área</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Capacidad semanal</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Asignado (plan)</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Registrado</th>
                  <th scope="col" className="w-48 py-2 font-medium">Carga planificada</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => {
                const capacity = Object.values(w.areas).reduce<number>((s, h) => s + (h ?? 0), 0);
                const assigned = (Object.keys(w.areas) as AreaId[]).reduce((s, a) => {
                  const load = week.find((l) => l.area === a);
                  return s + (load && cap[a] > 0 ? load.committed * ((w.areas[a] ?? 0) / cap[a]) : 0);
                }, 0);
                const u = capacity > 0 ? assigned / capacity : 0;
                return (
                  <tr key={w.id} className="border-b border-line/70 last:border-0">
                      <td className="py-3 pr-3 font-medium text-cocoa">{w.name}</td>
                      <td className="py-3 pr-3 text-cocoa-muted">{(Object.keys(w.areas) as AreaId[]).map(areaName).join(' · ')}</td>
                      <td className="tabular py-3 pr-3 text-right text-cocoa">{fmtH(capacity)}</td>
                      <td className="tabular py-3 pr-3 text-right text-cocoa">{fmtH(assigned)}</td>
                      <td className="tabular py-3 pr-3 text-right text-cocoa">{fmtH(workerWeekHours(w, logs))}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Meter value={u} label={`Carga de ${w.name}`} />
                          <span className="tabular w-10 text-right text-xs text-cocoa-muted">{fmtPct(u)}</span>
                        </div>
                      </td>
                    </tr>);

              })}
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>);

}

function HeatTable({ columns, data, caption }: {columns: string[];data: AreaLoad[][];caption: string;}) {
  return (
    <div className="overflow-x-auto py-4">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="pb-3 text-left text-xs text-cocoa-muted">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-cocoa-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Área</th>
            {columns.map((c) =>
            <th key={c} scope="col" className="tabular px-1 py-2 text-center font-medium">
                {c}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {AREA_IDS.map((a) =>
          <tr key={a}>
              <th scope="row" className="py-1 pr-3 text-left font-medium text-cocoa">
                {areaName(a)}
              </th>
              {data.map((period, i) => {
              const l = period.find((x) => x.area === a);
              if (!l) return <td key={i} />;
              const tone = utilTone(l.utilization);
              return (
                <td key={i} className="px-1 py-1">
                    <div className={cn('rounded-md px-2 py-2 text-center', l.utilization < 0.6 ? 'bg-cream text-cocoa-muted' : toneSoft[tone])} title={`${fmtNum(l.committed)} de ${fmtNum(l.capacity)} h`}>
                      <span className="tabular block text-sm font-semibold">{fmtPct(l.utilization)}</span>
                      <span className="tabular block text-[10px] opacity-80">{fmtH(l.available)} libres</span>
                    </div>
                  </td>);

            })}
            </tr>
          )}
        </tbody>
      </table>
    </div>);

}