import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock3,
  LogIn,
  LogOut,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import {
  obtenerMiPanel,
  iniciarMiJornada,
  finalizarMiJornada,
  type PanelTaller,
} from "../../services/tallerApi";

const cardClass =
  "rounded-2xl border border-[#EDE5DF] bg-white p-4 shadow-[0_2px_12px_rgba(60,40,25,0.025)] sm:p-5";

const primaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#49372D] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#624B3D] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8DFD8] bg-white px-3.5 py-2.5 text-sm font-medium text-[#59463A] transition hover:bg-[#FAF6F2] disabled:cursor-not-allowed disabled:opacity-50";

function formatearHora(valor: string | null | undefined): string {
  if (!valor) return "—";

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) return "—";

  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Lima",
  }).format(fecha);
}

function formatearFecha(fecha: string | undefined): string {
  if (!fecha) return "Fecha no disponible";

  const partes = fecha.split("-");

  if (partes.length !== 3) return fecha;

  const fechaLocal = new Date(
    Number(partes[0]),
    Number(partes[1]) - 1,
    Number(partes[2]),
  );

  return new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fechaLocal);
}

export default function MyDay() {
  const [panel, setPanel] = useState<PanelTaller | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  const cargarPanel = useCallback(async (mostrarCarga = true) => {
    if (mostrarCarga) setCargando(true);

    setError("");

    try {
      const datos = await obtenerMiPanel();
      setPanel(datos);
    } catch (err) {
      const mensaje =
        err instanceof Error
          ? err.message
          : "No se pudo consultar tu asistencia.";

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
      toast.success("Tu entrada se registró correctamente.");
      await cargarPanel(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "No se pudo registrar tu entrada.",
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
      toast.success("Tu salida se registró correctamente.");
      await cargarPanel(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "No se pudo registrar tu salida.",
      );
      await cargarPanel(false);
    } finally {
      setProcesando(false);
    }
  };

  if (cargando) {
    return (
      <main className="flex min-h-full items-center justify-center bg-[#FCFAF7] p-6">
        <div className="flex items-center gap-3 text-sm text-[#928176]">
          <RefreshCw size={18} className="animate-spin" />
          Consultando tu asistencia...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-full space-y-5 bg-[#FCFAF7] p-3 text-[#44352D] sm:space-y-6 sm:p-6 lg:p-8">
      {/* ENCABEZADO */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#B18A6A]">
            Taller / Mi jornada
          </p>

          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Mi jornada
          </h1>

          <p className="mt-1 text-sm text-[#928176]">
            Registra tu entrada y salida del taller.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void cargarPanel()}
          disabled={cargando}
          className={`${secondaryButton} w-full sm:w-auto`}
        >
          <RefreshCw size={16} />
          Actualizar
        </button>
      </header>

      {/* ERROR */}
      {error && !panel && (
        <section
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm font-medium text-red-700">
            No se pudo cargar tu asistencia.
          </p>

          <p className="mt-1 break-words text-xs text-red-600">
            {error}
          </p>

          <button
            type="button"
            onClick={() => void cargarPanel()}
            className={`${secondaryButton} mt-3`}
          >
            <RefreshCw size={15} />
            Intentar nuevamente
          </button>
        </section>
      )}

      {panel && (
        <>
          {/* DATOS DE LA TRABAJADORA */}
          <section className={cardClass}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F4E8DD] text-[#805C42]">
                <UserRound size={19} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#928176]">
                  Trabajadora
                </p>

                <h2 className="mt-1 break-words font-display text-lg font-semibold">
                  {panel.trabajadora.nombre}
                </h2>

                {panel.trabajadora.area && (
                  <p className="mt-1 text-xs text-[#928176]">
                    Área: {panel.trabajadora.area}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 border-t border-[#F1EBE6] pt-3 text-sm text-[#79685D]">
              <CalendarDays
                size={16}
                className="mt-0.5 shrink-0 text-[#99704F]"
              />
              <span className="capitalize">
                {formatearFecha(panel.fecha)}
              </span>
            </div>
          </section>

          {/* ASISTENCIA */}
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cardClass}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">
                  Registro de asistencia
                </h2>

                <p className="mt-1 text-xs text-[#928176]">
                  Control de tu jornada de hoy.
                </p>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  jornadaActiva
                    ? "bg-[#EAF4EC] text-[#477451]"
                    : asistencia
                      ? "bg-[#F3EFEC] text-[#8D7D72]"
                      : "bg-[#FAF0E1] text-[#99704F]"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    jornadaActiva
                      ? "bg-[#5D9A6A]"
                      : asistencia
                        ? "bg-[#A99B91]"
                        : "bg-[#BD9270]"
                  }`}
                />

                {jornadaActiva
                  ? "Jornada activa"
                  : asistencia
                    ? "Jornada finalizada"
                    : "Sin marcar entrada"}
              </span>
            </div>

            {/* HORAS */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#EFE7E1] bg-[#FCFAF7] p-4">
                <div className="flex items-center gap-2 text-xs text-[#928176]">
                  <LogIn size={16} className="text-[#5D9A6A]" />
                  Hora de entrada
                </div>

                <p className="mt-3 font-display text-2xl font-semibold text-[#44352D]">
                  {formatearHora(asistencia?.entrada)}
                </p>
              </div>

              <div className="rounded-xl border border-[#EFE7E1] bg-[#FCFAF7] p-4">
                <div className="flex items-center gap-2 text-xs text-[#928176]">
                  <LogOut size={16} className="text-[#99704F]" />
                  Hora de salida
                </div>

                <p className="mt-3 font-display text-2xl font-semibold text-[#44352D]">
                  {formatearHora(asistencia?.salida)}
                </p>
              </div>
            </div>

            {error && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-[#E8DFD8] bg-[#FAF6F2] p-3 text-xs text-[#99704F]"
              >
                No se pudo actualizar el panel: {error}
              </p>
            )}

            {/* ACCIÓN PRINCIPAL */}
            <div className="mt-5 border-t border-[#F1EBE6] pt-4">
              {!asistencia ? (
                <button
                  type="button"
                  onClick={() => void marcarEntrada()}
                  disabled={procesando}
                  className={primaryButton}
                >
                  {procesando ? (
                    <RefreshCw size={17} className="animate-spin" />
                  ) : (
                    <LogIn size={17} />
                  )}

                  {procesando
                    ? "Registrando..."
                    : "Marcar entrada"}
                </button>
              ) : jornadaActiva ? (
                <button
                  type="button"
                  onClick={() => void marcarSalida()}
                  disabled={procesando}
                  className={primaryButton}
                >
                  {procesando ? (
                    <RefreshCw size={17} className="animate-spin" />
                  ) : (
                    <LogOut size={17} />
                  )}

                  {procesando
                    ? "Registrando..."
                    : "Marcar salida"}
                </button>
              ) : (
                <div className="rounded-xl border border-[#EDE5DF] bg-[#FAF6F2] px-4 py-5 text-center">
                  <Clock3
                    size={20}
                    className="mx-auto mb-2 text-[#99704F]"
                  />

                  <p className="text-sm font-medium text-[#59463A]">
                    Jornada finalizada
                  </p>

                  <p className="mt-1 text-xs text-[#928176]">
                    Tu jornada de hoy ya fue registrada.
                  </p>
                </div>
              )}
            </div>
          </motion.section>
        </>
      )}
    </main>
  );
}
