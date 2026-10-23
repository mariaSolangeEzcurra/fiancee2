
import { motion } from 'framer-motion';
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleXIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import type {
  Dress,
  SimulationResult as Result,
} from '../../types';

import { fmtDate } from '../../utils/dates';
import { cn, fmtH, fmtPct, toneSoft, toneText } from '../../utils/format';
import { areaName } from '../../utils/processes';
import { AreaNeedsTable } from './AreaNeedsTable';
import { DeliveryTimeline } from './DeliveryTimeline';

interface SimulationResultProps {
  result: Result;
  stale: boolean;
  accepted: { dress: Dress; position: number } | null;
  onAccept: () => void;
  onUseAlternative: () => void;
  simulationIsDefinitive?: boolean;
}

const verdicts = {
  ok: {
    title: 'Estimación favorable',
    message: 'El cálculo preliminar indica que la fecha podría cumplirse.',
    Icon: CircleCheckIcon,
    border: 'border-ok/30',
  },
  risk: {
    title: 'Requiere revisión',
    message: 'El cálculo identifica riesgos o información pendiente de confirmar.',
    Icon: TriangleAlertIcon,
    border: 'border-gold-soft',
  },
  bad: {
    title: 'Fecha no viable',
    message: 'El cálculo preliminar indica que la fecha no se cumpliría.',
    Icon: CircleXIcon,
    border: 'border-bad/30',
  },
};

function isPartialResult(result: Result): boolean {
  return (
    result.finish === null ||
    result.reasons.some((reason) =>
      /parcial|supera los 365 días|fuera del periodo|periodo consultado|no se puede confirmar|no se completó/i.test(
        reason,
      ),
    )
  );
}

function getMarginLabel(
  marginDays: number,
  finish: Date | null,
): string {
  if (!finish || marginDays < 0) {
    return finish === null
      ? 'No calculable'
      : `${Math.abs(marginDays)} días de retraso`;
  }

  if (marginDays === 0) {
    return 'Entrega en la fecha límite';
  }

  return `${marginDays} días calendario`;
}

function formatOptionalHours(value: number | null): string {
  return value === null ? 'No disponible en la API' : fmtH(value);
}

function formatOptionalCount(value: number | null): string {
  return value === null ? 'No disponible en la API' : String(value);
}

function formatOptionalDays(value: number | null): string {
  if (value === null) return 'No disponible en la API';

  return `${value} ${value === 1 ? 'día' : 'días'}`;
}

export function SimulationResult({
  result,
  stale,
  accepted,
  onAccept,
  onUseAlternative,
  simulationIsDefinitive = false,
}: SimulationResultProps) {
  const partial = isPartialResult(result);

  // La simulación actual no registra reservas ni confirma contratos.
  const canConfirm = false && simulationIsDefinitive && !partial && !stale;

  const verdictKey =
    !canConfirm && result.status === 'ok' ? 'risk' : result.status;

  const verdict = verdicts[verdictKey];
  const VerdictIcon = verdict.Icon;
  const critical = result.critical;

  const narrative = partial
    ? `La ruta requiere ${fmtH(result.totalHours)} de trabajo estimado. ` +
      'No se ha confirmado la finalización de todas las operaciones. ' +
      'La capacidad acumulada no garantiza que las horas estén disponibles ' +
      'en las fechas en que cada operación las necesita.'
    : `La estimación requiere ${fmtH(result.totalHours)} de trabajo. ` +
      `La capacidad acumulada calculada es de ${fmtH(result.availableHours)}. ` +
      (
        critical
          ? `El área con menor margen calculado es ${areaName(critical.area)}, ` +
            `con ${fmtH(critical.available)} restantes y ` +
            `${fmtH(critical.needed)} requeridas. `
          : ''
      ) +
      (
        result.finish
          ? `La fecha de finalización calculada es ${fmtDate(result.finish)}. ` +
            `El margen respecto a la entrega es ${getMarginLabel(result.marginDays, result.finish)}.`
          : 'No hay una fecha de finalización confirmada.'
      );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: stale ? 0.55 : 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="space-y-6"
      aria-live="polite"
    >
      {stale && (
        <p
          role="alert"
          className="rounded-lg border border-dashed border-gold-soft bg-champagne-soft px-4 py-2 text-xs text-cocoa"
        >
          Cambiaste los datos de la contratación. Vuelve a simular para
          actualizar el resultado.
        </p>
      )}

      <section
        className={cn(
          'rounded-2xl border p-6 md:p-7',
          toneSoft[verdictKey],
          verdict.border,
        )}
      >
        <div className="flex items-start gap-4">
          <VerdictIcon
            className={cn('mt-1 h-9 w-9 shrink-0', toneText[verdictKey])}
            aria-hidden="true"
          />

          <div className="min-w-0">
            <p
              className={cn(
                'font-display text-3xl font-semibold uppercase leading-tight tracking-wide md:text-4xl',
                toneText[verdictKey],
              )}
            >
              {verdict.title}
            </p>

            <p className="mt-2 text-base font-medium text-cocoa">
              {partial
                ? 'No se ha verificado la finalización de toda la ruta.'
                : verdict.message}
            </p>

            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cocoa/85">
              {narrative}
            </p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-cocoa/10 pt-5 sm:grid-cols-3">
          <Figure
            label="Horas requeridas"
            value={fmtH(result.totalHours)}
            sub="Suma de operaciones de la ruta seleccionada"
          />

          <Figure
            label="Capacidad acumulada"
            value={fmtH(result.availableHours)}
            sub="No equivale a capacidad garantizada por operación"
          />

          <Figure
            label="Área con menor margen"
            value={critical ? areaName(critical.area) : 'No identificada'}
            sub={
              critical
                ? `${fmtH(critical.available)} restantes · ${fmtH(critical.needed)} requeridas`
                : undefined
            }
          />

          <Figure
            label="Inicio estimado"
            value={fmtDate(result.start)}
            sub="Fecha calculada, no reservada"
          />

          <Figure
            label="Finalización estimada"
            value={result.finish ? fmtDate(result.finish) : 'No confirmada'}
            sub={`Fecha límite: ${fmtDate(result.delivery)}`}
          />

          <Figure
            label="Margen estimado"
            value={getMarginLabel(result.marginDays, result.finish)}
            sub="Diferencia calendario entre finalización y entrega"
          />
        </dl>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-3">
          <TriangleAlertIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />

          <div>
            <p className="font-semibold">
              Esta estimación no confirma la capacidad real
            </p>

            <p className="mt-1 leading-relaxed">
              La capacidad total acumulada no garantiza que existan horas
              disponibles en la fecha exacta de cada operación. Deben
              verificarse la disponibilidad diaria, las ausencias, las
              reservas, las habilidades de cada trabajadora y la carga
              de los vestidos que ya están en producción.
            </p>

            <p className="mt-2 leading-relaxed">
              Este resultado no crea contratos ni reservas en Django.
            </p>
          </div>
        </div>
      </section>

      {result.reasons.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-6">
          <h3 className="font-display text-2xl font-semibold text-cocoa">
            Aspectos que requieren atención
          </h3>

          <ul className="mt-4 space-y-3">
            {result.reasons.map((reason, index) => (
              <li
                key={`${index}-${reason}`}
                className="flex gap-3 text-sm leading-relaxed text-cocoa"
              >
                {result.status === 'bad' ? (
                  <CircleXIcon
                    className="mt-0.5 h-4 w-4 shrink-0 text-bad"
                    aria-hidden="true"
                  />
                ) : (
                  <TriangleAlertIcon
                    className="mt-0.5 h-4 w-4 shrink-0 text-risk"
                    aria-hidden="true"
                  />
                )}

                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {result.alternativeDate && (
            <div className="mt-5 flex flex-col gap-3 rounded-xl bg-cream px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <CalendarClockIcon
                  className="h-5 w-5 shrink-0 text-gold"
                  aria-hidden="true"
                />

                <div>
                  <p className="text-xs text-cocoa-muted">
                    Fecha alternativa estimada
                  </p>
                  <p className="text-sm font-semibold text-cocoa">
                    {fmtDate(result.alternativeDate)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onUseAlternative}
                disabled={stale}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-cocoa/20 bg-paper px-4 py-2 text-sm font-medium text-cocoa transition-colors hover:bg-ivory disabled:cursor-not-allowed disabled:opacity-50"
              >
                Usar esta fecha
                <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-paper p-6">
        <h3 className="font-display text-2xl font-semibold text-cocoa">
          Fechas de producción
        </h3>

        {result.finish ? (
          <div className="mt-4">
            <DeliveryTimeline
              start={result.start}
              finish={result.finish}
              delivery={result.delivery}
              event={result.event}
              late={result.finish > result.delivery}
            />
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-sm text-cocoa-muted">
            No se puede mostrar una fecha final de producción porque
            no se completó la planificación de todas las operaciones.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-paper p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl font-semibold text-cocoa">
            Capacidad por área
          </h3>

          <p className="text-xs text-cocoa-muted">
            Fecha límite: {fmtDate(result.delivery)} ·{' '}
            {result.deliveryDays} días calendario desde el inicio
          </p>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-cocoa-muted">
          Las horas restantes son datos de capacidad de Django. No
          garantizan que cada operación pueda ejecutarse en las fechas
          programadas.
        </p>

        <div className="mt-4">
          <AreaNeedsTable areas={result.areas} />
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-paper p-6">
          <h3 className="font-display text-2xl font-semibold text-cocoa">
            Cola y carga actual
          </h3>

          <dl className="mt-4 space-y-3 text-sm">
            <Row
              label="Vestidos por delante"
              value={formatOptionalCount(result.queue.dressesAhead)}
            />

            <Row
              label="Horas pendientes por delante"
              value={formatOptionalHours(result.queue.hoursAhead)}
            />

            <Row
              label="Retraso estimado por cola"
              value={formatOptionalDays(result.queue.delayDays)}
            />

            <Row
              label="Carga reservada según capacidad consultada"
              value={fmtPct(result.currentLoad)}
            />

            <Row
              label="Personal asignado en la simulación"
              value={`${result.staffNeeded} asignaciones estimadas`}
            />

            <Row
              label="Duración estimada de la ruta"
              value={
                result.finish
                  ? `${result.minLead} días calendario`
                  : 'No confirmada'
              }
            />
          </dl>

          <p className="mt-3 text-xs leading-relaxed text-cocoa-muted">
            La cola real de vestidos pendientes no está disponible en
            las API actuales. La carga mostrada es un indicador calculado
            con la capacidad consultada, no una medición completa de
            todos los vestidos en producción.
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-paper p-6">
          <h3 className="font-display text-2xl font-semibold text-cocoa">
            Ruta de producción
          </h3>

          {result.operations.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {result.operations.map((operation, index) => (
                <li
                  key={`${operation.itemName}-${operation.operationId}-${index}`}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="w-5 pt-0.5 text-right text-xs text-cocoa-faint">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-cocoa">
                      {operation.operationName}
                    </p>

                    <p className="mt-0.5 text-xs text-cocoa-muted">
                      {operation.area || 'Área no especificada'}
                      {operation.waiting ? ' · Espera' : ' · Trabajo'}
                    </p>

                    {operation.startDate && (
                      <p className="mt-0.5 text-xs text-cocoa-muted">
                        Inicio: {fmtDate(new Date(`${operation.startDate}T12:00:00`))}
                      </p>
                    )}

                    {operation.finishDate && (
                      <p className="text-xs text-cocoa-muted">
                        Fin: {fmtDate(new Date(`${operation.finishDate}T12:00:00`))}
                      </p>
                    )}
                  </div>

                  <span className="shrink-0 font-medium tabular text-cocoa">
                    {fmtH(operation.requiredHours)}
                  </span>
                </li>
              ))}

              <li className="flex items-center gap-3 border-t border-line pt-3 text-sm">
                <span className="w-5" />
                <span className="flex-1 font-medium text-cocoa">
                  Total estimado de trabajo
                </span>
                <span className="font-semibold tabular text-cocoa">
                  {fmtH(result.totalHours)}
                </span>
              </li>
            </ol>
          ) : (
            <p className="mt-4 text-sm text-cocoa-muted">
              No hay operaciones programadas para mostrar.
            </p>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-cream/70 p-6 sm:flex-row sm:items-center sm:justify-between">
        {accepted ? (
          <div className="flex items-start gap-3">
            <CircleCheckIcon
              className="mt-0.5 h-5 w-5 shrink-0 text-ok"
              aria-hidden="true"
            />

            <p className="text-sm text-cocoa">
              <span className="font-semibold">{accepted.dress.code}</span>{' '}
              fue registrado en la cola de producción, en la posición{' '}
              <span className="font-semibold">#{accepted.position}</span>.
            </p>
          </div>
        ) : (
          <>
            <div className="max-w-md">
              <p className="text-sm font-semibold text-cocoa">
                Registro de contrato pendiente de integración
              </p>

              <p className="mt-1 text-sm text-cocoa-muted">
                Esta pantalla calcula una estimación. El registro del
                contrato y las reservas deben implementarse en Django.
              </p>
            </div>

            <button
              type="button"
              onClick={onAccept}
              disabled
              title="Disponible cuando se implemente el registro en Django"
              className="inline-flex cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cocoa px-5 py-3 text-sm font-semibold text-ivory opacity-40"
            >
              Registro no disponible
              <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      </section>
    </motion.div>
  );
}

function Figure({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-cocoa-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular text-cocoa">
        {value}
      </dd>
      {sub && <dd className="text-[11px] text-cocoa-muted">{sub}</dd>}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 pb-2 last:border-0 last:pb-0">
      <dt className="text-cocoa-muted">{label}</dt>
      <dd className="text-right font-medium tabular text-cocoa">
        {value}
      </dd>
    </div>
  );
}
