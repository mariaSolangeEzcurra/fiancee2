import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheckIcon, PlayIcon, SquareIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, workerWeekHours } from '../../contexts/AppContext';
import { useNow } from '../../hooks/useNow';
import { ProcessId, TimeLog } from '../../types';
import { fmtLong, TODAY } from '../../utils/dates';
import { currentStep } from '../../utils/dresses';
import { cn, fmtDuration, fmtH, inputClass } from '../../utils/format';
import { processName } from '../../utils/processes';

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function MyDay() {
  const { session, startShift, endShift, startTask, finishTask, dresses, workers, logs, currentWorkerId } = useApp();
  const me = workers.find((w) => w.id === currentWorkerId);
  const now = useNow(1000);
  const active = dresses.filter((d) => d.status !== 'Terminado');
  const mine = active.filter((d) => d.steps.some((s) => s.workerIds.includes(currentWorkerId)));
  const others = active.filter((d) => !mine.includes(d));

  const [dressId, setDressId] = useState(mine[0]?.id ?? '');
  const [process, setProcess] = useState<ProcessId | ''>('');
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState('');
  const [lastLog, setLastLog] = useState<TimeLog | null>(null);

  const dress = dresses.find((d) => d.id === dressId);
  const processOptions = dress ? dress.steps.filter((s) => !s.done && s.process !== 'entrega') : [];
  useEffect(() => {
    if (dress) setProcess(currentStep(dress)?.process === 'entrega' ? processOptions[0]?.process ?? '' : currentStep(dress)?.process ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dressId]);

  const myLogs = logs.filter((l) => l.workerId === currentWorkerId);
  const weekHours = me ? workerWeekHours(me, logs) : 0;
  const dressesWorked = useMemo(() => new Set(myLogs.map((l) => l.dressId)).size, [myLogs]);
  const processesDone = useMemo(() => Array.from(new Set(myLogs.map((l) => processName(l.process)))), [myLogs]);
  const capacity = me ? Object.values(me.areas).reduce<number>((s, h) => s + (h ?? 0), 0) : 0;

  const handleFinish = () => {
    const log = finishTask(note.trim());
    if (log) {
      setLastLog(log);
      toast.success(`${fmtDuration(log.hours)} registrados`, { description: `${log.dressId} · ${processName(log.process)}` });
    }
    setNote('');
    setFinishing(false);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="text-sm capitalize text-cocoa-muted">{fmtLong(TODAY)}</p>
        <h1 className="font-display text-5xl font-semibold text-cocoa">Mi jornada</h1>
        <p className="mt-1 text-base text-cocoa-muted">Hola, {me?.name.split(' ')[0]}.</p>
      </header>

      <section className="rounded-3xl border border-line bg-paper p-6 md:p-10">
        <AnimatePresence mode="wait" initial={false}>
          {!session.shiftStart ?
          <motion.div key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="text-center">
              <p className="tabular font-display text-6xl font-semibold text-cocoa">{hhmm(now)}</p>
              <p className="mt-2 text-sm text-cocoa-muted">Se registrarán la fecha y la hora de entrada automáticamente.</p>
              <button type="button" onClick={startShift} className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-cocoa px-8 py-6 text-xl font-semibold text-ivory transition-colors duration-150 hover:bg-[#3a281f] sm:w-auto">
                <PlayIcon className="h-6 w-6" aria-hidden="true" /> INICIAR JORNADA
              </button>
            </motion.div> :
          session.task ?
          <motion.div key="task" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="text-center">
              <p className="text-sm text-cocoa-muted">Trabajando en</p>
              <p className="mt-1 text-2xl font-semibold text-cocoa">
                {session.task.dressId} · {processName(session.task.process)}
              </p>
              <p className="tabular mt-6 font-display text-7xl font-semibold text-cocoa" aria-live="off">
                {clock(now.getTime() - session.task.start.getTime())}
              </p>
              <p className="mt-1 text-xs text-cocoa-muted">Desde las {hhmm(session.task.start)}</p>
              {!finishing ?
            <button type="button" onClick={() => setFinishing(true)} className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-bad px-8 py-6 text-xl font-semibold text-ivory transition-colors duration-150 hover:bg-[#6f2a2d] sm:w-auto">
                  <SquareIcon className="h-5 w-5 fill-current" aria-hidden="true" /> FINALIZAR
                </button> :

            <div className="mx-auto mt-8 max-w-lg text-left">
                  <label htmlFor="finish-note" className="text-sm font-medium text-cocoa">
                    Observación (opcional)
                  </label>
                  <textarea id="finish-note" rows={3} className={cn(inputClass, 'mt-2 text-base')} placeholder="Ej.: Se terminó el bordado del corsé. Falta aplicación de pedrería." value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="mt-4 flex gap-3">
                    <button type="button" onClick={handleFinish} className="flex-1 rounded-xl bg-cocoa px-5 py-4 text-base font-semibold text-ivory">
                      Guardar registro
                    </button>
                    <button type="button" onClick={() => setFinishing(false)} className="rounded-xl border border-line px-5 py-4 text-base text-cocoa">
                      Seguir trabajando
                    </button>
                  </div>
                </div>
            }
            </motion.div> :

          <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <p className="text-sm text-cocoa-muted">
                Jornada iniciada a las <span className="tabular font-semibold text-cocoa">{hhmm(session.shiftStart)}</span>
              </p>
              {lastLog &&
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
                  <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {fmtDuration(lastLog.hours)} trabajados en {lastLog.dressId} · {processName(lastLog.process)}
                </p>
            }
              <h2 className="mt-6 font-display text-3xl font-semibold text-cocoa">¿En qué estás trabajando?</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-cocoa">
                  Vestido
                  <select className={cn(inputClass, 'py-3.5 text-base')} value={dressId} onChange={(e) => setDressId(e.target.value)}>
                    <option value="">Elige un vestido</option>
                    <optgroup label="Asignados a mí">
                      {mine.map((d) =>
                    <option key={d.id} value={d.id}>
                          {d.code} · {d.client}
                        </option>
                    )}
                    </optgroup>
                    <optgroup label="Otros vestidos">
                      {others.map((d) =>
                    <option key={d.id} value={d.id}>
                          {d.code} · {d.client}
                        </option>
                    )}
                    </optgroup>
                  </select>
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-cocoa">
                  Proceso
                  <select className={cn(inputClass, 'py-3.5 text-base')} value={process} onChange={(e) => setProcess(e.target.value as ProcessId)} disabled={!dress}>
                    <option value="">Elige un proceso</option>
                    {processOptions.map((s) =>
                  <option key={s.process} value={s.process}>
                        {processName(s.process)}
                      </option>
                  )}
                  </select>
                </label>
              </div>
              <button
              type="button"
              disabled={!dressId || !process}
              onClick={() => process && startTask(dressId, process)}
              className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-cocoa px-8 py-6 text-xl font-semibold text-ivory transition-colors duration-150 hover:bg-[#3a281f] disabled:opacity-40">
              
                <PlayIcon className="h-6 w-6" aria-hidden="true" /> INICIAR TRABAJO
              </button>
              <button type="button" onClick={endShift} className="mt-4 w-full text-center text-sm text-cocoa-muted underline-offset-4 hover:text-cocoa hover:underline">
                Finalizar jornada
              </button>
            </motion.div>
          }
        </AnimatePresence>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold text-cocoa">Mi semana</h2>
        <dl className="mt-4 grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-4">
          <div>
            <dt className="text-xs text-cocoa-muted">Mis horas esta semana</dt>
            <dd className="tabular mt-1 text-3xl font-semibold text-cocoa">{fmtH(weekHours)}</dd>
            <dd className="text-xs text-cocoa-faint">de {fmtH(capacity)} disponibles</dd>
          </div>
          <div>
            <dt className="text-xs text-cocoa-muted">Horas registradas</dt>
            <dd className="tabular mt-1 text-3xl font-semibold text-cocoa">{fmtH(weekHours)}</dd>
            <dd className="text-xs text-cocoa-faint">{myLogs.length} registros</dd>
          </div>
          <div>
            <dt className="text-xs text-cocoa-muted">Vestidos trabajados</dt>
            <dd className="tabular mt-1 text-3xl font-semibold text-cocoa">{dressesWorked}</dd>
          </div>
          <div>
            <dt className="text-xs text-cocoa-muted">Procesos realizados</dt>
            <dd className="mt-1 text-base font-medium leading-snug text-cocoa">{processesDone.join(' / ')}</dd>
          </div>
        </dl>
      </section>
    </div>);

}