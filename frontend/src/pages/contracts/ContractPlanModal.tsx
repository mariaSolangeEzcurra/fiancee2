import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type {
  OperacionPlan,
  PlanificacionContrato,
  PlanVestido,
} from '../../services/contractsApi';
import { fmtShort } from '../../utils/dates';

interface ContractPlanModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  plan: PlanVestido[];
  onClose: () => void;
  /** Botones extra del pie (p. ej. "Confirmar y guardar"). */
  actions?: ReactNode;
  footerNote?: string;
}

/** Convierte las reservas guardadas al mismo formato que la vista previa. */
export function planFromReservations(data: PlanificacionContrato): PlanVestido[] {
  return data.vestidos.map((vestido) => {
    const porOperacion = new Map<string, OperacionPlan>();

    for (const reserva of [...vestido.reservas].sort(
      (a, b) => a.orden - b.orden || a.fecha.localeCompare(b.fecha)
    )) {
      const actual = porOperacion.get(reserva.operacion);
      const horas = Number(reserva.horas_reservadas);

      if (!actual) {
        porOperacion.set(reserva.operacion, {
          plantilla_id: reserva.orden,
          operacion: reserva.operacion,
          tipo_tiempo: 'TRABAJO',
          horas: horas.toFixed(2),
          inicio: reserva.fecha,
          fin: reserva.fecha,
          asignaciones: [],
        });
      } else {
        actual.horas = (Number(actual.horas) + horas).toFixed(2);
        if (reserva.fecha < actual.inicio) actual.inicio = reserva.fecha;
        if (reserva.fecha > actual.fin) actual.fin = reserva.fecha;
      }

      porOperacion.get(reserva.operacion)!.asignaciones.push({
        trabajadora_id: reserva.trabajadora_id,
        trabajadora: reserva.trabajadora,
        fecha: reserva.fecha,
        horas: Number(reserva.horas_reservadas).toFixed(2),
      });
    }

    const advertencias: string[] = [];
    if (!vestido.taller) {
      advertencias.push('Ítem sin taller asignado: no ocupa capacidad.');
    } else if (vestido.reservas.length === 0) {
      advertencias.push('No tiene reservas activas en el taller.');
    }
    if (Number(vestido.horas_sin_asignar) > 0) {
      advertencias.push(
        `${vestido.horas_sin_asignar} h no entran en la capacidad disponible.`
      );
    }
    if (vestido.a_tiempo === false && vestido.fecha_fin_estimada) {
      advertencias.push(
        `La producción terminaría el ${fmtShort(vestido.fecha_fin_estimada)}, después de la fecha de recojo.`
      );
    }

    return {
      vestido_id: vestido.vestido_id,
      codigo: vestido.codigo,
      tipo_vestido: vestido.tipo_vestido,
      taller: vestido.taller,
      planificado: vestido.reservas.length > 0,
      fecha_fin_estimada: vestido.fecha_fin_estimada,
      fecha_limite: data.fecha_entrega,
      a_tiempo: vestido.a_tiempo,
      horas_trabajo: Number(vestido.horas_reservadas).toFixed(2),
      horas_sin_asignar: vestido.horas_sin_asignar,
      operaciones: [...porOperacion.values()],
      advertencias,
    };
  });
}

function trabajadorasDe(op: OperacionPlan): string {
  const nombres = [...new Set(op.asignaciones.map((a) => a.trabajadora))];
  return nombres.length ? nombres.join(', ') : '—';
}

function rango(inicio?: string | null, fin?: string | null): string {
  if (!inicio) return '—';
  if (!fin || fin === inicio) return fmtShort(inicio);
  return `${fmtShort(inicio)} → ${fmtShort(fin)}`;
}

function EstadoPlan({ item }: { item: PlanVestido }) {
  if (!item.taller) {
    return (
      <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold text-cocoa-muted">
        Sin taller
      </span>
    );
  }
  if (!item.planificado) {
    return (
      <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold text-cocoa-muted">
        Sin cambios
      </span>
    );
  }
  if (item.a_tiempo) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
        <CheckCircle2Icon className="h-3.5 w-3.5" /> A tiempo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
      <AlertTriangleIcon className="h-3.5 w-3.5" /> En riesgo
    </span>
  );
}

export function ContractPlanModal({
  open,
  title,
  subtitle,
  loading,
  error,
  plan,
  onClose,
  actions,
  footerNote,
}: ContractPlanModalProps) {
  const enRiesgo = plan.filter((p) => p.taller && p.planificado && !p.a_tiempo).length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="contract-plan-title"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-paper px-5 py-4 sm:px-7">
              <div>
                <h2
                  id="contract-plan-title"
                  className="font-display text-2xl font-semibold text-cocoa"
                >
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-1 text-xs text-cocoa-muted">{subtitle}</p>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-xl border border-line p-2 text-cocoa hover:bg-cream disabled:opacity-50"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
              {loading ? (
                <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
                  <RefreshCwIcon className="h-8 w-8 animate-spin text-cocoa" />
                  <p className="font-display text-2xl font-semibold text-cocoa">
                    Calculando planificación…
                  </p>
                  <p className="text-sm text-cocoa-muted">
                    Revisando la capacidad del taller en Django.
                  </p>
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
                >
                  {error}
                </div>
              ) : plan.length === 0 ? (
                <div className="rounded-xl border border-dashed border-nude p-8 text-center text-sm text-cocoa-muted">
                  No hay vestidos para planificar.
                </div>
              ) : (
                <div className="space-y-4">
                  {enRiesgo > 0 ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      {enRiesgo} vestido(s) no llegan a la fecha de recojo con la
                      capacidad actual. El contrato se puede guardar igual, pero
                      conviene revisar la fecha o el taller.
                    </p>
                  ) : (
                    <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                      Todos los vestidos con taller llegan a tiempo a la fecha de recojo.
                    </p>
                  )}

                  {plan.map((item) => (
                    <article
                      key={`${item.vestido_id}-${item.codigo}`}
                      className="rounded-2xl border border-line bg-cream/40 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-cocoa">
                            {item.codigo}
                            {item.tipo_vestido ? ` · ${item.tipo_vestido}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-cocoa-muted">
                            {item.taller ? (item.taller === 'T' ? 'Tienda · Modificación' : `Taller ${item.taller}`) : 'No pasa por el taller'}
                          </p>
                        </div>
                        <EstadoPlan item={item} />
                      </div>

                      {item.planificado && (
                        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                          <Dato label="Inicio" value={item.fecha_inicio_estimada ? fmtShort(item.fecha_inicio_estimada) : '—'} />
                          <Dato label="Fin estimado" value={item.fecha_fin_estimada ? fmtShort(item.fecha_fin_estimada) : '—'} />
                          <Dato label="Fecha de recojo" value={item.fecha_limite ? fmtShort(item.fecha_limite) : '—'} />
                          <Dato
                            label="Horas de trabajo"
                            value={`${item.horas_trabajo ?? '0'} h${Number(item.horas_espera ?? 0) > 0 ? ` + ${item.horas_espera} h espera` : ''}`}
                          />
                        </div>
                      )}

                      {item.advertencias.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {item.advertencias.map((a) => (
                            <li key={a} className="flex gap-2 text-xs text-amber-900">
                              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {a}
                            </li>
                          ))}
                        </ul>
                      )}

                      {item.operaciones && item.operaciones.length > 0 && (
                        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
                          <table className="w-full min-w-[560px] text-left text-xs">
                            <thead className="bg-champagne-soft/50 text-cocoa">
                              <tr>
                                <th className="px-3 py-2 font-semibold">Operación</th>
                                <th className="px-3 py-2 font-semibold">Fechas</th>
                                <th className="px-3 py-2 font-semibold">Horas</th>
                                <th className="px-3 py-2 font-semibold">Trabajadoras</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.operaciones.map((op) => (
                                <tr key={`${op.plantilla_id}-${op.operacion}`} className={`border-t border-line ${op.omitido ? 'opacity-50' : ''}`}>
                                  <td className="px-3 py-2 font-medium capitalize text-cocoa">
                                    {op.operacion}
                                    {op.omitido && <span className="ml-2 text-xs font-normal normal-case text-cocoa-muted">(no aplica)</span>}
                                    {op.ajustado && !op.omitido && <span className="ml-2 text-xs font-normal normal-case text-gold">ajustado</span>}
                                  </td>
                                  <td className="px-3 py-2 text-cocoa-muted">{rango(op.inicio, op.fin)}</td>
                                  <td className="px-3 py-2 text-cocoa-muted">
                                    {op.tipo_tiempo === 'ESPERA' ? (
                                      <span className="inline-flex items-center gap-1">
                                        <ClockIcon className="h-3 w-3" /> {op.horas} h espera
                                      </span>
                                    ) : (
                                      `${op.horas} h`
                                    )}
                                    {op.horas_sin_asignar && (
                                      <span className="ml-1 text-red-700">({op.horas_sin_asignar} h sin asignar)</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-cocoa-muted">
                                    {op.tipo_tiempo === 'ESPERA' ? 'Proveedor' : trabajadorasDe(op)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-cream/60 px-5 py-4 sm:px-7">
              <p className="text-xs text-cocoa-muted">{footerNote}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="rounded-xl border border-line bg-paper px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream disabled:opacity-50"
                >
                  Volver a editar
                </button>
                {actions}
              </div>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-paper px-3 py-2">
      <p className="text-cocoa-muted">{label}</p>
      <p className="font-semibold text-cocoa">{value}</p>
    </div>
  );
}
