import React from 'react';
import { useApp } from '../../contexts/AppContext';
import { fmtDate } from '../../utils/dates';
import { fmtH } from '../../utils/format';
import { processName } from '../../utils/processes';

export function MyNotes() {
  const { logs, currentWorkerId } = useApp();
  const notes = logs.filter((l) => l.workerId === currentWorkerId && l.note);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <h1 className="font-display text-5xl font-semibold text-cocoa">Mis observaciones</h1>
        <p className="mt-1 text-sm text-cocoa-muted">Lo que anotaste al terminar cada trabajo. La jefa de taller las ve en la ficha del vestido.</p>
      </header>
      {notes.length === 0 ?
      <p className="text-sm text-cocoa-muted">Todavía no registraste observaciones.</p> :

      <ol className="relative space-y-6 border-l border-line pl-6">
          {notes.map((l) =>
        <li key={l.id} className="relative">
              <span className="absolute -left-[1.85rem] top-1.5 h-2.5 w-2.5 rounded-full bg-gold-soft ring-4 ring-ivory" aria-hidden="true" />
              <p className="tabular text-xs text-cocoa-muted">
                {fmtDate(l.date)} · {l.dressId} · {processName(l.process)} · {fmtH(l.hours)}
              </p>
              <p className="mt-1 text-base leading-relaxed text-cocoa">{l.note}</p>
            </li>
        )}
        </ol>
      }
    </div>);

}