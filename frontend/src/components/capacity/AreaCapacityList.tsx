import React from 'react';
import { AreaLoad } from '../../types';
import { cn, fmtH, fmtPct, toneText, utilTone } from '../../utils/format';
import { areaName } from '../../utils/processes';
import { Meter } from '../ui/Meter';

interface AreaCapacityListProps {
  loads: AreaLoad[];
  variant?: 'full' | 'compact';
}

export function AreaCapacityList({ loads, variant = 'full' }: AreaCapacityListProps) {
  const maxUtil = Math.max(...loads.map((l) => l.utilization));

  if (variant === 'compact') {
    return (
      <ul className="space-y-3">
        {loads.map((l) => {
          const tone = utilTone(l.utilization);
          return (
            <li key={l.area} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-3 text-sm">
              <span className="truncate text-cocoa">{areaName(l.area)}</span>
              <Meter value={l.utilization} label={`Utilización de ${areaName(l.area)}`} />
              <span className={cn('tabular text-right text-xs font-semibold', toneText[tone])}>{fmtH(l.available)}</span>
            </li>);

        })}
      </ul>);

  }

  return (
    <ul className="divide-y divide-line">
      {loads.map((l) => {
        const tone = utilTone(l.utilization);
        const isBottleneck = l.utilization === maxUtil && l.utilization >= 0.85;
        return (
          <li key={l.area} className="grid gap-3 py-4 md:grid-cols-[10rem_repeat(3,minmax(0,6.5rem))_minmax(0,1fr)] md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-cocoa">{areaName(l.area)}</p>
              {isBottleneck && <p className="text-[11px] font-medium text-bad">Cuello de botella</p>}
            </div>
            <Cell label="Capacidad" value={fmtH(l.capacity)} />
            <Cell label="Comprometido" value={fmtH(l.committed)} />
            <Cell label="Disponible" value={fmtH(l.available)} className={toneText[tone]} />
            <div className="flex items-center gap-3">
              <Meter value={l.utilization} label={`Utilización de ${areaName(l.area)}`} className="h-2.5" />
              <span className={cn('tabular w-12 shrink-0 text-right text-sm font-semibold', toneText[tone])}>{fmtPct(l.utilization)}</span>
            </div>
          </li>);

      })}
    </ul>);

}

function Cell({ label, value, className }: {label: string;value: string;className?: string;}) {
  return (
    <div>
      <p className="text-[11px] text-cocoa-muted md:hidden">{label}</p>
      <p className={cn('tabular text-sm font-medium text-cocoa', className)}>{value}</p>
    </div>);

}