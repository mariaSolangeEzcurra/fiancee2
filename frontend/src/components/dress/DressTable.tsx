import React from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Dress } from '../../types';
import { TODAY, fmtShort } from '../../utils/dates';
import { currentStep, dressRisk, dressTotals } from '../../utils/dresses';
import { fmtNum, fmtPct } from '../../utils/format';
import { processName } from '../../utils/processes';
import { Meter } from '../ui/Meter';
import { StatusPill } from '../ui/StatusPill';

export function DressTable({ dresses, onOpen }: {dresses: Dress[];onOpen: (id: string) => void;}) {
  if (dresses.length === 0) {
    return <p className="px-6 py-12 text-center text-sm text-cocoa-muted">No hay vestidos que coincidan con los filtros.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-cocoa-muted">
            <th scope="col" className="px-5 py-3 font-medium">Vestido</th>
            <th scope="col" className="px-3 py-3 font-medium">Cliente</th>
            <th scope="col" className="px-3 py-3 font-medium">Taller</th>
            <th scope="col" className="px-3 py-3 font-medium">Proceso</th>
            <th scope="col" className="w-40 px-3 py-3 font-medium">Avance</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Horas</th>
            <th scope="col" className="px-3 py-3 font-medium">Fecha límite</th>
            <th scope="col" className="px-3 py-3 font-medium">Riesgo</th>
            <th scope="col" className="w-8 px-3 py-3"><span className="sr-only">Abrir</span></th>
          </tr>
        </thead>
        <tbody>
          {dresses.map((d) => {
            const t = dressTotals(d);
            const risk = dressRisk(d, TODAY);
            const step = currentStep(d);
            return (
              <tr
                key={d.id}
                onClick={() => onOpen(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(d.id);
                }}
                tabIndex={0}
                className="cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-cream/60 focus:bg-cream/60 focus:outline-none">
                
                <td className="px-5 py-3">
                  <span className="tabular font-semibold text-cocoa">{d.code}</span>
                  {d.isNew && <span className="ml-2 rounded-full bg-blush-soft px-1.5 py-0.5 text-[10px] font-semibold text-blush-deep">Nuevo</span>}
                </td>
                <td className="px-3 py-3">
                  <span className="block text-cocoa">{d.client}</span>
                  <span className="block text-[11px] text-cocoa-faint">{d.type} · {d.city}</span>
                </td>
                <td className="px-3 py-3 text-cocoa-muted">{d.workshop === 'Taller C' ? 'C → A' : 'Taller A'}</td>
                <td className="px-3 py-3 text-cocoa">{d.status === 'En cola' ? <span className="text-cocoa-muted">En cola</span> : step ? processName(step.process) : '—'}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Meter value={t.progress} tone="neutral" label={`Avance ${d.code}`} />
                    <span className="tabular w-9 text-right text-xs text-cocoa-muted">{fmtPct(t.progress)}</span>
                  </div>
                </td>
                <td className="tabular px-3 py-3 text-right text-cocoa">
                  {fmtNum(t.worked)}/{fmtNum(t.est)} h
                </td>
                <td className="tabular px-3 py-3 text-cocoa">{fmtShort(d.deadline)}</td>
                <td className="px-3 py-3">
                  <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                </td>
                <td className="px-3 py-3 text-cocoa-faint">
                  <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                </td>
              </tr>);

          })}
        </tbody>
      </table>
    </div>);

}