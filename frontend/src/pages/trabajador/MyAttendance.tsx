import React, { useEffect, useState } from 'react';
import {
  CalendarDays,
  Clock,
  LoaderCircle,
  Scissors,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  obtenerMiHistorial,
  type HistorialTaller,
  type SesionHistorialTaller,
} from '../../services/tallerApi';

function formatearFecha(fecha: string) {
  if (!fecha) return 'Fecha no disponible';

  const [year, month, day] = fecha.split('-').map(Number);

  if (!year || !month || !day) return fecha;

  return new Date(year, month - 1, day).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatearHoras(valor: number | string | null | undefined) {
  const horas = Number(valor ?? 0);

  if (!Number.isFinite(horas)) return '0 h';

  return `${horas.toLocaleString('es-PE', {
    maximumFractionDigits: 2,
  })} h`;
}

function textoEstado(estado: string) {
  return estado
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .toLowerCase();
}

interface DiaAsistencia {
  fecha: string;
  horas: number;
  entrada?: string;
  salida?: string | null;
  observaciones: string[];
  sesiones: SesionHistorialTaller[];
}

const cardClass =
  'rounded-2xl border border-[#EDE5DF] bg-white p-4 shadow-[0_2px_12px_rgba(60,40,25,0.025)] sm:p-5';

const mutedText = 'text-[#928176]';
const headingText = 'text-[#44352D]';

const softBoxClass = 'rounded-xl bg-[#FAF6F2] p-3 sm:p-4';

export function MyAttendance() {
  const [historial, setHistorial] = useState<HistorialTaller | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarHistorial = async () => {
      try {
        const respuesta = await obtenerMiHistorial();
        setHistorial(respuesta);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar tu historial de asistencias.'
        );
      } finally {
        setCargando(false);
      }
    };

    cargarHistorial();
  }, []);

  const dias: DiaAsistencia[] = React.useMemo(() => {
    if (!historial) return [];

    const agrupados = new Map<string, DiaAsistencia>();

    historial.asistencias.registros.forEach((registro) => {
      const existente = agrupados.get(registro.fecha);

      const observaciones = [
        registro.observaciones_entrada,
        registro.observaciones_salida,
      ].filter((texto) => texto?.trim());

      if (existente) {
        existente.horas += Number(registro.horas_trabajadas) || 0;
        existente.observaciones.push(...observaciones);
        existente.entrada ??= registro.entrada;
        existente.salida ??= registro.salida;
      } else {
        agrupados.set(registro.fecha, {
          fecha: registro.fecha,
          horas: Number(registro.horas_trabajadas) || 0,
          entrada: registro.entrada,
          salida: registro.salida,
          observaciones,
          sesiones: [],
        });
      }
    });

    historial.sesiones_trabajo.registros.forEach((sesion) => {
      const existente = agrupados.get(sesion.fecha);

      if (existente) {
        existente.sesiones.push(sesion);
      } else {
        agrupados.set(sesion.fecha, {
          fecha: sesion.fecha,
          horas: Number(sesion.horas_trabajadas) || 0,
          observaciones: [],
          sesiones: [sesion],
        });
      }

      const dia = agrupados.get(sesion.fecha)!;

      [
        sesion.observaciones_inicio,
        sesion.observaciones_fin,
      ].forEach((observacion) => {
        if (observacion?.trim()) {
          dia.observaciones.push(observacion);
        }
      });
    });

    return Array.from(agrupados.values()).sort((a, b) =>
      b.fecha.localeCompare(a.fecha)
    );
  }, [historial]);

  const totalHoras = dias.reduce((total, dia) => total + dia.horas, 0);

  return (
    <div className="min-h-full space-y-5 bg-[#FCFAF7] p-3 text-[#44352D] sm:space-y-6 sm:p-6 lg:p-8">
      <header>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#B18A6A]">
          Mi actividad
        </p>

        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Mis asistencias
        </h1>

        <p className="mt-1 text-sm text-[#928176]">
          Consulta tus jornadas, vestidos trabajados y avances.
        </p>
      </header>

      {cargando ? (
        <div className={`${cardClass} flex items-center justify-center gap-3 py-10 ${mutedText}`}>
          <LoaderCircle size={20} className="animate-spin text-[#99704F]" />
          <span className="text-sm">Cargando tus asistencias...</span>
        </div>
      ) : historial ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className={cardClass}>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
                  <CalendarDays size={19} />
                </div>

                <p className={`text-sm ${mutedText}`}>
                  Días registrados
                </p>
              </div>

              <p className="mt-4 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                {historial.asistencias.total}
              </p>

              <p className={`mt-1 text-xs ${mutedText}`}>
                Días con asistencia registrada.
              </p>
            </div>

            <div className={cardClass}>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
                  <Clock size={19} />
                </div>

                <p className={`text-sm ${mutedText}`}>
                  Horas registradas
                </p>
              </div>

              <p className="mt-4 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                {formatearHoras(totalHoras)}
              </p>

              <p className={`mt-1 text-xs ${mutedText}`}>
                Total según las jornadas de tu historial.
              </p>
            </div>
          </section>

          <section className="space-y-3 sm:space-y-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Historial de jornadas
              </h2>
              <p className={`mt-1 text-sm ${mutedText}`}>
                Tus asistencias y procesos, ordenados por fecha.
              </p>
            </div>

            {dias.length > 0 ? (
              <div className="space-y-3 sm:space-y-4">
                {dias.map((dia) => (
                  <article
                    key={dia.fecha}
                    className="overflow-hidden rounded-2xl border border-[#EDE5DF] bg-white shadow-[0_2px_12px_rgba(60,40,25,0.025)]"
                  >
                    <header className="flex flex-col gap-3 border-b border-[#EDE5DF] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="shrink-0 rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
                          <CalendarDays size={19} />
                        </div>

                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold capitalize sm:text-base">
                            {formatearFecha(dia.fecha)}
                          </h3>

                          {dia.entrada && (
                            <p className={`mt-1 text-xs leading-5 ${mutedText}`}>
                              Entrada: {dia.entrada}
                              {dia.salida ? ` · Salida: ${dia.salida}` : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-xl bg-[#FAF6F2] px-3 py-2 sm:min-w-[125px] sm:flex-col sm:items-start sm:gap-0">
                        <p className={`text-xs ${mutedText}`}>
                          Total del día
                        </p>
                        <p className="text-sm font-semibold">
                          {formatearHoras(dia.horas)}
                        </p>
                      </div>
                    </header>

                    <div className="space-y-4 p-4 sm:p-5">
                      <div className="flex items-center gap-2">
                        <Scissors size={16} className="text-[#99704F]" />
                        <h4 className="text-sm font-semibold">
                          Vestidos y avances
                        </h4>
                      </div>

                      {dia.sesiones.length > 0 ? (
                        <div className="space-y-3">
                          {dia.sesiones.map((sesion) => (
                            <div
                              key={sesion.id}
                              className="rounded-xl border border-[#EDE5DF] p-3 sm:p-4"
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 shrink-0 rounded-lg bg-[#F8F0E9] p-2 text-[#99704F]">
                                  <Scissors size={16} />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                    <p className="text-sm font-semibold">
                                      Vestido {sesion.vestido.numero}
                                    </p>

                                    <span className="w-fit rounded-full bg-[#F8F0E9] px-2.5 py-1 text-xs font-medium capitalize text-[#795C46]">
                                      {textoEstado(sesion.estado_proceso)}
                                    </span>
                                  </div>

                                  <p className={`mt-1 text-sm ${mutedText}`}>
                                    Cliente: {sesion.vestido.cliente}
                                  </p>

                                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <div className="rounded-lg bg-[#FCFAF7] p-3">
                                      <p className={`text-xs ${mutedText}`}>
                                        Proceso
                                      </p>
                                      <p className="mt-1 text-sm font-medium">
                                        {sesion.proceso.nombre}
                                      </p>
                                    </div>

                                    <div className="rounded-lg bg-[#FCFAF7] p-3">
                                      <p className={`text-xs ${mutedText}`}>
                                        Tiempo del proceso
                                      </p>
                                      <p className="mt-1 text-sm font-medium">
                                        {formatearHoras(sesion.horas_trabajadas)}
                                      </p>
                                    </div>
                                  </div>

                                  {(sesion.observaciones_inicio ||
                                    sesion.observaciones_fin) && (
                                    <div className={`mt-3 ${softBoxClass}`}>
                                      <p className="text-xs font-semibold">
                                        Observaciones del proceso
                                      </p>

                                      {sesion.observaciones_inicio && (
                                        <p className={`mt-2 text-sm leading-5 ${mutedText}`}>
                                          <span className="font-medium text-[#59463A]">
                                            Inicio:{' '}
                                          </span>
                                          {sesion.observaciones_inicio}
                                        </p>
                                      )}

                                      {sesion.observaciones_fin && (
                                        <p className={`mt-2 text-sm leading-5 ${mutedText}`}>
                                          <span className="font-medium text-[#59463A]">
                                            Final:{' '}
                                          </span>
                                          {sesion.observaciones_fin}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[#E8DFD8] px-4 py-5 text-center">
                          <p className={`text-sm ${mutedText}`}>
                            No hay procesos de vestidos registrados para este día.
                          </p>
                        </div>
                      )}

                      {dia.observaciones.length > 0 && (
                        <div className={softBoxClass}>
                          <p className="text-sm font-semibold">
                            Observaciones de asistencia
                          </p>

                          <div className="mt-2 space-y-2">
                            {dia.observaciones.map((observacion, indice) => (
                              <p
                                key={`${dia.fecha}-${indice}`}
                                className={`text-sm leading-5 ${mutedText}`}
                              >
                                {observacion}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={`${cardClass} py-10 text-center`}>
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#F8F0E9] text-[#99704F]">
                  <CalendarDays size={21} />
                </div>

                <p className="text-sm font-semibold">
                  Todavía no tienes asistencias registradas.
                </p>

                <p className={`mt-1 text-sm ${mutedText}`}>
                  Tus registros aparecerán aquí cuando registres tu jornada.
                </p>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className={`${cardClass} py-8 text-center`}>
          <p className="text-sm font-medium">
            No se pudo cargar tu historial de asistencias.
          </p>
          <p className={`mt-1 text-sm ${mutedText}`}>
            Intenta nuevamente más tarde.
          </p>
        </div>
      )}
    </div>
  );
}

export default MyAttendance;
