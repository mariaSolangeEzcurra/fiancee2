import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRightIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleXIcon,
  FlameIcon,
  HourglassIcon,
  TriangleAlertIcon,
  UsersIcon,
} from 'lucide-react';

import type { AreaNeed, Dress, SimulationResult as Result } from '../../types';

import { fmtDate } from '../../utils/dates';
import { areaName } from '../../utils/processes';
import { cn, fmtH, fmtPct } from '../../utils/format';

interface SimulationResultProps {
  result: Result;
  stale: boolean;
  accepted: { dress: Dress; position: number } | null;
  onAccept: () => void;
  onUseAlternative: () => void;
  simulationIsDefinitive?: boolean;
}

const VERDICT = {
  ok: {
    title: 'Factible',
    message: 'El taller llega a tiempo con su personal y carga actuales.',
    Icon: CircleCheckIcon,
    box: 'border-green-200 bg-green-50',
    text: 'text-green-800',
  },
  risk: {
    title: 'Factible con condiciones',
    message: 'Llega a tiempo, pero con condiciones que vigilar.',
    Icon: TriangleAlertIcon,
    box: 'border-amber-200 bg-amber-50',
    text: 'text-amber-800',
  },
  bad: {
    title: 'No factible',
    message: 'No se llega a la fecha de entrega pedida.',
    Icon: CircleXIcon,
    box: 'border-red-200 bg-red-50',
    text: 'text-red-800',
  },
} as const;

const CAUSE_ICON = {
  ESPERA: HourglassIcon,
  CAPACIDAD: UsersIcon,
  TIEMPO: CalendarClockIcon,
} as const;

function marginText(days: number): string {
  if (days < 0) return `${Math.abs(days)} día${days === -1 ? '' : 's'} tarde`;
  if (days === 0) return 'Justo a tiempo';
  return `${days} día${days === 1 ? '' : 's'} antes`;
}

function shortDate(iso: string): string {
  return fmtDate(new Date(`${iso}T12:00:00`));
}

export function SimulationResult({
  result,
  stale,
  accepted,
  onAccept,
  onUseAlternative,
  simulationIsDefinitive = false,
}: SimulationResultProps) {
  const v = VERDICT[result.status];
  const VerdictIcon = v.Icon;
  const margin = result.finish ? Math.round((result.delivery.getTime() - result.finish.getTime()) / 86_400_000) : null;
  const canAccept = simulationIsDefinitive && !stale && result.verdict !== 'NO_FACTIBLE';
  const cause = result.cause;
  const CauseIcon = cause ? CAUSE_ICON[cause.type] : null;
  const dresses = result.dressSummaries ?? [];
  // Motivos que no son la causa principal (p. ej. "es después del evento").
  const extraReasons = result.reasons.filter((r) => !cause || r !== cause.detail);
  const season = result.highSeason;
  const afterEvent = Boolean(result.alternativeDate && result.alternativeDate > result.event);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: stale ? 0.55 : 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="space-y-5"
      aria-live="polite"
    >
      {stale && (
        <p role="alert" className="rounded-lg border border-dashed border-gold-soft bg-champagne-soft px-4 py-2 text-xs text-cocoa">
          Cambiaste los datos. Vuelve a simular para actualizar el resultado.
        </p>
      )}

      {/* 1. Veredicto */}
      <section className={cn('rounded-2xl border p-5 sm:p-6', v.box)}>
        <div className="flex items-center gap-3">
          <VerdictIcon className={cn('h-8 w-8 shrink-0', v.text)} aria-hidden="true" />
          <div>
            <p className={cn('font-display text-3xl font-semibold leading-tight', v.text)}>
              {result.verdictTitle ?? v.title}
            </p>
            <p className="text-sm text-cocoa">{result.verdictMessage ?? v.message}</p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3">
          <Tile label="Entrega pedida" value={fmtDate(result.delivery)} />
          <Tile label="Estaría listo" value={result.finish ? fmtDate(result.finish) : '—'} />
          <Tile
            label="Margen"
            value={margin === null ? '—' : marginText(margin)}
            tone={margin === null ? undefined : margin < 0 ? 'bad' : margin < 7 ? 'risk' : 'ok'}
          />
        </dl>
      </section>

      {/* 2. Por qué / condiciones */}
      {result.status === 'bad' && (cause || result.alternativeDate) && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          {cause && CauseIcon && (
            <div className="flex gap-3">
              <CauseIcon className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden="true" />
              <div>
                <p className="font-semibold text-cocoa">{cause.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-cocoa-muted">{cause.detail}</p>
              </div>
            </div>
          )}

          {result.alternativeDate && (
            <div className={cn('flex flex-col gap-3 rounded-xl bg-cream px-4 py-3 sm:flex-row sm:items-center sm:justify-between', cause && 'mt-4')}>
              <div className="flex items-center gap-3">
                <CalendarCheckIcon className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
                <div>
                  <p className="text-xs text-cocoa-muted">Fecha más cercana posible</p>
                  <p className="text-sm font-semibold text-cocoa">{fmtDate(result.alternativeDate)}</p>
                </div>
              </div>
              {afterEvent ? (
                <p className="text-xs font-medium text-bad">Es después del evento</p>
              ) : (
              <button
                type="button"
                onClick={onUseAlternative}
                disabled={stale}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cocoa/20 bg-paper px-4 py-2 text-sm font-medium text-cocoa hover:bg-ivory disabled:opacity-50"
              >
                Simular con esta fecha <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              )}
            </div>
          )}

          {extraReasons.map((reason) => (
            <p key={reason} className="mt-3 text-xs font-medium text-bad">
              {reason}
            </p>
          ))}
        </section>
      )}

      {result.status === 'risk' && (result.conditions ?? []).length > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <p className="font-semibold text-cocoa">A tener en cuenta</p>
          <ul className="mt-2 space-y-1.5">
            {(result.conditions ?? []).map((c) => (
              <li key={c} className="flex gap-2 text-sm text-cocoa-muted">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-risk" aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Cada vestido */}
      {dresses.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper">
          <p className="border-b border-line px-5 py-3 text-sm font-semibold text-cocoa">
            {dresses.length === 1 ? 'El vestido' : `Los ${dresses.length} vestidos`}
          </p>
          <ul className="divide-y divide-line">
            {dresses.map((d, i) => (
              <li key={`${d.name}-${i}`} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-cocoa">{d.name}</p>
                  {d.reason && <p className="mt-0.5 text-xs text-cocoa-muted">{d.reason.charAt(0).toUpperCase() + d.reason.slice(1)}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-cocoa-muted">Listo el {shortDate(d.ready)}</p>
                  <span
                    className={cn(
                      'mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      d.onTime ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
                    )}
                  >
                    {d.onTime ? 'A tiempo' : marginText(d.marginDays)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4. Contexto del taller (una línea) */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Chip>Carga del taller: {fmtPct(result.currentLoad)}</Chip>
        {result.bottleneck && <Chip>Área más ajustada: {result.bottleneck.name}</Chip>}
        {season?.active && (
          <Chip tone="risk">
            <FlameIcon className="h-3 w-3" aria-hidden="true" /> Temporada alta (+{Math.round((season.factor - 1) * 100)} % de horas)
          </Chip>
        )}
        {(result.notes ?? []).map((n) => (
          <Chip key={n}>{n}</Chip>
        ))}
      </div>

      {/* 5. Detalle técnico (plegado) */}
      <details className="group rounded-2xl border border-line bg-paper">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium text-cocoa">
          Ver detalle por área y procesos
          <ChevronDownIcon className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-5 border-t border-line px-5 py-4">
          <AreaList areas={result.areas} />
          {result.operations.length > 0 && (
            <ol className="space-y-1.5 text-sm">
              {result.operations.map((op, index) => (
                <li key={`${op.itemName}-${op.operationId}-${index}`} className="flex items-baseline gap-3">
                  <span className="w-5 text-right text-xs text-cocoa-faint">{index + 1}</span>
                  <span className="flex-1 text-cocoa">
                    {op.operationName}
                    {dresses.length > 1 && <span className="text-xs text-cocoa-muted"> · {op.itemName.split(' · ')[0]}</span>}
                  </span>
                  <span className="text-xs text-cocoa-muted">
                    {op.startDate ? shortDate(op.startDate) : ''}
                    {op.finishDate && op.finishDate !== op.startDate ? ` → ${shortDate(op.finishDate)}` : ''}
                  </span>
                  <span className="w-16 text-right text-xs tabular text-cocoa">{op.waiting ? 'espera' : fmtH(op.requiredHours)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>

      {/* 6. Aceptar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-cream/70 p-5 sm:flex-row sm:items-center sm:justify-between">
        {accepted ? (
          <p className="text-sm text-cocoa">
            <span className="font-semibold">{accepted.dress.code}</span> fue registrado en la cola de producción.
          </p>
        ) : (
          <>
            <p className="text-sm text-cocoa-muted">
              {result.verdict === 'NO_FACTIBLE'
                ? 'Cambia la fecha o el taller y vuelve a simular.'
                : 'Se abrirá el contrato con estos vestidos para completarlo.'}
            </p>
            <button
              type="button"
              onClick={onAccept}
              disabled={!canAccept}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cocoa px-5 py-3 text-sm font-semibold text-ivory hover:bg-[#3a281f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Aceptar y crear contrato <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      </section>
    </motion.div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'risk' | 'bad' }) {
  return (
    <div className="rounded-xl bg-paper/80 px-3 py-2.5">
      <dt className="text-[11px] text-cocoa-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-base font-semibold tabular',
          tone === 'bad' ? 'text-red-700' : tone === 'risk' ? 'text-amber-800' : tone === 'ok' ? 'text-green-800' : 'text-cocoa'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'risk' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1',
        tone === 'risk' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-line bg-paper text-cocoa-muted'
      )}
    >
      {children}
    </span>
  );
}

/** Cada área: cuánto necesita el pedido frente a lo libre hasta la entrega. */
function AreaList({ areas }: { areas: AreaNeed[] }) {
  if (areas.length === 0) return null;

  return (
    <div>
      <p className="mb-3 text-xs text-cocoa-muted">
        Horas que necesita este pedido en cada área, frente a las horas libres que le quedan hasta la entrega.
      </p>
      <ul className="space-y-3">
        {areas.map((a) => {
          const name = a.label ?? areaName(a.area);
          const pct = Math.round(Math.min(1, Math.max(0, a.utilAfter)) * 100);
          const state =
            a.tone === 'bad'
              ? { label: 'No alcanza', cls: 'bg-red-50 text-red-700', bar: 'bg-red-500' }
              : a.tone === 'risk'
                ? { label: 'Ajustado', cls: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' }
                : { label: 'Holgado', cls: 'bg-green-50 text-green-800', bar: 'bg-green-600' };
          return (
            <li key={a.area} className="rounded-xl border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-cocoa">{name}</p>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', state.cls)}>{state.label}</span>
              </div>
              <p className="mt-1 text-sm text-cocoa">
                Necesita <span className="font-semibold">{fmtH(a.needed)}</span>
                <span className="text-cocoa-muted"> · libres hasta la entrega: </span>
                <span className="font-semibold">{fmtH(a.available)}</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream" aria-hidden="true">
                <div className={cn('h-full rounded-full', state.bar)} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-cocoa-muted">
                Si se acepta, el área queda ocupada al {pct} %
                {a.staff.length > 0 ? ` · ${a.staff.join(', ')}` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}