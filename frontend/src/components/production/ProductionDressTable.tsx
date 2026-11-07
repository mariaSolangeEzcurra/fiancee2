import { BellRingIcon, ChevronRightIcon } from 'lucide-react';

import { dressTone, prodRisk, prodTotals, TONE_STYLES } from '../../services/productionApi';
import type { ProdDress } from '../../services/productionApi';
import { fmtDate } from '../../utils/dates';
import { cn, fmtH } from '../../utils/format';
import { Meter } from '../ui/Meter';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  dresses: ProdDress[];
  onOpen: (id: string) => void;
}

export function ProductionDressTable({ dresses, onOpen }: Props) {
  if (dresses.length === 0) {
    return <p className="p-8 text-center text-sm text-cocoa-faint">No hay vestidos con estos filtros.</p>;
  }

  return (
    <>
    {/* Celular: tarjetas */}
    <ul className="divide-y divide-line sm:hidden">
      {dresses.map((d) => {
        const step = d.steps[d.currentIndex];
        const tone = TONE_STYLES[dressTone(d)];
        const doneSteps = d.steps.filter((s) => s.done).length;
        return (
          <li key={d.id}>
            <button type="button" onClick={() => onOpen(d.id)} className={cn('flex w-full items-center gap-3 border-l-4 px-3 py-3 text-left', tone.row)}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-cocoa">{d.code}</span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', tone.chip)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" /> {tone.label}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-cocoa-muted">
                  {d.client || '—'} · {d.dressType} · entrega {fmtDate(d.deadline)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-cocoa">
                  {d.status === 'Terminado' ? 'Terminado' : `${step?.name ?? '—'}${d.activeSession ? ` · ${d.activeSession.worker}` : ''}`}
                </span>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-sand/60">
                  <span className="block h-full rounded-full bg-cocoa/60" style={{ width: `${d.steps.length ? (doneSteps / d.steps.length) * 100 : 0}%` }} />
                </span>
              </span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-cocoa-faint" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>

    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-line text-[11px] uppercase tracking-wide text-cocoa-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Vestido</th>
            <th className="px-4 py-3 font-medium">Clienta</th>
            <th className="px-4 py-3 font-medium">Taller</th>
            <th className="px-4 py-3 font-medium">Proceso actual</th>
            <th className="px-4 py-3 font-medium">Avance</th>
            <th className="px-4 py-3 font-medium">Entrega</th>
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-2 py-3" aria-label="Abrir" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dresses.map((d) => {
            const step = d.steps[d.currentIndex];
            const risk = prodRisk(d);
            const totals = prodTotals(d);
            const doneSteps = d.steps.filter((s) => s.done).length;
            const tone = TONE_STYLES[dressTone(d)];
            return (
              <tr
                key={d.id}
                onClick={() => onOpen(d.id)}
                className={cn('cursor-pointer border-l-4 transition-colors duration-150 hover:bg-cream/60', tone.row)}
              >
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', tone.chip)}>
                    <span className={cn('h-2 w-2 rounded-full', tone.dot)} aria-hidden="true" />
                    {tone.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-cocoa">
                    {d.code}
                    {d.reminders.some((r) => r.due) && (
                      <BellRingIcon className="ml-1.5 inline h-3.5 w-3.5 text-amber-700" aria-label="Recordatorio pendiente" />
                    )}
                  </p>
                  <p className="text-xs text-cocoa-muted">{d.dressType}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-cocoa">{d.client || '—'}</p>
                  <p className="text-xs text-cocoa-muted">{d.type}</p>
                </td>
                <td className="px-4 py-3 text-cocoa">{d.workshop}</td>
                <td className="px-4 py-3">
                  {d.status === 'Terminado' ? (
                    <span className="text-cocoa-muted">—</span>
                  ) : (
                    <>
                      <p className="text-cocoa">{step?.name ?? '—'}</p>
                      <p className="text-xs text-cocoa-muted">
                        {d.activeSession
                          ? `${d.activeSession.paused ? 'En pausa' : 'Trabajando'}: ${d.activeSession.worker}`
                          : step?.status === 'PENDIENTE' && !step.isDelivery
                            ? 'Sin iniciar'
                            : step?.workers.join(', ') || 'Sin asignar'}
                      </p>
                    </>
                  )}
                </td>
                <td className="w-40 px-4 py-3">
                  <Meter value={d.steps.length ? doneSteps / d.steps.length : 0} tone="neutral" label={`Avance de ${d.code}`} />
                  <p className="tabular mt-1 text-[11px] text-cocoa-muted">
                    {doneSteps}/{d.steps.length} · {fmtH(totals.remaining)} pend.
                  </p>
                </td>
                <td className="tabular px-4 py-3 text-cocoa">
                  {fmtDate(d.deadline)}
                  {d.priority !== 'Media' && (
                    <span
                      className={cn(
                        'ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        d.priority === 'Alta' ? 'bg-bad-soft text-bad' : 'bg-cream text-cocoa-muted'
                      )}
                    >
                      Prioridad {d.priority.toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                </td>
                <td className="px-2 py-3 text-cocoa-faint">
                  <ChevronRightIcon className={cn('h-4 w-4')} aria-hidden="true" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
