import React from 'react';
import { CheckIcon } from 'lucide-react';
import { Dress } from '../../types';
import { cn, fmtNum } from '../../utils/format';
import { processName } from '../../utils/processes';

export function ProductionLine({ dress }: {dress: Dress;}) {
  return (
    <ol className="flex items-start overflow-x-auto pb-2" aria-label="Línea de producción">
      {dress.steps.map((s, i) => {
        const current = i === dress.currentIndex && dress.status !== 'Terminado';
        const done = s.done;
        return (
          <li key={`${s.process}-${i}`} className="flex min-w-[5.5rem] flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : done || current ? 'bg-gold-soft' : 'bg-sand')} />
              <span
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full',
                  current ? 'h-8 w-8 bg-cocoa text-ivory ring-4 ring-champagne' : 'h-6 w-6',
                  done && 'bg-gold-soft text-paper',
                  !done && !current && 'border border-nude bg-paper'
                )}>
                
                {done ? <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> : current ? <span className="tabular text-[11px] font-semibold">{i + 1}</span> : null}
              </span>
              <span className={cn('h-0.5 flex-1', i === dress.steps.length - 1 ? 'bg-transparent' : done ? 'bg-gold-soft' : 'bg-sand')} />
            </div>
            <span className={cn('mt-2 px-1 text-[11px] leading-tight', current ? 'font-semibold text-cocoa' : done ? 'text-cocoa-muted' : 'text-cocoa-faint')}>
              {processName(s.process)}
            </span>
            {s.process !== 'entrega' && <span className="tabular text-[10px] text-cocoa-faint">{fmtNum(s.estHours)} h</span>}
          </li>);

      })}
    </ol>);

}