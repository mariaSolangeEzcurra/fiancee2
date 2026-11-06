import { BellRingIcon, ChevronRightIcon } from 'lucide-react';

import { prodRisk, prodTotals } from '../../services/productionApi';
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead className="border-b border-line text-[11px] uppercase tracking-wide text-cocoa-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Vestido</th>
            <th className="px-4 py-3 font-medium">Clienta</th>
            <th className="px-4 py-3 font-medium">Taller</th>
            <th className="px-4 py-3 font-medium">Proceso actual</th>
            <th className="px-4 py-3 font-medium">Avance</th>
            <th className="px-4 py-3 font-medium">Fecha límite</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-2 py-3" aria-label="Abrir" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dresses.map((d) => {
            const step = d.steps[d.currentIndex];
            const risk = prodRisk(d);
            const totals = prodTotals(d);
            const doneSteps = d.steps.filter((s) => s.done).length;
            return (
              <tr
                key={d.id}
                onClick={() => onOpen(d.id)}
                className="cursor-pointer transition-colors duration-150 hover:bg-cream/60"
              >
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
                  {d.priority === 'Alta' && (
                    <span className="ml-2 rounded-full bg-bad-soft px-1.5 py-0.5 text-[10px] font-semibold text-bad">Alta</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                    <StatusPill tone="neutral">{d.status}</StatusPill>
                  </div>
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
  );
}
