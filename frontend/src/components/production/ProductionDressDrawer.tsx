import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BellRingIcon,
  CameraIcon,
  CircleCheckIcon,
  ClockIcon,
  HourglassIcon,
  PackageCheckIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ReceiptIcon,
  Trash2Icon,
  TruckIcon,
  UserRoundIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import type { ProductionStore } from '../../hooks/useProduction';
import { fmtClock, fmtDay, liveHours, prodRisk, prodTotals } from '../../services/productionApi';
import type {
  NoteKind,
  PaymentMethod,
  ProdDress,
  ProdPriority,
  ProdSession,
  ProdStep,
} from '../../services/productionApi';
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

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

/** Duración legible a partir de horas de reloj. */
function fmtElapsed(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  const totalMin = Math.max(0, Math.round(hours * 60));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Horas de reloj desde que la jefa inició el proceso (en vivo). */
function elapsedSince(step: ProdStep, now: number): number | null {
  if (!step.startedAt) return null;
  if (!step.inProgress) return step.elapsedHours;
  return (now - new Date(step.startedAt).getTime()) / 3_600_000;
}

export function ProductionDressDrawer({ dressId, onClose, readOnly = false, store }: Props) {
  const {
    dresses,
    workers,
    operations,
    busyId,
    completeStep,
    startStep,
    setCurrentStep,
    addNote,
    toggleStepWorker,
    setStepEstimate,
    setDeadline,
    setPriority,
    addStep,
    removeStep,
    addPayment,
    addCharge,
    removeCharge,
  } = store;

  const live = dresses.find((d) => d.id === dressId);
  const lastRef = useRef<ProdDress | undefined>(live);
  if (live) lastRef.current = live;
  const dress = live ?? lastRef.current;

  // Reloj para el tiempo en curso.
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(
    live && (live.steps[live.currentIndex]?.inProgress || (live.activeSession && !live.activeSession.paused))
  );
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [running]);

  if (!dress) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;

  const busy = busyId === dress.id;
  const totals = prodTotals(dress);
  const risk = prodRisk(dress);
  const step = dress.steps[dress.currentIndex];
  const pool = step && step.area ? workers.filter((w) => (w.areas[step.area] ?? 0) > 0) : [];
  const others = workers.filter((w) => !pool.includes(w));
  const pending = dress.steps.filter((s) => !s.isDelivery && !s.done);

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
        {dress.reminders.length > 0 && (
          <section className="space-y-2">
            {dress.reminders.map((r) => (
              <div
                key={r.type}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 text-sm',
                  r.due ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-line bg-cream/60 text-cocoa'
                )}
              >
                <BellRingIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="mt-0.5 text-xs">{r.message}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        <section>
          <h3 className="font-display text-xl font-semibold text-cocoa">Información general</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Info label="Clienta" value={dress.clientPhone ? `${dress.client} · ${dress.clientPhone}` : dress.client} />
            <Info label="Evento" value={dress.type} />
            <Info label="Contrato" value={`${dress.contract} · ${fmtDate(dress.contractDate)}`} />
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
                    ? 'El vestido ya está hecho en tienda: solo pasa por las modificaciones indicadas.'
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
                <p className="font-display text-2xl font-semibold text-cocoa">
                  {step.name}
                  {step.isExtra && <span className="ml-2 align-middle text-xs font-normal text-gold">agregado</span>}
                </p>
                <StepClock step={step} now={now} />
              </div>
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  {step.status === 'PENDIENTE' && !step.isDelivery && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startStep(dress.id)}
                      className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-cocoa px-4 py-2 text-sm font-medium text-ivory hover:bg-[#3a281f] disabled:opacity-50"
                    >
                      <PlayIcon className="h-4 w-4" aria-hidden="true" /> Iniciar proceso
                    </button>
                  )}
                  {(step.status === 'EN_CURSO' || step.isDelivery) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void completeStep(dress.id)}
                      className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-cocoa px-4 py-2 text-sm font-medium text-ivory hover:bg-[#3a281f] disabled:opacity-50"
                    >
                      {step.isDelivery ? <TruckIcon className="h-4 w-4" aria-hidden="true" /> : <CircleCheckIcon className="h-4 w-4" aria-hidden="true" />}
                      {step.isDelivery ? 'Registrar entrega' : 'Marcar proceso terminado'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {step.status === 'PENDIENTE' && !step.isDelivery && (
              <p className="mt-3 rounded-lg bg-cream/70 px-3 py-2 text-xs text-cocoa-muted">
                El tiempo empieza a contar cuando la jefa de taller inicia el proceso. Las trabajadoras solo
                pueden registrar trabajo en procesos iniciados.
              </p>
            )}

            {!step.isDelivery && <ActiveSessionCard session={dress.activeSession} now={now} />}

            {!step.isDelivery && step.timeType === 'TRABAJO' && step.status !== 'PENDIENTE' && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-cocoa-muted">
                  <span className="tabular">{fmtNum(step.workedHours)} de {fmtNum(step.estHours)} h registradas por las trabajadoras</span>
                  {step.workedHours > step.estHours && (
                    <span className="font-medium text-risk">+{fmtH(step.workedHours - step.estHours)} sobre lo estimado</span>
                  )}
                </div>
                <Meter
                  className="mt-1.5"
                  value={step.estHours > 0 ? step.workedHours / step.estHours : 0}
                  tone={step.workedHours > step.estHours ? 'risk' : 'neutral'}
                  label="Avance del proceso"
                />
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
              <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
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
                        {i + 1}. {s.name}{s.done ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </label>
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
                void setCurrentStep(dress.id, Math.max(last - 1, 0)).then(
                  (ok) => ok && toast.message('Se reabrió el vestido para corregir.')
                );
              }}
              className="rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium hover:bg-green-100"
            >
              Reabrir
            </button>
          </section>
        )}

        <StepsEditor
          dress={dress}
          now={now}
          readOnly={readOnly}
          busy={busy}
          operations={operations}
          onHours={(i, h) => setStepEstimate(dress.id, i, h)}
          onRemove={(i) => removeStep(dress.id, i)}
          onAdd={(data) => addStep(dress.id, data)}
        />

        <MoneySection
          dress={dress}
          readOnly={readOnly}
          busy={busy}
          onPayment={(data) => addPayment(dress.id, data)}
          onCharge={(data) => addCharge(dress.id, data)}
          onRemoveCharge={(id) => removeCharge(dress.id, id)}
        />

        <WorkLog dress={dress} now={now} />

        <NotesSection
          dress={dress}
          readOnly={readOnly}
          busy={busy}
          onAdd={(text, kind, options) => addNote(dress.id, text, kind, options)}
        />
      </div>
    </Drawer>
  );
}

// ============================================================
// RELOJ DEL PROCESO
// ============================================================

function StepClock({ step, now }: { step: ProdStep; now: number }) {
  if (step.isDelivery) return null;
  if (step.status === 'PENDIENTE') {
    return <p className="mt-1 text-xs text-cocoa-muted">Aún no iniciado · estimado {fmtH(step.estHours)}</p>;
  }
  const elapsed = elapsedSince(step, now);
  return (
    <p className="tabular mt-1 inline-flex items-center gap-1.5 text-xs text-cocoa-muted">
      <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Iniciado el {fmtDay(step.startedAt)} a las {fmtClock(step.startedAt)}
      {step.startedBy ? ` por ${step.startedBy}` : ''} · lleva <span className="font-semibold text-cocoa">{fmtElapsed(elapsed)}</span>
    </p>
  );
}

// ============================================================
// PROCESOS DEL VESTIDO (horas, procesos extra, duración real)
// ============================================================

function StepsEditor({
  dress,
  now,
  readOnly,
  busy,
  operations,
  onHours,
  onRemove,
  onAdd,
}: {
  dress: ProdDress;
  now: number;
  readOnly: boolean;
  busy: boolean;
  operations: { id: number; name: string; area: string }[];
  onHours: (index: number, hours: number) => Promise<boolean>;
  onRemove: (index: number) => Promise<boolean>;
  onAdd: (data: { operationId: number; hours: number; after?: number; name?: string }) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);
  const [operationId, setOperationId] = useState('');
  const [hours, setHours] = useState('2');
  const [name, setName] = useState('');
  const delivery = dress.steps.length - 1;
  const [after, setAfter] = useState<number>(dress.currentIndex);

  useEffect(() => {
    setDrafts({});
    setAfter(dress.currentIndex);
  }, [dress.id, dress.currentIndex, dress.steps.length]);

  const firstAllowed = dress.steps[dress.currentIndex]?.status === 'PENDIENTE' ? dress.currentIndex - 1 : dress.currentIndex;

  const submit = async () => {
    if (!operationId) {
      toast.error('Elige el tipo de proceso.');
      return;
    }
    const ok = await onAdd({
      operationId: Number(operationId),
      hours: Number(hours) || 0,
      after,
      name: name.trim() || undefined,
    });
    if (ok) {
      setAdding(false);
      setName('');
      setOperationId('');
    }
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-semibold text-cocoa">Procesos del vestido</h3>
        {!readOnly && dress.status !== 'Terminado' && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold-soft px-3 py-1.5 text-xs font-semibold text-cocoa hover:bg-champagne-soft"
          >
            <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" /> Agregar proceso
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-cocoa-muted">
        Ajusta las horas si un proceso se pasa del tiempo o agrega pruebas extra cuando la novia las pide. La capacidad del
        taller se recalcula sola.
      </p>

      {adding && (
        <div className="mt-3 grid gap-3 rounded-xl border border-gold-soft bg-champagne-soft/40 p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
            Proceso
            <select className={inputClass} value={operationId} onChange={(e) => setOperationId(e.target.value)}>
              <option value="">Elegir…</option>
              {operations
                .filter((o) => o.name.toLowerCase() !== 'compra materiales')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
            Nombre (opcional)
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Prueba extra pedida por la novia" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
            Horas estimadas
            <input type="number" min={0} step={0.5} className={cn(inputClass, 'tabular')} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
            Ubicar después de
            <select className={inputClass} value={after} onChange={(e) => setAfter(Number(e.target.value))}>
              {dress.steps.map((s, i) =>
                i >= Math.max(firstAllowed, 0) && i < delivery ? (
                  <option key={s.id} value={i}>
                    {i + 1}. {s.name}
                  </option>
                ) : null
              )}
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="rounded-lg bg-cocoa px-4 py-2 text-xs font-medium text-ivory disabled:opacity-50"
            >
              Agregar a la cola
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-line px-4 py-2 text-xs font-medium text-cocoa">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="bg-cream/60 text-cocoa-muted">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Proceso</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Estimado</th>
              <th className="px-3 py-2 text-right font-medium">Trabajado</th>
              <th className="px-3 py-2 text-right font-medium">Tiempo real</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {dress.steps.map((s, i) => {
              const editable = !readOnly && !s.done && !s.isDelivery && s.timeType === 'TRABAJO';
              const draft = drafts[i] ?? String(s.estHours);
              const changed = Number(draft) !== s.estHours;
              const current = i === dress.currentIndex && dress.status !== 'Terminado';
              return (
                <tr key={s.id} className={cn(current && 'bg-champagne-soft/40')}>
                  <td className="tabular px-3 py-2 text-cocoa-muted">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-cocoa">
                    {s.name}
                    {s.isExtra && <span className="ml-1.5 rounded-full bg-champagne-soft px-1.5 py-0.5 text-[10px] font-medium text-cocoa">extra</span>}
                    {s.timeType === 'ESPERA' && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-cocoa-muted">
                        <HourglassIcon className="h-2.5 w-2.5" /> espera
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        s.done && 'bg-green-50 text-green-800',
                        s.inProgress && 'bg-amber-50 text-amber-900',
                        s.status === 'PENDIENTE' && 'bg-cream text-cocoa-muted'
                      )}
                    >
                      {s.done ? 'Terminado' : s.inProgress ? 'En curso' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.isDelivery ? (
                      '—'
                    ) : editable ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          aria-label={`Horas de ${s.name}`}
                          className={cn(inputClass, 'w-20 py-1 text-right text-xs tabular')}
                          value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                        />
                        {changed && (
                          <button
                            type="button"
                            disabled={busy || draft === ''}
                            onClick={() => void onHours(i, Number(draft) || 0)}
                            className="rounded-md bg-cocoa px-2 py-1 text-[11px] font-medium text-ivory disabled:opacity-50"
                          >
                            OK
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="tabular">{fmtNum(s.estHours)} h</span>
                    )}
                  </td>
                  <td className={cn('tabular px-3 py-2 text-right', s.workedHours > s.estHours && s.estHours > 0 ? 'font-semibold text-risk' : 'text-cocoa')}>
                    {s.timeType === 'TRABAJO' && !s.isDelivery ? `${fmtNum(s.workedHours)} h` : '—'}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-cocoa">
                    {s.startedAt ? fmtElapsed(elapsedSince(s, now)) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {!readOnly && s.isExtra && s.status === 'PENDIENTE' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onRemove(i)}
                        className="rounded-md p-1 text-cocoa-muted hover:bg-red-50 hover:text-red-700"
                        aria-label={`Quitar ${s.name}`}
                        title="Quitar proceso"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-cocoa-faint">
        "Tiempo real" es el tiempo desde que la jefa inició el proceso hasta que lo marcó como terminado. "Trabajado" son las
        horas que registraron las trabajadoras.
      </p>
    </section>
  );
}

// ============================================================
// DINERO: pagos recibidos y cobros extra
// ============================================================

function MoneySection({
  dress,
  readOnly,
  busy,
  onPayment,
  onCharge,
  onRemoveCharge,
}: {
  dress: ProdDress;
  readOnly: boolean;
  busy: boolean;
  onPayment: (data: { amount: number; method?: PaymentMethod; reference?: string }) => Promise<boolean>;
  onCharge: (data: { concept: string; amount: number; description?: string }) => Promise<boolean>;
  onRemoveCharge: (id: number) => Promise<boolean>;
}) {
  const f = dress.finance;
  const [mode, setMode] = useState<'none' | 'pago' | 'cobro'>('none');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO');
  const [reference, setReference] = useState('');
  const [concept, setConcept] = useState('');

  const reset = () => {
    setMode('none');
    setAmount('');
    setReference('');
    setConcept('');
  };

  const submit = async () => {
    const value = Number(amount);
    if (!(value > 0)) {
      toast.error('Ingresa un monto mayor que cero.');
      return;
    }
    if (mode === 'cobro' && !concept.trim()) {
      toast.error('Indica qué modificación se cobra.');
      return;
    }
    const ok =
      mode === 'pago'
        ? await onPayment({ amount: value, method, reference: reference.trim() })
        : await onCharge({ concept: concept.trim(), amount: value });
    if (ok) reset();
  };

  return (
    <section>
      <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-cocoa">
        <WalletIcon className="h-5 w-5 text-gold" aria-hidden="true" /> Pagos y cobros
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-cocoa-muted">Este vestido</p>
          <Money label="Precio en el contrato" value={f.dressPrice} />
          <Money label="Cobros extra" value={f.dressExtras} />
          <Money label="Total del vestido" value={f.dressTotal} strong />
        </div>
        <div className="rounded-xl border border-line bg-paper p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-cocoa-muted">Contrato {dress.contract}</p>
          <Money label="Total (con cobros extra)" value={f.contractTotal} />
          <Money label="Pagado" value={f.contractPaid} />
          <Money label="Saldo pendiente" value={f.contractBalance} strong tone={f.contractBalance > 0 ? 'risk' : 'ok'} />
        </div>
      </div>

      {!readOnly && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === 'pago' ? 'none' : 'pago')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold', mode === 'pago' ? 'border-cocoa bg-cocoa text-ivory' : 'border-line text-cocoa hover:bg-cream')}
          >
            <WalletIcon className="h-3.5 w-3.5" /> Registrar dinero recibido
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'cobro' ? 'none' : 'cobro')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold', mode === 'cobro' ? 'border-cocoa bg-cocoa text-ivory' : 'border-line text-cocoa hover:bg-cream')}
          >
            <ReceiptIcon className="h-3.5 w-3.5" /> Agregar cobro extra
          </button>
        </div>
      )}

      {mode !== 'none' && (
        <div className="mt-3 grid gap-3 rounded-xl border border-gold-soft bg-champagne-soft/40 p-4 sm:grid-cols-3">
          {mode === 'cobro' && (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted sm:col-span-2">
              Modificación que se cobra
              <input className={inputClass} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Cambio de escote, más pedrería…" />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
            Monto (S/)
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'tabular')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {mode === 'pago' && (
            <>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                Método
                <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="TARJETA">Tarjeta</option>
                  <option value="OTRO">Otro</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                N.º de operación
                <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </>
          )}
          <div className="flex gap-2 sm:col-span-3">
            <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg bg-cocoa px-4 py-2 text-xs font-medium text-ivory disabled:opacity-50">
              {mode === 'pago' ? 'Registrar pago' : 'Agregar cobro (sube el costo del vestido)'}
            </button>
            <button type="button" onClick={reset} className="rounded-lg border border-line px-4 py-2 text-xs font-medium text-cocoa">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {f.charges.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-cocoa-muted">Cobros extra por modificaciones</p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {f.charges.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-cocoa">{c.concept}</p>
                  <p className="text-[11px] text-cocoa-muted">
                    {fmtDay(c.date)}{c.by ? ` · ${c.by}` : ''}{c.noteId ? ' · con foto/observación' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular font-semibold text-cocoa">+{money.format(c.amount)}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`¿Quitar el cobro "${c.concept}"?`)) void onRemoveCharge(c.id);
                      }}
                      className="rounded-md p-1 text-cocoa-muted hover:bg-red-50 hover:text-red-700"
                      aria-label="Quitar cobro"
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {f.payments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-cocoa-muted">Pagos del contrato</p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {f.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-cocoa">{p.concept || 'Pago'}</p>
                  <p className="text-[11px] text-cocoa-muted">
                    {fmtDay(p.date)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}
                  </p>
                </div>
                <span className="tabular font-semibold text-green-800">{money.format(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Money({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: 'ok' | 'risk' }) {
  return (
    <div className="mt-1.5 flex items-baseline justify-between gap-3">
      <span className="text-cocoa-muted">{label}</span>
      <span
        className={cn(
          'tabular',
          strong ? 'font-semibold' : '',
          tone === 'risk' ? 'text-amber-800' : tone === 'ok' ? 'text-green-800' : 'text-cocoa'
        )}
      >
        {money.format(value)}
      </span>
    </div>
  );
}

// ============================================================
// OBSERVACIONES CON FOTOS
// ============================================================

function NotesSection({
  dress,
  readOnly,
  busy,
  onAdd,
}: {
  dress: ProdDress;
  readOnly: boolean;
  busy: boolean;
  onAdd: (
    text: string,
    kind: NoteKind,
    options: { images?: File[]; extraAmount?: number | null; extraConcept?: string }
  ) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<NoteKind>('observacion');
  const [files, setFiles] = useState<File[]>([]);
  const [extra, setExtra] = useState('');
  const [extraConcept, setExtraConcept] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const submit = async () => {
    if (!note.trim() && files.length === 0) return;
    const ok = await onAdd(note.trim(), kind, {
      images: files,
      extraAmount: Number(extra) > 0 ? Number(extra) : null,
      extraConcept: extraConcept.trim(),
    });
    if (ok) {
      setNote('');
      setFiles([]);
      setExtra('');
      setExtraConcept('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <section>
      <h3 className="font-display text-xl font-semibold text-cocoa">Observaciones, cambios y fotos</h3>
      <p className="mt-1 text-xs text-cocoa-muted">Todo lo que se registre aquí lo ven la jefa, gerencia y las trabajadoras del taller.</p>

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

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-cocoa hover:bg-cream">
              <CameraIcon className="h-3.5 w-3.5" /> Agregar fotos
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setFiles((current) => [...current, ...Array.from(e.target.files ?? [])].slice(0, 10))}
              />
            </label>
            {previews.map((p, i) => (
              <span key={p.url} className="relative">
                <img src={p.url} alt={p.name} className="h-14 w-14 rounded-lg border border-line object-cover" />
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-cocoa p-0.5 text-ivory"
                  aria-label={`Quitar ${p.name}`}
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="grid gap-2 rounded-lg border border-dashed border-nude p-3 sm:grid-cols-3">
            <p className="text-xs text-cocoa-muted sm:col-span-3">¿La modificación tiene costo adicional? Se sumará al costo del vestido.</p>
            <input
              className={cn(inputClass, 'text-xs sm:col-span-2')}
              placeholder="Concepto (opcional)"
              value={extraConcept}
              onChange={(e) => setExtraConcept(e.target.value)}
            />
            <input
              type="number"
              min={0}
              step={0.01}
              className={cn(inputClass, 'text-xs tabular')}
              placeholder="S/ 0.00"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={(!note.trim() && files.length === 0) || busy}
            className="rounded-lg bg-cocoa px-4 py-2 text-xs font-medium text-ivory disabled:opacity-40"
          >
            Guardar {kind === 'incidencia' ? 'incidencia' : 'observación'}
            {files.length > 0 ? ` con ${files.length} foto(s)` : ''}
            {Number(extra) > 0 ? ` y cobro de ${money.format(Number(extra))}` : ''}
          </button>
        </div>
      )}

      <ul className="mt-4 divide-y divide-line">
        {dress.notes.length === 0 && <li className="py-3 text-sm text-cocoa-faint">Sin observaciones registradas.</li>}
        {dress.notes.map((n) => (
          <li key={n.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cocoa-muted">
              <span className={cn('rounded-full px-1.5 py-0.5 font-medium', n.kind === 'incidencia' ? 'bg-bad-soft text-bad' : 'bg-cream text-cocoa-muted')}>
                {n.kind === 'incidencia' ? 'Incidencia' : 'Observación'}
              </span>
              <span>{n.author}</span>
              <span className="tabular">· {fmtDate(n.date)}</span>
              {n.extraCharge && (
                <span className="rounded-full bg-champagne-soft px-1.5 py-0.5 font-semibold text-cocoa">
                  Cobro extra +{money.format(n.extraCharge.amount)}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-cocoa">{n.text}</p>
            {n.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {n.images.map((img) => (
                  <a key={img.id} href={img.url} target="_blank" rel="noreferrer" title="Ver foto">
                    <img src={img.url} alt="Foto del vestido" className="h-20 w-20 rounded-lg border border-line object-cover hover:opacity-90" />
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================
// QUIÉN TRABAJA AHORA Y REGISTRO DE TRABAJO
// ============================================================

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
          <span className="text-xs font-normal text-cocoa-muted">
            · {session.paused ? 'en pausa' : 'trabajando ahora'} en {session.process.toLowerCase()}
          </span>
        </p>
        <p className="tabular text-sm font-semibold text-cocoa">{fmtNum(liveHours(session, now))} h</p>
      </div>
      <p className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-cocoa-muted">
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="h-3 w-3" aria-hidden="true" /> Desde {fmtClock(session.start)}
        </span>
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

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-cocoa-muted">{label}</dt>
      <dd className="tabular truncate font-medium text-cocoa">{value}</dd>
    </div>
  );
}
