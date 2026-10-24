import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  LogIn,
  LogOut,
  MessageSquareText,
  Shirt,
  Scissors,
  Play,
  CheckCircle2,
  Hourglass,
} from "lucide-react";
import { toast } from "sonner";

import {
  obtenerMiPanel,
  obtenerMisTrabajos,
  iniciarMiJornada,
  finalizarMiJornada,
  type PanelTaller,
  type TrabajoTaller,
} from "../../services/tallerApi";

const cardClass =
  "rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5";

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-cocoa px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cocoa/90 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClass =
  "w-full resize-y rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-cocoa outline-none transition placeholder:text-cocoa-muted focus:border-gold focus:ring-2 focus:ring-gold/10";

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

function formatearNumero(
  valor: number | string | undefined,
): string {
  if (valor === undefined || valor === null || valor === "") {
    return "0";
  }

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero.toFixed(1) : String(valor);
}

function estadoLegible(estado: string | undefined): string {
  if (!estado) return "Sin estado";

  return estado
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letra) => letra.toUpperCase());
}

export default function MyDay() {
  const [panel, setPanel] = useState<PanelTaller | null>(null);
  const [trabajos, setTrabajos] = useState<TrabajoTaller[]>([]);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [errorTrabajos, setErrorTrabajos] = useState("");

  const [observacionesEntrada, setObservacionesEntrada] = useState("");
  const [observacionesSalida, setObservacionesSalida] = useState("");

  const cargarDatos = useCallback(async (mostrarCarga = true) => {
    if (mostrarCarga) setCargando(true);

    setError("");
    setErrorTrabajos("");

    try {
      const [resultadoPanel, resultadoTrabajos] =
        await Promise.allSettled([
          obtenerMiPanel(),
          obtenerMisTrabajos(),
        ]);

      if (resultadoPanel.status === "fulfilled") {
        setPanel(resultadoPanel.value);
      } else {
        setError(
          resultadoPanel.reason instanceof Error
            ? resultadoPanel.reason.message
            : "No se pudo consultar tu asistencia.",
        );
      }

      if (resultadoTrabajos.status === "fulfilled") {
        setTrabajos(resultadoTrabajos.value);
      } else {
        setErrorTrabajos(
          resultadoTrabajos.reason instanceof Error
            ? resultadoTrabajos.reason.message
            : "No se pudieron consultar tus trabajos asignados.",
        );
      }
    } finally {
      if (mostrarCarga) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  const asistencia = panel?.asistencia ?? null;

  const jornadaActiva =
    asistencia !== null &&
    asistencia.salida === null &&
    asistencia.jornada_activa;

  const marcarEntrada = async () => {
    if (procesando) return;

    setProcesando(true);

    try {
      await iniciarMiJornada(observacionesEntrada.trim());
      toast.success("Tu entrada se registró correctamente.");
      setObservacionesEntrada("");
      await cargarDatos(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "No se pudo registrar tu entrada.",
      );
      await cargarDatos(false);
    } finally {
      setProcesando(false);
    }
  };

  const marcarSalida = async () => {
    if (procesando) return;

    setProcesando(true);

    try {
      await finalizarMiJornada(observacionesSalida.trim());
      toast.success("Tu salida se registró correctamente.");
      setObservacionesSalida("");
      await cargarDatos(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "No se pudo registrar tu salida.",
      );
      await cargarDatos(false);
    } finally {
      setProcesando(false);
    }
  };

  if (cargando) {
    return (
      <main className="flex min-h-full items-center justify-center bg-paper p-6">
        <p className="text-sm text-cocoa-muted">
          Cargando tu jornada...
        </p>
      </main>
    );
  }

  const nombreCompleto = panel?.trabajadora.nombre?.trim() || "";
  const primerNombre = nombreCompleto.split(/\s+/)[0] || "bienvenida";

  const fechaActual = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Lima",
  }).format(new Date());

  return (
    <main className="min-h-full bg-paper p-4 text-cocoa sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5 sm:space-y-6">

        {/* ENCABEZADO */}
        <header className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
                Fiancée · Taller
              </p>

              <h1 className="mt-2 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Hola, {primerNombre}
              </h1>

              <p className="mt-2 flex items-center gap-2 text-sm capitalize text-cocoa-muted">
                <CalendarDays size={16} className="shrink-0" />
                {fechaActual}
              </p>

              {panel?.trabajadora.area && (
                <p className="mt-1 text-xs text-cocoa-muted">
                  Área: {panel.trabajadora.area}
                </p>
              )}
            </div>

            {!asistencia ? (
              <button
                type="button"
                onClick={() => void marcarEntrada()}
                disabled={procesando || !panel}
                className={`${primaryButton} w-full sm:w-auto sm:min-w-[190px]`}
              >
                <LogIn size={17} />
                {procesando ? "Registrando..." : "Iniciar jornada"}
              </button>
            ) : jornadaActiva ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
                <span className="h-2 w-2 rounded-full bg-current" />
                Jornada activa
              </span>
            ) : (
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper px-3 py-2 text-sm font-medium text-cocoa-muted">
                <CheckCircle2 size={16} />
                Jornada finalizada
              </span>
            )}
          </div>

          {!asistencia && (
            <div className="mt-5 border-t border-line pt-4">
              <label
                htmlFor="observaciones-entrada"
                className="mb-2 flex items-center gap-2 text-sm font-medium text-cocoa"
              >
                <MessageSquareText size={16} />
                Observaciones de entrada
                <span className="font-normal text-cocoa-muted">
                  (opcional)
                </span>
              </label>

              <textarea
                id="observaciones-entrada"
                value={observacionesEntrada}
                onChange={(event) =>
                  setObservacionesEntrada(event.target.value)
                }
                placeholder="Escribe una observación si lo necesitas..."
                rows={2}
                maxLength={1000}
                disabled={procesando}
                className={textareaClass}
              />

              <p className="mt-1 text-right text-xs text-cocoa-muted">
                {observacionesEntrada.length}/1000 caracteres
              </p>
            </div>
          )}
        </header>

        {/* ERROR GENERAL */}
        {error && !panel && (
          <section
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <p className="text-sm font-medium text-red-800">
              No se pudo cargar tu jornada.
            </p>

            <p className="mt-1 break-words text-xs text-red-700">
              {error}
            </p>

            <button
              type="button"
              onClick={() => void cargarDatos()}
              className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-800 transition hover:bg-red-50"
            >
              Intentar nuevamente
            </button>
          </section>
        )}

        {panel && (
          <>
            {/* MI ASISTENCIA */}
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardClass}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold">
                    Mi asistencia
                  </h2>

                  <p className="mt-1 text-xs text-cocoa-muted">
                    {jornadaActiva
                      ? "Tu jornada está activa. Registra tu salida al terminar."
                      : asistencia
                        ? "Tu registro de hoy ya está finalizado."
                        : "Inicia tu jornada con el botón superior."}
                  </p>
                </div>

                <span
                  className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    jornadaActiva
                      ? "border-green-200 bg-green-50 text-green-800"
                      : asistencia
                        ? "border-line bg-paper text-cocoa-muted"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {jornadaActiva
                    ? "Jornada activa"
                    : asistencia
                      ? "Jornada finalizada"
                      : "Sin marcar entrada"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line bg-paper p-4">
                  <div className="flex items-center gap-2 text-xs text-cocoa-muted">
                    <LogIn size={16} className="text-green-700" />
                    Hora de entrada
                  </div>

                  <p className="mt-2 font-display text-2xl font-semibold">
                    {formatearHora(asistencia?.entrada)}
                  </p>
                </div>

                <div className="rounded-lg border border-line bg-paper p-4">
                  <div className="flex items-center gap-2 text-xs text-cocoa-muted">
                    <LogOut size={16} className="text-gold" />
                    Hora de salida
                  </div>

                  <p className="mt-2 font-display text-2xl font-semibold">
                    {formatearHora(asistencia?.salida)}
                  </p>
                </div>
              </div>

              {/* FINALIZAR JORNADA */}
              {jornadaActiva && (
                <div className="mt-4 rounded-lg border border-line bg-white p-3 sm:p-4">
                  <label
                    htmlFor="observaciones-salida"
                    className="mb-2 flex items-center gap-2 text-sm font-medium text-cocoa"
                  >
                    <MessageSquareText size={16} />
                    Observaciones de salida
                    <span className="font-normal text-cocoa-muted">
                      (opcional)
                    </span>
                  </label>

                  <textarea
                    id="observaciones-salida"
                    value={observacionesSalida}
                    onChange={(event) =>
                      setObservacionesSalida(event.target.value)
                    }
                    placeholder="Anota pendientes o incidencias, si corresponde..."
                    rows={2}
                    maxLength={1000}
                    disabled={procesando}
                    className={textareaClass}
                  />

                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs text-cocoa-muted">
                      {observacionesSalida.length}/1000 caracteres
                    </span>

                    <button
                      type="button"
                      onClick={() => void marcarSalida()}
                      disabled={procesando}
                      className={`${primaryButton} w-full sm:w-auto`}
                    >
                      <LogOut size={17} />
                      {procesando ? "Registrando..." : "Finalizar jornada"}
                    </button>
                  </div>
                </div>
              )}

              {/* OBSERVACIONES REGISTRADAS */}
              {asistencia &&
                (asistencia.observaciones_entrada ||
                  asistencia.observaciones_salida) && (
                  <div className="mt-4 space-y-3 border-t border-line pt-4">
                    {asistencia.observaciones_entrada && (
                      <div>
                        <p className="text-xs font-medium text-cocoa-muted">
                          Observación de entrada
                        </p>

                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-cocoa">
                          {asistencia.observaciones_entrada}
                        </p>
                      </div>
                    )}

                    {asistencia.observaciones_salida && (
                      <div>
                        <p className="text-xs font-medium text-cocoa-muted">
                          Observación de salida
                        </p>

                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-cocoa">
                          {asistencia.observaciones_salida}
                        </p>
                      </div>
                    )}
                  </div>
                )}

              {error && (
                <p role="status" className="mt-3 text-xs text-red-700">
                  No se pudo actualizar la asistencia: {error}
                </p>
              )}
            </motion.section>

            {/* VESTIDOS Y PROCESOS ASIGNADOS */}
            <section className={cardClass}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
                    Producción
                  </p>

                  <h2 className="font-display text-lg font-semibold">
                    Mis vestidos y procesos
                  </h2>

                  <p className="mt-1 text-xs text-cocoa-muted">
                    Consulta tus asignaciones y el avance de cada trabajo.
                  </p>
                </div>

                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-cocoa">
                  <Shirt size={14} />
                  {trabajos.length} asignación
                  {trabajos.length === 1 ? "" : "es"}
                </span>
              </div>

              {errorTrabajos && (
                <div
                  role="status"
                  className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  {errorTrabajos}
                </div>
              )}

              {!errorTrabajos && trabajos.length === 0 && (
                <div className="mt-4 rounded-lg border border-dashed border-line bg-paper px-4 py-8 text-center">
                  <Shirt
                    size={30}
                    className="mx-auto mb-3 text-gold"
                  />

                  <p className="text-sm font-medium text-cocoa">
                    No tienes vestidos asignados
                  </p>

                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-cocoa-muted">
                    Cuando se te asignen trabajos desde el sistema, aquí
                    aparecerán los vestidos, sus procesos y las horas pendientes.
                  </p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {trabajos.map((trabajo) => (
                  <article
                    key={trabajo.id}
                    className="min-w-0 rounded-xl border border-line bg-white p-4 transition hover:shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-paper text-cocoa">
                        <Shirt size={21} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold text-cocoa">
                          Vestido {trabajo.vestido.numero}
                        </p>

                        <p className="mt-1 break-words text-sm text-cocoa-muted">
                          {trabajo.vestido.cliente}
                        </p>

                        <p className="mt-1 break-words text-xs text-cocoa-muted">
                          {trabajo.vestido.tipo}
                        </p>
                      </div>

                      <span className="max-w-[45%] shrink-0 rounded-full border border-line bg-paper px-2.5 py-1 text-right text-[11px] font-medium text-cocoa-muted">
                        {estadoLegible(trabajo.estado)}
                      </span>
                    </div>

                    <div className="mt-4 rounded-lg border border-line bg-paper p-3">
                      <div className="flex items-start gap-2">
                        <Scissors
                          size={17}
                          className="mt-0.5 shrink-0 text-gold"
                        />

                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-cocoa">
                            {trabajo.proceso.nombre}
                          </p>

                          <p className="mt-1 break-words text-xs text-cocoa-muted">
                            Área: {trabajo.proceso.area}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="min-w-0 rounded-lg border border-line p-2">
                        <p className="text-[10px] leading-4 text-cocoa-muted sm:text-xs">
                          Reservadas
                        </p>

                        <p className="mt-1 break-words text-sm font-semibold">
                          {formatearNumero(trabajo.horas_reservadas)} h
                        </p>
                      </div>

                      <div className="min-w-0 rounded-lg border border-line p-2">
                        <p className="text-[10px] leading-4 text-cocoa-muted sm:text-xs">
                          Realizadas
                        </p>

                        <p className="mt-1 break-words text-sm font-semibold text-green-800">
                          {formatearNumero(trabajo.horas_realizadas)} h
                        </p>
                      </div>

                      <div className="min-w-0 rounded-lg border border-line p-2">
                        <p className="text-[10px] leading-4 text-cocoa-muted sm:text-xs">
                          Pendientes
                        </p>

                        <p className="mt-1 break-words text-sm font-semibold text-gold">
                          {formatearNumero(trabajo.horas_pendientes)} h
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                      <div className="flex items-center gap-1.5 text-xs text-cocoa-muted">
                        <Hourglass size={14} />
                        Fecha: {trabajo.fecha || "No disponible"}
                      </div>

                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                          trabajo.puede_iniciar
                            ? "border-green-200 bg-green-50 text-green-800"
                            : "border-line bg-paper text-cocoa-muted"
                        }`}
                      >
                        {trabajo.puede_iniciar
                          ? "Listo para iniciar"
                          : "Pendiente de habilitación"}
                      </span>
                    </div>

                    {!trabajo.puede_iniciar && (
                      <p className="mt-2 text-xs leading-5 text-cocoa-muted">
                        Este trabajo todavía no está habilitado para iniciar.
                        Puede depender de otro proceso o de las condiciones
                        definidas en el sistema.
                      </p>
                    )}
                  </article>
                ))}
              </div>

              <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-xs leading-5 text-cocoa-muted">
                <Play size={14} className="mt-0.5 shrink-0" />
                La lista muestra tus asignaciones. El control para iniciar y
                finalizar cada proceso debe usar el ID de la reserva y el ID
                de la sesión que devuelve el backend.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
