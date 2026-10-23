import React, { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { DressDrawer } from '../../components/dress/DressDrawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { StatusPill } from '../../components/ui/StatusPill';
import { weeklyCapacity } from '../../utils/capacity';
import { calendarDaysUntil, fmtShort, TODAY } from '../../utils/dates';
import { currentStep, dressRisk, dressTotals } from '../../utils/dresses';
import { cn, fmtH, fmtNum } from '../../utils/format';
import { processName } from '../../utils/processes';

type Filter = 'todos' | 'proximos';
const priorityRank = { Alta: 0, Media: 1, Normal: 2 };

export function Queue() {
  const { dresses, workers } = useApp();
  const [filter, setFilter] = useState<Filter>('todos');
  const [openId, setOpenId] = useState<string | null>(null);

  const queue = useMemo(
    () =>
    dresses.
    filter((d) => d.status !== 'Terminado').
    map((d) => ({ d, risk: dressRisk(d, TODAY), totals: dressTotals(d) })).
    sort((a, b) => a.d.deadline.localeCompare(b.d.deadline) || priorityRank[a.d.priority] - priorityRank[b.d.priority]),
    [dresses]
  );
  const visible = filter === 'proximos' ? queue.filter((q) => calendarDaysUntil(q.d.deadline) <= 14) : queue;
  const pending = queue.reduce((s, q) => s + q.totals.remaining, 0);
  const cap = Object.values(weeklyCapacity(workers)).reduce((s, h) => s + h, 0);

  return (
    <div>
      <PageHeader
        title="Cola de producción"
        subtitle={`Ordenada por fecha límite y prioridad. ${fmtH(pending)} pendientes equivalen a unas ${fmtNum(pending / cap)} semanas de capacidad total del taller.`}
        actions={
        <div className="w-72">
            <Segmented<Filter>
            ariaLabel="Filtro de cola"
            value={filter}
            onChange={setFilter}
            options={[
            { value: 'todos', label: 'Toda la cola' },
            { value: 'proximos', label: 'Próximos a vencer' }]
            } />
          
          </div>
        } />
      

      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-cocoa-muted">
              <th scope="col" className="w-16 px-5 py-3 text-center font-medium">Pos.</th>
              <th scope="col" className="px-3 py-3 font-medium">Cliente</th>
              <th scope="col" className="px-3 py-3 font-medium">Evento</th>
              <th scope="col" className="px-3 py-3 font-medium">Fecha límite</th>
              <th scope="col" className="px-3 py-3 font-medium">Proceso actual</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Horas pendientes</th>
              <th scope="col" className="px-3 py-3 font-medium">Prioridad</th>
              <th scope="col" className="px-5 py-3 font-medium">Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ d, risk, totals }) => {
              const pos = queue.findIndex((q) => q.d.id === d.id) + 1;
              const days = calendarDaysUntil(d.deadline);
              const step = currentStep(d);
              return (
                <tr
                  key={d.id}
                  tabIndex={0}
                  onClick={() => setOpenId(d.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenId(d.id)}
                  className="cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-cream/60 focus:bg-cream/60 focus:outline-none">
                  
                  <td className="tabular px-5 py-3 text-center font-display text-2xl font-semibold text-cocoa-muted">{pos}</td>
                  <td className="px-3 py-3">
                    <span className="block text-cocoa">{d.client}</span>
                    <span className="tabular block text-[11px] text-cocoa-faint">
                      {d.code} · {d.workshop}
                      {d.isNew ? ' · nuevo' : ''}
                    </span>
                  </td>
                  <td className="tabular px-3 py-3 text-cocoa">{fmtShort(d.eventDate)}</td>
                  <td className="px-3 py-3">
                    <span className="tabular block text-cocoa">{fmtShort(d.deadline)}</span>
                    <span className={cn('block text-[11px]', days <= 7 ? 'font-medium text-bad' : 'text-cocoa-faint')}>{days < 0 ? `vencido hace ${-days} d` : `en ${days} días`}</span>
                  </td>
                  <td className="px-3 py-3 text-cocoa">{d.status === 'En cola' ? 'Por iniciar' : step ? processName(step.process) : '—'}</td>
                  <td className="tabular px-3 py-3 text-right font-medium text-cocoa">{fmtH(totals.remaining)}</td>
                  <td className="px-3 py-3">
                    <StatusPill tone={d.priority === 'Alta' ? 'risk' : 'neutral'}>{d.priority}</StatusPill>
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                  </td>
                </tr>);

            })}
          </tbody>
        </table>
      </div>
      <DressDrawer dressId={openId} onClose={() => setOpenId(null)} />
    </div>);

}