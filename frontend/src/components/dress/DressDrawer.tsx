import React, { useEffect, useRef, useState } from 'react';
import { CircleCheckIcon, PackageCheckIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../contexts/AppContext';
import { Dress, NoteKind } from '../../types';
import { TODAY, fmtDate } from '../../utils/dates';
import { currentStep, dressRisk, dressTotals } from '../../utils/dresses';
import { cn, fmtH, fmtNum, inputClass } from '../../utils/format';
import { areaOf, processName } from '../../utils/processes';
import { Drawer } from '../ui/Drawer';
import { Meter } from '../ui/Meter';
import { Segmented } from '../ui/Segmented';
import { StatusPill } from '../ui/StatusPill';
import { ProductionLine } from './ProductionLine';

interface DressDrawerProps {
  dressId: string | null;
  onClose: () => void;
  readOnly?: boolean;
}

export function DressDrawer({ dressId, onClose, readOnly = false }: DressDrawerProps) {
  const { dresses, workers, templates, completeStep, setCurrentStep, addNote, toggleStepWorker, setStepEstimate, setDeadline } = useApp();
  const live = dresses.find((d) => d.id === dressId);
  const lastRef = useRef<Dress | undefined>(live);
  if (live) lastRef.current = live;
  const dress = live ?? lastRef.current;

  const [note, setNote] = useState('');
  const [kind, setKind] = useState<NoteKind>('observacion');
  const [estDraft, setEstDraft] = useState('');

  const step = dress ? currentStep(dress) : undefined;
  useEffect(() => {
    setEstDraft(step ? String(step.estHours) : '');
  }, [dress?.id, dress?.currentIndex, step?.estHours]);

  if (!dress) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;

  const totals = dressTotals(dress);
  const risk = dressRisk(dress, TODAY);
  const corte = templates.find((t) => t.id === dress.corteId)?.name ?? dress.corteId;
  const area = step ? areaOf(step.process) : null;
  const pool = area ? workers.filter((w) => (w.areas[area] ?? 0) > 0) : [];
  const others = workers.filter((w) => !pool.includes(w));
  const pendingA = dress.steps.filter((s) => s.process !== 'entrega');

  const submitNote = () => {
    if (!note.trim()) return;
    addNote(dress.id, note.trim(), kind, 'Patricia Linares');
    setNote('');
    toast.success(kind === 'incidencia' ? 'Incidencia registrada' : 'Observación agregada');
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
      }>
      
      <div className="space-y-8">
        <section>
          <h3 className="font-display text-xl font-semibold text-cocoa">Información general</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Info label="Cliente" value={`${dress.client} · ${dress.city}`} />
            <Info label="Tipo" value={dress.type} />
            <Info label="Colección" value={dress.collection} />
            <Info label="Corte" value={corte} />
            <Info label="Fecha del evento" value={fmtDate(dress.eventDate)} />
            <Info label="Fecha límite" value={fmtDate(dress.deadline)} />
            <Info label="Taller de origen" value={dress.workshop} />
            <Info label="Complejidad" value={dress.complexity} />
          </dl>
        </section>

        {dress.workshop === 'Taller C' &&
        <section className="rounded-xl border border-gold-soft/60 bg-champagne-soft p-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-cocoa">
                  <PackageCheckIcon className="h-4 w-4 text-gold" aria-hidden="true" /> Recibido de Taller C
                </h3>
                <ul className="mt-2 space-y-1 text-sm text-cocoa">
                  {(dress.receivedFromC ?? []).map((r) =>
                <li key={r} className="flex items-center gap-2">
                      <CircleCheckIcon className="h-4 w-4 text-ok" aria-hidden="true" /> {r}
                    </li>
                )}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-cocoa-muted">Un vestido de Taller C no está terminado: Taller A completa entalle, corsé, bordado, encaje, pruebas y acabados.</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-cocoa">Pendiente en Taller A</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {pendingA.map((s) =>
                <li key={s.process} className="flex justify-between gap-3">
                      <span className={s.done ? 'text-cocoa-faint line-through' : 'text-cocoa'}>{processName(s.process)}</span>
                      <span className="tabular text-cocoa">{fmtH(s.estHours)}</span>
                    </li>
                )}
                </ul>
                <p className="mt-2 flex justify-between border-t border-gold-soft/60 pt-2 text-sm font-semibold text-cocoa">
                  <span>Total pendiente Taller A</span>
                  <span className="tabular">{fmtH(totals.remaining)}</span>
                </p>
                <p className="mt-1 text-[11px] text-cocoa-muted">Descontadas automáticamente de la capacidad de Taller A.</p>
              </div>
            </div>
          </section>
        }

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

        {step && dress.status !== 'Terminado' &&
        <section className="rounded-xl border border-line bg-paper p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-cocoa-muted">Proceso actual</p>
                <p className="font-display text-2xl font-semibold text-cocoa">{processName(step.process)}</p>
              </div>
              {!readOnly &&
            <button
              type="button"
              onClick={() => {
                completeStep(dress.id);
                toast.success(`${processName(step.process)} terminado`, { description: dress.code });
              }}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-cocoa px-4 py-2 text-sm font-medium text-ivory transition-colors duration-150 hover:bg-[#3a281f]">
              
                  <CircleCheckIcon className="h-4 w-4" aria-hidden="true" /> Marcar proceso terminado
                </button>
            }
            </div>
            {step.process !== 'entrega' &&
          <div className="mt-4">
                <div className="flex justify-between text-xs text-cocoa-muted">
                  <span className="tabular">
                    {fmtNum(step.workedHours)} de {fmtNum(step.estHours)} h registradas
                  </span>
                  {step.workedHours > step.estHours && <span className="font-medium text-risk">+{fmtH(step.workedHours - step.estHours)} sobre lo estimado</span>}
                </div>
                <Meter className="mt-1.5" value={step.estHours > 0 ? step.workedHours / step.estHours : 0} tone={step.workedHours > step.estHours ? 'risk' : 'neutral'} label="Avance del proceso" />
              </div>
          }

            <div className="mt-5">
              <p className="text-xs font-medium text-cocoa-muted">Trabajadoras asignadas</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(readOnly ? workers.filter((w) => step.workerIds.includes(w.id)) : pool).map((w) => {
                const on = step.workerIds.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={on}
                    onClick={() => toggleStepWorker(dress.id, dress.currentIndex, w.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150',
                      on ? 'border-cocoa bg-cocoa text-ivory' : 'border-line text-cocoa-muted hover:border-nude hover:text-cocoa'
                    )}>
                    
                      {w.name}
                    </button>);

              })}
                {readOnly && step.workerIds.length === 0 && <span className="text-xs text-cocoa-faint">Sin asignar</span>}
              </div>
              {!readOnly && others.length > 0 &&
            <select
              aria-label="Reasignar a otra trabajadora"
              className={cn(inputClass, 'mt-2 max-w-xs text-xs')}
              value=""
              onChange={(e) => e.target.value && toggleStepWorker(dress.id, dress.currentIndex, e.target.value)}>
              
                  <option value="">Reasignar a otra área…</option>
                  {others.map((w) =>
              <option key={w.id} value={w.id}>
                      {w.name} · {w.role}
                    </option>
              )}
                </select>
            }
            </div>

            {!readOnly &&
          <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                  Cambiar proceso
                  <select className={inputClass} value={dress.currentIndex} onChange={(e) => setCurrentStep(dress.id, Number(e.target.value))}>
                    {dress.steps.map((s, i) =>
                <option key={`${s.process}-${i}`} value={i}>
                        {processName(s.process)}
                      </option>
                )}
                  </select>
                </label>
                <div className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                  <label htmlFor="est-hours">Horas estimadas del proceso</label>
                  <div className="flex gap-2">
                    <input id="est-hours" type="number" min={0} step={0.5} className={cn(inputClass, 'tabular')} value={estDraft} onChange={(e) => setEstDraft(e.target.value)} />
                    <button
                  type="button"
                  onClick={() => {
                    setStepEstimate(dress.id, dress.currentIndex, Number(estDraft) || 0);
                    toast.success('Horas estimadas actualizadas', { description: 'La capacidad del taller se recalculó.' });
                  }}
                  className="rounded-lg border border-line px-3 text-xs font-medium text-cocoa hover:bg-cream">
                  
                      Guardar
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-cocoa-muted">
                  Fecha límite
                  <input type="date" className={cn(inputClass, 'tabular')} value={dress.deadline} onChange={(e) => e.target.value && setDeadline(dress.id, e.target.value)} />
                </label>
              </div>
          }
          </section>
        }

        <section>
          <h3 className="font-display text-xl font-semibold text-cocoa">Observaciones e incidencias</h3>
          {!readOnly &&
          <div className="mt-3 space-y-2">
              <div className="w-64">
                <Segmented<NoteKind>
                ariaLabel="Tipo de registro"
                value={kind}
                onChange={setKind}
                options={[
                { value: 'observacion', label: 'Observación' },
                { value: 'incidencia', label: 'Incidencia' }]
                } />
              
              </div>
              <textarea
              aria-label="Texto de la observación"
              rows={2}
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'incidencia' ? 'Ej.: falta tela de forro; proveedor confirma el lunes.' : 'Ej.: la clienta pidió bajar el escote 1 cm.'} />
            
              <button type="button" onClick={submitNote} disabled={!note.trim()} className="rounded-lg bg-cocoa px-4 py-2 text-xs font-medium text-ivory disabled:opacity-40">
                Agregar {kind === 'incidencia' ? 'incidencia' : 'observación'}
              </button>
            </div>
          }
          <ul className="mt-4 divide-y divide-line">
            {dress.notes.length === 0 && <li className="py-3 text-sm text-cocoa-faint">Sin observaciones registradas.</li>}
            {dress.notes.map((n) =>
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
            )}
          </ul>
        </section>
      </div>
    </Drawer>);

}

function Info({ label, value }: {label: string;value: string;}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-cocoa-muted">{label}</dt>
      <dd className="tabular truncate font-medium text-cocoa">{value}</dd>
    </div>);

}