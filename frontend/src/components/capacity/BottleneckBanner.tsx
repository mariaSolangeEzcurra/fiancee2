import React from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { AreaLoad } from '../../types';
import { bottleneck } from '../../utils/capacity';
import { cn, fmtH, fmtPct } from '../../utils/format';
import { areaName } from '../../utils/processes';

export function BottleneckBanner({ loads, className }: {loads: AreaLoad[];className?: string;}) {
  const b = bottleneck(loads);
  if (!b || b.utilization < 0.85) return null;
  const critical = b.utilization >= 0.95;
  return (
    <div className={cn('flex items-start gap-4 rounded-2xl border px-5 py-4', critical ? 'border-bad/25 bg-bad-soft' : 'border-gold-soft bg-risk-soft', className)} role="status">
      <TriangleAlertIcon className={cn('mt-0.5 h-5 w-5 shrink-0', critical ? 'text-bad' : 'text-risk')} aria-hidden="true" />
      <div className="min-w-0">
        <p className={cn('text-sm font-bold uppercase tracking-wide', critical ? 'text-bad' : 'text-risk')}>
          {critical ? 'Cuello de botella' : 'Capacidad ajustada'}: {areaName(b.area)}
        </p>
        <p className="mt-0.5 text-sm text-cocoa">
          {fmtH(b.committed)} comprometidas frente a {fmtH(b.capacity)} de capacidad ({fmtPct(b.utilization)}).{' '}
          {critical ?
          'Cualquier vestido nuevo que necesite este proceso esta semana se retrasa.' :
          `Quedan ${fmtH(b.available)} libres.`}
        </p>
      </div>
    </div>);

}