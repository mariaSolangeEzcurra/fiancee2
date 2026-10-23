import React from 'react';
import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import { SystemAlert } from '../../types';
import { cn } from '../../utils/format';

export function AlertItem({ alert, compact = false }: {alert: SystemAlert;compact?: boolean;}) {
  const bad = alert.severity === 'bad';
  const Icon = bad ? CircleXIcon : TriangleAlertIcon;
  return (
    <article className={cn('flex gap-4', compact ? 'py-3' : 'py-5')}>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', bad ? 'text-bad' : 'text-risk')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-cocoa">{alert.title}</h3>
          <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] font-medium text-cocoa-muted">{alert.category}</span>
        </div>
        {compact ?
        <p className="mt-0.5 text-xs leading-relaxed text-cocoa-muted">{alert.why}</p> :

        <dl className="mt-2 grid gap-2 text-sm md:grid-cols-2 md:gap-6">
            <div>
              <dt className="text-[11px] font-medium text-cocoa-faint">Por qué pasa</dt>
              <dd className="leading-relaxed text-cocoa">{alert.why}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium text-cocoa-faint">Impacto</dt>
              <dd className="leading-relaxed text-cocoa">{alert.impact}</dd>
            </div>
          </dl>
        }
      </div>
    </article>);

}