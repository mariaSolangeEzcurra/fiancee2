import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock,
  LoaderCircle,
  Scissors,
  ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  obtenerMiHistorial,
  obtenerResumenDiarioVestidos,
  type HistorialTaller,
  type ResumenDiarioVestidos,
  type SesionVestido,
} from '../../services/tallerApi';

interface DiaAsistencia {
  fecha: string;
  entrada?: string;
  salida?: string | null;
  horas: number;
  observaciones: string[];
}

const cardClass =
  'rounded-2xl border border-[#EDE5DF] bg-white p-4 shadow-[0_2px_12px_rgba(60,40,25,0.025)] sm:p-5';

const mutedText = 'text-[#928176]';
const softBoxClass = 'rounded-xl bg-[#FAF6F2] p-3 sm:p-4';

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

// Convierte horas decimales a horas, minutos y segundos.
function formatearHoras(valor: number | string | null | undefined) {
  const horasDecimales = Number(valor ?? 0);

  if (!Number.isFinite(horasDecimales) || horasDecimales < 0) {
    return '0 min';
  }

  const totalSegundos = Math.round(horasDecimales * 3600);

  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;

  if (horas > 0) {
    return minutos > 0
      ? `${horas} h ${minutos} min`
      : `${horas} h`;
  }

  if (minutos > 0) {
    return segundos > 0
      ? `${minutos} min ${segundos} s`
      : `${minutos} min`;
  }

  return `${segundos} s`;
}

function formatearHora(fecha: string | null | undefined) {
  if (!fecha) return 'Pendiente';

  const valor = new Date(fecha);

  if (Number.isNaN(valor.getTime())) return fecha;

  return valor.toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function textoEstado(estado: string) {
  const estados: Record<string, string> = {
    EN_CURSO: 'En curso',
    PAUSADA: 'Pausada',
    FINALIZADA: 'Finalizado',
  };

  return estados[estado] ?? estado.replaceAll('_', ' ').toLowerCase();
}

function obtenerFechaActual() {
  const fecha = new Date();

  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function TarjetaSesion({ sesion }: { sesion: SesionVestido }) {
  return (
    <div className="rounded-xl border border-[#EDE5DF] p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-[#F8F0E9] p-2 text-[#99704F]">
          <Scissors size={17} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {sesion.codigo}
              </p>

              <p className={`mt-1 text-xs ${mutedText}`}>
                Contrato: {sesion.contrato}
              </p>
            </div>

            <span className="w-fit rounded-full bg-[#F8F0E9] px-3 py-1 text-xs font-medium capitalize text-[#795C46]">
              {textoEstado(sesion.estado)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[#FCFAF7] p-3">
              <p className={`text-xs ${mutedText}`}>
                Inicio
              </p>

              <p className="mt-1 text-sm font-medium">
                {formatearHora(sesion.inicio)}
              </p>
            </div>

            <div className="rounded-lg bg-[#FCFAF7] p-3">
              <p className={`text-xs ${mutedText}`}>
                Finalización
              </p>

              <p className="mt-1 text-sm font-medium">
                {formatearHora(sesion.fin)}
              </p>
            </div>

            <div className="col-span-2 rounded-lg bg-[#FCFAF7] p-3">
              <p className={`text-xs ${mutedText}`}>
                Tiempo efectivo
              </p>

              <p className="mt-1 text-sm font-semibold">
                {formatearHoras(sesion.horas_efectivas)}
              </p>
            </div>
          </div>

          {sesion.observaciones?.trim() && (
            <div className={`mt-3 ${softBoxClass}`}>
              <p className="text-xs font-semibold">
                Observaciones
              </p>

              <p className={`mt-2 text-sm leading-5 ${mutedText}`}>
                {sesion.observaciones}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MyAttendance() {
  const [historial, setHistorial] = useState<HistorialTaller | null>(null);

  const [resumenDiario, setResumenDiario] =
    useState<ResumenDiarioVestidos | null>(null);

  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;

    const cargarDatos = async () => {
      setCargando(true);

      const [resultadoHistorial, resultadoResumen] =
        await Promise.allSettled([
          obtenerMiHistorial(),
          obtenerResumenDiarioVestidos(),
        ]);

      if (!activo) return;

      if (resultadoHistorial.status === 'fulfilled') {
        setHistorial(resultadoHistorial.value);
      } else {
        setHistorial(null);
      }

      if (resultadoResumen.status === 'fulfilled') {
        setResumenDiario(resultadoResumen.value);
      } else {
        setResumenDiario(null);
      }

      if (
        resultadoHistorial.status === 'rejected' &&
        resultadoResumen.status === 'rejected'
      ) {
        toast.error('No se pudo cargar tu historial de actividad.');
      } else if (resultadoHistorial.status === 'rejected') {
        toast.error('No se pudieron cargar tus jornadas anteriores.');
      } else if (resultadoResumen.status === 'rejected') {
        toast.error('No se pudo cargar el detalle de vestidos de hoy.');
      }

      setCargando(false);
    };

    cargarDatos();

    return () => {
      activo = false;
    };
  }, []);

  const dias = useMemo<DiaAsistencia[]>(() => {
    if (!historial) return [];

    const agrupados = new Map<string, DiaAsistencia>();

    historial.asistencias.registros.forEach((registro) => {
      const observaciones = [
        registro.observaciones_entrada,
        registro.observaciones_salida,
      ].filter((texto) => texto?.trim());

      agrupados.set(registro.fecha, {
        fecha: registro.fecha,
        entrada: registro.entrada,
        salida: registro.salida,
        horas: Number(registro.horas_trabajadas) || 0,
        observaciones,
      });
    });

    return Array.from(agrupados.values()).sort((a, b) =>
      b.fecha.localeCompare(a.fecha)
    );
  }, [historial]);

  const totalHoras = dias.reduce(
    (total, dia) => total + dia.horas,
    0
  );

  const fechaHoy = resumenDiario?.fecha || obtenerFechaActual();

  // El backend puede devolver vestidos o sesiones.
  const vestidosHoy =
    resumenDiario?.vestidos ??
    resumenDiario?.sesiones ??
    [];

  const horasEfectivasHoy = Number(
    resumenDiario?.horas_efectivas ?? 0
  );

  const totalDias = historial?.asistencias.total ?? dias.length;

  if (cargando) {
    return (
      <div className="min-h-full bg-[#FCFAF7] p-3 sm:p-6 lg:p-8">
        <div
          className={`${cardClass} flex items-center justify-center gap-3 py-10 ${mutedText}`}
        >
          <LoaderCircle
            size={20}
            className="animate-spin text-[#99704F]"
          />

          <span className="text-sm">
            Cargando tu historial...
          </span>
        </div>
      </div>
    );
  }

  if (!historial && !resumenDiario) {
    return (
      <div className="min-h-full bg-[#FCFAF7] p-3 text-[#44352D] sm:p-6 lg:p-8">
        <div className={`${cardClass} py-8 text-center`}>
          <p className="text-sm font-medium">
            No se pudo cargar tu historial de asistencias.
          </p>

          <p className={`mt-1 text-sm ${mutedText}`}>
            Intenta nuevamente más tarde.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full space-y-5 bg-[#FCFAF7] p-3 text-[#44352D] sm:space-y-6 sm:p-6 lg:p-8">
      <header>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#B18A6A]">
          Mi actividad
        </p>

        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Mis asistencias
        </h1>

        <p className={`mt-1 text-sm ${mutedText}`}>
          Consulta tus jornadas y vestidos trabajados.
        </p>
      </header>

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
            {totalDias}
          </p>

          <p className={`mt-1 text-xs ${mutedText}`}>
            Jornadas registradas en tu historial.
          </p>
        </div>

        <div className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
              <Clock size={19} />
            </div>

            <p className={`text-sm ${mutedText}`}>
              Horas trabajadas
            </p>
          </div>

          <p className="mt-4 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {formatearHoras(totalHoras)}
          </p>

          <p className={`mt-1 text-xs ${mutedText}`}>
            Total acumulado de tus jornadas.
          </p>
        </div>
      </section>

      {resumenDiario && (
        <section className={cardClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#B18A6A]">
                Actividad de hoy
              </p>

              <h2 className="mt-1 text-base font-semibold">
                {formatearFecha(fechaHoy)}
              </h2>
            </div>

            <div className="flex gap-2">
              <div className="rounded-xl bg-[#FAF6F2] px-3 py-2">
                <p className={`text-xs ${mutedText}`}>
                  Vestidos
                </p>

                <p className="mt-1 text-sm font-semibold">
                  {resumenDiario.total_vestidos}
                </p>
              </div>

              <div className="rounded-xl bg-[#FAF6F2] px-3 py-2">
                <p className={`text-xs ${mutedText}`}>
                  Tiempo efectivo
                </p>

                <p className="mt-1 text-sm font-semibold">
                  {formatearHoras(horasEfectivasHoy)}
                </p>
              </div>
            </div>
          </div>

          {resumenDiario.asistencia && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#FCFAF7] p-3">
                <p className={`text-xs ${mutedText}`}>
                  Entrada
                </p>

                <p className="mt-1 text-sm font-medium">
                  {formatearHora(resumenDiario.asistencia.entrada)}
                </p>
              </div>

              <div className="rounded-xl bg-[#FCFAF7] p-3">
                <p className={`text-xs ${mutedText}`}>
                  Salida
                </p>

                <p className="mt-1 text-sm font-medium">
                  {formatearHora(resumenDiario.asistencia.salida)}
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2">
              <Scissors size={17} className="text-[#99704F]" />

              <h3 className="text-sm font-semibold">
                Vestidos trabajados hoy
              </h3>
            </div>

            {vestidosHoy.length > 0 ? (
              <div className="space-y-3">
                {vestidosHoy.map((sesion) => (
                  <TarjetaSesion
                    key={sesion.id}
                    sesion={sesion}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#E8DFD8] px-4 py-5 text-center">
                <p className={`text-sm ${mutedText}`}>
                  Todavía no hay vestidos registrados para hoy.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3 sm:space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList
              size={17}
              className="text-[#99704F]"
            />

            <h2 className="text-base font-semibold tracking-tight">
              Historial de jornadas
            </h2>
          </div>

          <p className={`mt-1 text-sm ${mutedText}`}>
            Registro de tus entradas, salidas y horas trabajadas.
          </p>
        </div>

        {dias.length > 0 ? (
          <div className="space-y-3 sm:space-y-4">
            {dias.map((dia) => (
              <article
                key={dia.fecha}
                className="overflow-hidden rounded-2xl border border-[#EDE5DF] bg-white shadow-[0_2px_12px_rgba(60,40,25,0.025)]"
              >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="shrink-0 rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
                      <CalendarDays size={19} />
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold capitalize sm:text-base">
                        {formatearFecha(dia.fecha)}
                      </h3>

                      <p className={`mt-1 text-xs leading-5 ${mutedText}`}>
                        Entrada: {dia.entrada || 'No registrada'}
                        {' · '}
                        Salida: {dia.salida || 'Pendiente'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl bg-[#FAF6F2] px-3 py-2 sm:min-w-[125px] sm:flex-col sm:items-start sm:gap-0">
                    <p className={`text-xs ${mutedText}`}>
                      Horas trabajadas
                    </p>

                    <p className="text-sm font-semibold">
                      {formatearHoras(dia.horas)}
                    </p>
                  </div>
                </div>

                {dia.observaciones.length > 0 && (
                  <div className="border-t border-[#EDE5DF] p-4 sm:p-5">
                    <div className={softBoxClass}>
                      <p className="text-xs font-semibold">
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
                  </div>
                )}

                {dia.fecha !== fechaHoy && (
                  <div className="border-t border-[#EDE5DF] px-4 py-3 sm:px-5">
                    <p className={`text-xs ${mutedText}`}>
                      El detalle de vestidos de esta fecha todavía no está disponible en el historial.
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className={`${cardClass} py-10 text-center`}>
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#F8F0E9] text-[#99704F]">
              <CalendarDays size={21} />
            </div>

            <p className="text-sm font-semibold">
              Todavía no tienes jornadas registradas.
            </p>

            <p className={`mt-1 text-sm ${mutedText}`}>
              Tus registros aparecerán aquí cuando registres tu jornada.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export default MyAttendance;
