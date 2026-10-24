
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDays,
  Clock3,
  LogIn,
  LogOut,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  obtenerMiPanel,
  iniciarMiJornada,
  finalizarMiJornada,
  type PanelTaller,
} from '../../services/tallerApi';

function formatearHora(valor: string | null | undefined): string {
  if (!valor) return '—';

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) return '—';

  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha);
}

function formatearFecha(fecha: string | undefined): string {
  if (!fecha) return 'Fecha no disponible';

  const partes = fecha.split('-');

  if (partes.length !== 3) return fecha;

  const fechaLocal = new Date(
    Number(partes[0]),
    Number(partes[1]) - 1,
    Number(partes[2]),
  );

  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fechaLocal);
}

export default function MyDay() {
  const [panel, setPanel] = useState<PanelTaller | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');

  const cargarPanel = useCallback(async (mostrarCarga = true) => {
    if (mostrarCarga) setCargando(true);

    setError('');

    try {
      const datos = await obtenerMiPanel();
      setPanel(datos);
    } catch (err) {
      const mensaje =
        err instanceof Error
          ? err.message
          : 'No se pudo consultar tu asistencia.';

      setError(mensaje);

      if (!mostrarCarga) {
        toast.error(mensaje);
      }
    } finally {
      if (mostrarCarga) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarPanel();
  }, [cargarPanel]);

  const asistencia = panel?.asistencia ?? null;
  const jornadaActiva =
    asistencia !== null &&
    asistencia.salida === null &&
    asistencia.jornada_activa;

  const marcarEntrada = async () => {
    if (procesando) return;

    setProcesando(true);

    try {
      await iniciarMiJornada();
      toast.success('Tu entrada se registró correctamente.');
      await cargarPanel(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'No se pudo registrar tu entrada.',
      );

      await cargarPanel(false);
    } finally {
      setProcesando(false);
    }
  };

  const marcarSalida = async () => {
    if (procesando) return;

    setProcesando(true);

    try {
      await finalizarMiJornada();
      toast.success('Tu salida se registró correctamente.');
      await cargarPanel(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'No se pudo registrar tu salida.',
      );

      await cargarPanel(false);
    } finally {
      setProcesando(false);
    }
  };

  if (cargando) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Consultando tu asistencia...</span>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-pink-600">
          Fiancée · Taller
        </p>

        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          Mi jornada
        </h1>

        <p className="text-sm text-gray-500">
          Registra tu entrada y salida de la jornada laboral.
        </p>
      </header>

      {error && !panel && (
        <section
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <p className="font-medium text-red-700">
            No se pudo cargar tu asistencia.
          </p>
          <p className="mt-1 text-sm text-red-600">{error}</p>

          <button
            type="button"
            onClick={() => void cargarPanel()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Intentar nuevamente
          </button>
        </section>
      )}

      {panel && (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pink-50 text-pink-600">
                <UserRound className="h-6 w-6" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-500">Trabajadora</p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">
                  {panel.trabajadora.nombre}
                </h2>

                {panel.trabajadora.area && (
                  <p className="mt-1 text-sm text-gray-500">
                    Área: {panel.trabajadora.area}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => void cargarPanel()}
                title="Actualizar asistencia"
                aria-label="Actualizar asistencia"
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-gray-100 pt-4 text-sm text-gray-600">
              <CalendarDays className="h-4 w-4 text-pink-600" />
              <span className="capitalize">
                {formatearFecha(panel.fecha)}
              </span>
            </div>
          </section>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">
                Registro de asistencia
              </h2>

              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  jornadaActiva
                    ? 'bg-green-50 text-green-700'
                    : asistencia
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-amber-50 text-amber-700'
                }`}
              >
                {jornadaActiva
                  ? 'Jornada activa'
                  : asistencia
                    ? 'Jornada finalizada'
                    : 'Sin marcar entrada'}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <LogIn className="h-4 w-4 text-green-600" />
                  Hora de entrada
                </div>

                <p className="mt-3 text-2xl font-bold text-gray-900">
                  {formatearHora(asistencia?.entrada)}
                </p>
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <LogOut className="h-4 w-4 text-pink-600" />
                  Hora de salida
                </div>

                <p className="mt-3 text-2xl font-bold text-gray-900">
                  {formatearHora(asistencia?.salida)}
                </p>
              </div>
            </div>

            {error && (
              <p role="status" className="mt-4 text-sm text-amber-700">
                No se pudo actualizar el panel: {error}
              </p>
            )}

            <div className="mt-6">
              {!asistencia ? (
                <button
                  type="button"
                  onClick={marcarEntrada}
                  disabled={procesando}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 py-3.5 font-semibold text-white transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {procesando ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <LogIn className="h-5 w-5" />
                  )}
                  {procesando ? 'Registrando...' : 'Marcar entrada'}
                </button>
              ) : jornadaActiva ? (
                <button
                  type="button"
                  onClick={marcarSalida}
                  disabled={procesando}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-3.5 font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {procesando ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <LogOut className="h-5 w-5" />
                  )}
                  {procesando ? 'Registrando...' : 'Marcar salida'}
                </button>
              ) : (
                <div className="rounded-xl bg-gray-50 px-4 py-4 text-center text-sm text-gray-600">
                  <Clock3 className="mx-auto mb-2 h-5 w-5" />
                  Tu jornada de hoy ya fue finalizada.
                </div>
              )}
            </div>
          </motion.section>
        </>
      )}
    </main>
  );
}
