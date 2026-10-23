import React, { useState } from 'react';
import { toast } from 'sonner';
import { useApp } from '../../contexts/AppContext';
import { Field } from '../../components/ui/Field';
import { ProcessId } from '../../types';
import { fmtShort, toISO, TODAY } from '../../utils/dates';
import { cn, fmtDuration, fmtH, inputClass } from '../../utils/format';
import { processName } from '../../utils/processes';

function diffHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

export function LogHours() {
  const { dresses, addLog, logs, currentWorkerId } = useApp();
  const active = dresses.filter((d) => d.status !== 'Terminado');
  const [date, setDate] = useState(toISO(TODAY));
  const [dressId, setDressId] = useState('');
  const [process, setProcess] = useState<ProcessId | ''>('');
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('12:30');
  const [note, setNote] = useState('');
  const dress = dresses.find((d) => d.id === dressId);
  const hours = diffHours(start, end);
  const valid = dressId && process && hours > 0;
  const myLogs = logs.filter((l) => l.workerId === currentWorkerId).slice(0, 10);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !process) return;
    addLog({ workerId: currentWorkerId, dressId, process, date, start, end, hours, note: note.trim() });
    toast.success(`${fmtDuration(hours)} registrados`, { description: `${dressId} · ${processName(process)}` });
    setNote('');
    setDressId('');
    setProcess('');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <h1 className="font-display text-5xl font-semibold text-cocoa">Registrar horas</h1>
        <p className="mt-1 text-sm text-cocoa-muted">Si olvidaste usar el cronómetro, registra aquí lo que trabajaste.</p>
      </header>

      <form onSubmit={submit} className="rounded-3xl border border-line bg-paper p-6 md:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Fecha" htmlFor="lh-date">
            <input id="lh-date" type="date" className={cn(inputClass, 'tabular py-3 text-base')} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Vestido" htmlFor="lh-dress">
            <select
              id="lh-dress"
              className={cn(inputClass, 'py-3 text-base')}
              value={dressId}
              onChange={(e) => {
                setDressId(e.target.value);
                setProcess('');
              }}>
              
              <option value="">Elige un vestido</option>
              {active.map((d) =>
              <option key={d.id} value={d.id}>
                  {d.code} · {d.client}
                </option>
              )}
            </select>
          </Field>
          <Field label="Proceso" htmlFor="lh-process" className="sm:col-span-2">
            <select id="lh-process" className={cn(inputClass, 'py-3 text-base')} value={process} onChange={(e) => setProcess(e.target.value as ProcessId)} disabled={!dress}>
              <option value="">Elige un proceso</option>
              {dress?.steps.
              filter((s) => s.process !== 'entrega').
              map((s) =>
              <option key={s.process} value={s.process}>
                    {processName(s.process)}
                  </option>
              )}
            </select>
          </Field>
          <Field label="Hora de inicio" htmlFor="lh-start">
            <input id="lh-start" type="time" className={cn(inputClass, 'tabular py-3 text-base')} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Hora de término" htmlFor="lh-end">
            <input id="lh-end" type="time" className={cn(inputClass, 'tabular py-3 text-base')} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Observación" htmlFor="lh-note" className="sm:col-span-2">
            <textarea id="lh-note" rows={3} className={cn(inputClass, 'text-base')} placeholder="Qué se avanzó y qué falta." value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-cocoa-muted">
            Total: <span className="tabular text-2xl font-semibold text-cocoa">{fmtDuration(hours)}</span>
          </p>
          <button type="submit" disabled={!valid} className="rounded-2xl bg-cocoa px-8 py-4 text-base font-semibold text-ivory transition-colors duration-150 hover:bg-[#3a281f] disabled:opacity-40">
            Guardar registro
          </button>
        </div>
      </form>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold text-cocoa">Mis registros recientes</h2>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {myLogs.map((l) =>
          <li key={l.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="text-cocoa">
                  <span className="tabular font-semibold">{l.dressId}</span> · {processName(l.process)}
                </span>
                <span className="tabular block text-xs text-cocoa-muted">
                  {fmtShort(l.date)} · {l.start}–{l.end}
                </span>
              </span>
              <span className="tabular font-medium text-cocoa">{fmtH(l.hours)}</span>
            </li>
          )}
        </ul>
      </section>
    </div>);

}