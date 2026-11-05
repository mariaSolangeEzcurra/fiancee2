import { useEffect, useRef, useState } from 'react';
import { CircleCheckIcon, ClockIcon, PackageCheckIcon, PauseIcon, PlayIcon, TruckIcon, UserRoundIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { ProductionStore } from '../../hooks/useProduction';
import { fmtClock, fmtDay, liveHours, prodRisk, prodTotals } from '../../services/productionApi';
import type { NoteKind, ProdDress, ProdPriority, ProdSession } from '../../services/productionApi';
import { fmtDate } from '../../utils/dates';
import { cn, fmtH, fmtNum, inputClass } from '../../utils/format';
import { Drawer } from '../ui/Drawer';
import { Meter } from '../ui/Meter';
import { Segmented } from '../ui/Segmented';
import { StatusPill } from '../ui/StatusPill';
import { ProductionLine } from './ProductionLine';

interface Props {
  dressId: string | null;
  onClose: () => void;
  readOnly?: boolean;
  store: ProductionStore;
}

export function ProductionDressDrawer({ dressId, onClose, readOnly = false, store }: Props) {
  const { dresses, workers, busyId, completeStep, setCurrentStep, addNote, toggleStepWorker, setStepEstimate, setDeadline, setPriority } = store;

  const live = dresses.find((d) => d.id === dressId);
  const lastRef = useRef<ProdDress | undefined>(live);
  if (live) lastRef.current = live;
  const dress = live ?? lastRef.current;

  const [note, setNote] = useState('');
  const [kind, setKind] = useState<NoteKind>('observacion');
  const [estDraft, setEstDraft] = useState('');

  // Reloj para las horas de la sesión en curso.
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(live?.activeSession && !live.activeSession.paused);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [running]);

  const step = dress ? dress.steps[dress.currentIndex] : undefined;
  useEffect(() => {
    setEstDraft(step ? String(step.estHours) : '');
  }, [dress?.id, dress?.currentIndex, step?.estHours]);

  if (!dress) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;

  const busy = busyId === dress.id;
  const totals = prodTotals(dress);
  const risk = prodRisk(dress);
  const pool = step && step.area ? workers.filter((w) => (w.areas[step.area] ?? 0) > 0) : [];
  const others = workers.filter((w) => !pool.includes(w));
  const pending = dress.steps.filter((s) => !s.isDelivery && !s.done);

  const submitNote = async () => {
    if (!note.trim()) return;
    if (await addNote(dress.id, note.trim(), kind)) setNote('');
  };

  return (
    <Drawer
      open={!!live}
      onClose={onClose}
      title={dress.code}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{dress.client}</span>
          <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
          <StatusPill tone="neutral">{dress.status}</StatusPill>
          <StatusPill tone={dress.priority === 'Alta' ? 'risk' : 'neutral'}>Prioridad {dress.priority.toLowerCase()}</StatusPill>
        </span>
      }
    >
      <div className="space-y-8">
        <section>
          <h3 className="font-display text-xl font-semibold text-cocoa">Información general</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Info label="Clienta" value={dress.clientPhone ? `${dress.client} · ${dress.clientPhone}` : dress.client} />
            <Info label="Evento" value={dress.type} />
            <Info label="Contrato" value={dress.contract} />
            <Info label="Vestido" value={dress.dressType} />
            <Info label="Fecha del evento" value={dress.eventDate ? fmtDate(dress.eventDate) : '—'} />
            <Info label="Fecha límite" value={fmtDate(dress.deadline)} />
            <Info label="Taller" value={dress.workshop} />
            <Info label="Fin estimado" value={dress.estimatedEnd ? fmtDate(dress.estimatedEnd) : '—'} />
          </dl>
          {dress.description && dress.description !== dress.dressType && (
            <p className="mt-3 text-sm text-cocoa-muted">{dress.description}</p>
          )}
        </section>

        {dress.workshopCode !== 'A' && (
          <section className="rounded-xl border border-gold-soft/60 bg-champagne-soft p-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-cocoa">
                  <PackageCheckIcon className="h-4 w-4 text-gold" aria-hidden="true" />
                  {dress.workshopCode === 'T' ? 'Vestido en tienda' : 'Vestido de Taller C'}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-cocoa-muted">
                  {dress.workshopCode === 'T'
                    ? 'El vestido ya está hecho en tienda: solo pasa por las modificaciones indicadas en el contrato.'
                    : 'Se compra al proveedor (tiempo de espera) y luego el taller completa entalle, pruebas, bordado y acabados.'}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-cocoa">Pendiente en taller</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {pending.map((s) => (
                    <li key={s.id} className="flex justify-between gap-3">
                      <span className="text-cocoa">{s.name}{s.timeType === 'ESPERA' && ' (espera)'}</span>
                      <span className="tabular text-cocoa">{fmtH(s.estHours)}</span>
                    </li>
                  ))}
                  {pending.length === 0 && <li className="text-cocoa-muted">Nada pendiente.</li>}
                </ul>
                <p className="mt-2 flex justify-between border-t border-gold-soft/60 pt-2 text-sm font-semibold text-cocoa">
                  <span>Horas de trabajo pendientes</span>
                  <span className="tabular">{fmtH(totals.remaining)}</span>
                </p>
              </div>
            </div>
          </section>
        )}

        <section>
          <h3 className="font-display text-xl font-semibold text-cocoa">Línea de producción</h3>
          <div className="mt-4">
            <ProductionLine dress={dress} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4 text-sm">
            <Info label="Horas estimadas" value={fmtH(totals.est)} />
            <Info label="Horas trabajadas" value={fmtH(totals.worked)} />
            <Info label="Horas restantes" value={fmtH(totals.remaining)} />
          </div>
        </section>

        {step && dress.status !== 'Terminado' && (
          <section className="rounded-xl border border-line bg-paper p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-cocoa-muted">Proceso actual</p>
                <p className="font-display text-2xl font-semibold text-cocoa">{step.name}</p>
                <p className="mt-1 text-[11px] text-cocoa-faint">
                  Las trabajadoras registran sus sesiones; solo la jefa de taller da el proceso por terminado.
                </p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void completeStep(dress.id)}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-cocoa px-4 py-2 text-sm font-medium text-ivory transition-colors duration-150 hover:bg-[#3a281f] disabled:opacity-50"
                >
                  {step.isDelivery ? <TruckIcon className="h-4 w-4" aria-hidden="true" /> : <CircleCheckIcon className="h-4 w-4" aria-hidden="true" />}
                  {step.isDelivery ? 'Registrar entrega' : 'Marcar proceso terminado'}
                </button>
              )}
            </div>

            <ActiveSessionCard session={dress.activeSession} now={now} />

            {!step.isDelivery && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-cocoa-muted">
                  <span className="tabular">
                    {step.timeType === 'ESPERA'
                      ? `Espera del proveedor: ${fmtNum(step.estHours)} h`
                      : `${fmtNum(step.workedHours)} de ${fmtNum(step.estHours)} h registradas`}
                  </span>
                  {step.workedHours > step.estHours && step.timeType === 'TRABAJO' && (
                    <span className="font-medium text-risk">+{fmtH(step.workedHours - step.estHours)} sobre lo estimado</span>
                  )}
                </div>
                {step.timeType === 'TRABAJO' && (
                  <Meter
                    className="mt-1.5"
                    value={step.estHours > 0 ? step.workedHours / step.estHours : 0}
                    tone={step.workedHours > step.estHours ? 'risk' : 'neutral'}
                    label="Avance del proceso"
                  />
                )}
              </div>
            )}

            {!step.isDelivery && step.timeType === 'TRABAJO' && (
              <div className="mt-5">
                <p className="text-xs font-medium text-cocoa-muted">Trabajadoras asignadas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(readOnly ? workers.filter((w) => step.workerIds.includes(w.id)) : [...pool, ...others.filter((w) => step.workerIds.includes(w.id))]).map((w) => {
                    const on = step.workerIds.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        disabled={readOnly || busy}
                        aria-pressed={on}
                        onClick={() => void toggleStepWorker(dress.id, dress.currentIndex, w.id)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150',
                          on ? 'border-cocoa bg-cocoa text-ivory' : 'border-line text-cocoa-muted hover:border-nude hover:text-cocoa'
                        )}
                      >
                        {w.name}
                      </button>
                    );
                  })}
                  {readOnly && step.workerIds.length === 0 && <span className="text-xs text-cocoa-faint">Sin asignar</span>}
                  {!readOnly && pool.length === 0 && <span className="text-xs text-cocoa-faint">No hay trabajadoras de esta área.</span>}
                </div>
                {step.sessions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-cocoa-muted">Quién trabajó en este proceso</p>
                    <ul className="mt-2 space-y-1">
                      {step.sessions.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream/60 px-3 py-1.5 text-xs">
                          <span className="font-medium text-cocoa">{x.worker}</span>
                          <span className="tabular text-cocoa-muted">
                            {fmtDay(x.start)} · {fmtClock(x.start)}–{x.end ? fmtClock(x.end) : 'ahora'}
                          </span>
                          <span className="tabular font-semibold text-cocoa">{fmtNum(liveHours(x, now))} h</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!readOnly && others.length > 0 && (
                  <select
                    aria-label="Reasignar a otra trabajadora"
                    className={cn(inputClass, 'mt-2 max-w-xs text-xs')}
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && void toggleStepWorker(dress.id, dress.currentIndex, e.target.value)}
                  >
                    <option value="">Reasignar a otra área…</option>
                    {others.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} · {w.role}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {!readOnly && (
              <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                  Cambiar proceso
                  <select
                    className={inputClass}
                    value={dress.currentIndex}
                    disabled={busy}
                    onChange={(e) => void setCurrentStep(dress.id, Number(e.target.value))}
                  >
                    {dress.steps.map((s, i) => (
                      <option key={s.id} value={i}>
                        {s.name}{s.done ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {!step.isDelivery && (
                  <div className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                    <label htmlFor="est-hours">Horas estimadas del proceso</label>
                    <div className="flex gap-2">
                      <input
                        id="est-hours"
                        type="number"
                        min={0}
                        step={0.5}
                        className={cn(inputClass, 'tabular')}
                        value={estDraft}
                        onChange={(e) => setEstDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={busy || estDraft === '' || Number(estDraft) === step.estHours}
                        onClick={() => void setStepEstimate(dress.id, dress.currentIndex, Number(estDraft) || 0)}
                        className="rounded-lg border border-line px-3 text-xs font-medium text-cocoa hover:bg-cream disabled:opacity-40"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                )}
                <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                  Fecha límite
                  <input
                    type="date"
                    className={cn(inputClass, 'tabular')}
                    value={dress.deadline}
                    disabled={busy}
                    onChange={(e) => e.target.value && void setDeadline(dress.id, e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                  Prioridad
                  <select
                    className={inputClass}
                    value={dress.priority}
                    disabled={busy}
                    onChange={(e) => void setPriority(dress.id, e.target.value as ProdPriority)}
                  >
                    <option value="Alta">Alta</option>
                    <option value="Media">Media</option>
                    <option value="Baja">Baja</option>
                  </select>
                </label>
              </div>
            )}
          </section>
        )}

        {dress.status === 'Terminado' && !readOnly && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            <span>Vestido terminado y entregado.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const last = dress.steps.length - 1;
                void setCurrentStep(dress.id, Math.max(last - 1, 0)).then((ok) => ok && toast.message('Se reabrió el vestido para corregir.'));
              }}
              className="rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium hover:bg-green-100"
            >
              Reabrir
            </button>
          </section>
        )}

        <WorkLog dress={dress} now={now} />

        <section>
          <h3 className="font-display text-xl font-semibold text-cocoa">Observaciones e incidencias</h3>
          {!readOnly && (
            <div className="mt-3 space-y-2">
              <div className="w-64">
                <Segmented<NoteKind>
                  ariaLabel="Tipo de registro"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'observacion', label: 'Observación' },
                    { value: 'incidencia', label: 'Incidencia' },
                  ]}
                />
              </div>
              <textarea
                aria-label="Texto de la observación"
                rows={2}
                className={inputClass}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={kind === 'incidencia' ? 'Ej.: falta tela de forro; proveedor confirma el lunes.' : 'Ej.: la clienta pidió bajar el escote 1 cm.'}
              />
              <button
                type="button"
                onClick={() => void submitNote()}
                disabled={!note.trim() || busy}
                className="rounded-lg bg-cocoa px-4 py-2 text-xs font-medium text-ivory disabled:opacity-40"
              >
                Agregar {kind === 'incidencia' ? 'incidencia' : 'observación'}
              </button>
            </div>
          )}
          <ul className="mt-4 divide-y divide-line">
            {dress.notes.length === 0 && <li className="py-3 text-sm text-cocoa-faint">Sin observaciones registradas.</li>}
            {dress.notes.map((n) => (
              <li key={n.id} className="py-3">
                <div className="flex items-center gap-2 text-[11px] text-cocoa-muted">
                  <span className={cn('rounded-full px-1.5 py-0.5 font-medium', n.kind === 'incidencia' ? 'bg-bad-soft text-bad' : 'bg-cream text-cocoa-muted')}>
                    {n.kind === 'incidencia' ? 'Incidencia' : 'Observación'}
                  </span>
                  <span>{n.author}</span>
                  <span className="tabular">· {fmtDate(n.date)}</span>
                </div>
                <p className="mt-1 text-sm text-cocoa">{n.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}

function ActiveSessionCard({ session, now }: { session: ProdSession | null; now: number }) {
  if (!session) {
    return (
      <p className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-nude px-3 py-2 text-xs text-cocoa-muted">
        <UserRoundIcon className="h-3.5 w-3.5" aria-hidden="true" />
        Nadie está trabajando este vestido en este momento.
      </p>
    );
  }
  return (
    <div className={cn('mt-4 rounded-lg border px-4 py-3', session.paused ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-cocoa">
          {session.paused ? <PauseIcon className="h-4 w-4" aria-hidden="true" /> : <PlayIcon className="h-4 w-4" aria-hidden="true" />}
          {session.worker}
          <span className="text-xs font-normal text-cocoa-muted">· {session.paused ? 'en pausa' : 'trabajando ahora'} en {session.process.toLowerCase()}</span>
        </p>
        <p className="tabular text-sm font-semibold text-cocoa">{fmtNum(liveHours(session, now))} h</p>
      </div>
      <p className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-cocoa-muted">
        <span className="inline-flex items-center gap-1"><ClockIcon className="h-3 w-3" aria-hidden="true" /> Desde {fmtClock(session.start)}</span>
        {session.shift?.checkIn && <span>Entrada de su jornada: {fmtClock(session.shift.checkIn)}</span>}
        {session.pauses > 0 && <span>{session.pauses} pausa(s) · {session.pauseMinutes} min</span>}
      </p>
    </div>
  );
}

function WorkLog({ dress, now }: { dress: ProdDress; now: number }) {
  return (
    <section>
      <h3 className="font-display text-xl font-semibold text-cocoa">Registro de trabajo</h3>
      <p className="mt-1 text-xs text-cocoa-muted">Sesiones que cada trabajadora registró sobre este vestido durante su jornada.</p>

      {dress.workersSummary.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {dress.workersSummary.map((w) => (
            <span key={w.workerId} className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-cocoa">
              <span className="font-semibold">{w.worker}</span>
              <span className="tabular text-cocoa-muted"> · {fmtNum(w.hours)} h · {w.processes.join(', ').toLowerCase()}</span>
            </span>
          ))}
        </div>
      )}

      {dress.workLog.length === 0 ? (
        <p className="mt-3 text-sm text-cocoa-faint">Todavía nadie registró trabajo en este vestido.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-cream/60 text-cocoa-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Trabajadora</th>
                <th className="px-3 py-2 font-medium">Proceso</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Jornada</th>
                <th className="px-3 py-2 font-medium">Sesión</th>
                <th className="px-3 py-2 text-right font-medium">Horas</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dress.workLog.map((x) => (
                <tr key={x.id} className="align-top">
                  <td className="px-3 py-2 font-medium text-cocoa">{x.worker}</td>
                  <td className="px-3 py-2 text-cocoa">
                    {x.process}
                    {x.notes && <p className="mt-0.5 max-w-[14rem] whitespace-pre-line text-[11px] text-cocoa-muted">{x.notes}</p>}
                  </td>
                  <td className="tabular px-3 py-2 text-cocoa-muted">{fmtDay(x.shift?.date ?? x.start)}</td>
                  <td className="tabular px-3 py-2 text-cocoa-muted">
                    {x.shift ? `${fmtClock(x.shift.checkIn)}–${x.shift.checkOut ? fmtClock(x.shift.checkOut) : 'en curso'}` : '—'}
                  </td>
                  <td className="tabular px-3 py-2 text-cocoa-muted">
                    {fmtClock(x.start)}–{x.end ? fmtClock(x.end) : 'ahora'}
                    {x.pauses > 0 && <span className="block text-[11px]">{x.pauses} pausa(s) · {x.pauseMinutes} min</span>}
                  </td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-cocoa">{fmtNum(liveHours(x, now))}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        x.status === 'Trabajando' && 'bg-green-50 text-green-800',
                        x.status === 'En pausa' && 'bg-amber-50 text-amber-900',
                        x.status === 'Finalizada' && 'bg-cream text-cocoa-muted'
                      )}
                    >
                      {x.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-cocoa-muted">{label}</dt>
      <dd className="tabular truncate font-medium text-cocoa">{value}</dd>
    </div>
  );
}
