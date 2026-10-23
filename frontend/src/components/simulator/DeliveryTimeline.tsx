import React from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { TODAY, fmtShort } from '../../utils/dates';
import { cn } from '../../utils/format';

interface DeliveryTimelineProps {
  start: Date;
  finish: Date;
  delivery: Date;
  event: Date;
  late: boolean;
}

export function DeliveryTimeline({ start, finish, delivery, event, late }: DeliveryTimelineProps) {
  const end = new Date(Math.max(event.getTime(), finish.getTime()));
  const span = Math.max(1, differenceInCalendarDays(end, TODAY) + 2);
  const pos = (d: Date) => `${Math.min(100, Math.max(0, differenceInCalendarDays(d, TODAY) / span * 100))}%`;
  const markers = [
  { label: 'Hoy', date: TODAY, cls: 'bg-cocoa-faint' },
  { label: 'Inicio', date: start, cls: 'bg-gold' },
  { label: 'Fin estimado', date: finish, cls: late ? 'bg-bad' : 'bg-ok' },
  { label: 'Entrega límite', date: delivery, cls: 'bg-cocoa' },
  { label: 'Evento', date: event, cls: 'bg-blush-deep' }].
  sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div className="relative px-2 pb-12 pt-12" aria-label="Línea de tiempo del contrato">
      <div className="relative h-1.5 rounded-full bg-sand">
        <div className="absolute inset-y-0 rounded-full bg-champagne" style={{ left: pos(start), width: `calc(${pos(finish)} - ${pos(start)})` }} />
        {late && <div className="absolute inset-y-0 rounded-full bg-bad/40" style={{ left: pos(delivery), width: `calc(${pos(finish)} - ${pos(delivery)})` }} />}
        {markers.map((m, i) =>
        <div key={m.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(m.date) }}>
            <span className={cn('block h-3.5 w-3.5 rounded-full ring-4 ring-paper', m.cls)} />
            <span
            className={cn(
              'absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[11px] leading-tight',
              i % 2 === 0 ? 'bottom-6' : 'top-6'
            )}>
            
              <span className="block font-medium text-cocoa">{m.label}</span>
              <span className="tabular block text-cocoa-muted">{fmtShort(m.date)}</span>
            </span>
          </div>
        )}
      </div>
    </div>);

}