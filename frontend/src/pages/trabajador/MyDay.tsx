
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  LogIn,
  LogOut,
  Shirt,
  Play,
  Pause,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import {
  obtenerMiPanel,
  iniciarMiJornada,
  finalizarMiJornada,
  obtenerVestidosDisponibles,
  iniciarSesionVestido,
  pausarSesionVestido,
  reanudarSesionVestido,
  finalizarSesionVestido,
  obtenerResumenDiarioVestidos,
  type PanelTaller,
  type VestidoDisponible,
  type SesionVestido,
  type ResumenDiarioVestidos,
} from "../../services/tallerApi";

// ─── Estilos ───────────────────────────────────────────

const cardClass =
  "rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5";

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-cocoa px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cocoa/90 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-cocoa transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50";

const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-cocoa outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/10";

// ─── Utilidades ────────────────────────────────────────

function formatearHora(valor?: string | null) {
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

function formatearNumero(valor?: number | string) {
  const horas = Number(valor ?? 0);

  if (!Number.isFinite(horas) || horas < 0) {
    return "0 min";
  }

  const totalMinutos = Math.floor(horas * 60);
  const h = Math.floor(totalMinutos / 60);
  const min = totalMinutos % 60;

  if (h === 0) return `${min} min`;
  if (min === 0) return `${h} h`;

  return `${h} h ${min} min`;
}

function estadoLegible(estado: string) {
  const estados: Record<string, string> = {
    EN_CURSO: "En curso",
    PAUSADA: "Pausado",
    FINALIZADA: "Finalizado",
  };

  return estados[estado] ?? estado;
}

// ─── Componente ────────────────────────────────────────

export default function MyDay() {
  const [panel, setPanel] = useState<PanelTaller | null>(null);
  const [vestidos, setVestidos] = useState<VestidoDisponible[]>([]);
  const [sesionActual, setSesionActual] =
    useState<SesionVestido | null>(null);
  const [resumen, setResumen] =
    useState<ResumenDiarioVestidos | null>(null);

  const [vestidoSeleccionado, setVestidoSeleccionado] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  // ─── Jornada ────────────────────────────────────────

  const asistencia = panel?.asistencia ?? null;

  const jornadaActiva =
    asistencia !== null &&
    asistencia.salida === null &&
    asistencia.jornada_activa;

  const nombre =
    panel?.trabajadora.nombre?.trim().split(/\s+/)[0] ||
    "bienvenida";

  const fecha = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Lima",
  }).format(new Date());

  // ─── Cargar datos ───────────────────────────────────

  const cargarDatos = useCallback(async (inicial = false) => {
    if (inicial) setCargando(true);

    setError("");

    try {
      const [panelData, vestidosData, resumenData] =
        await Promise.all([
          obtenerMiPanel(),
          obtenerVestidosDisponibles(),
          obtenerResumenDiarioVestidos(),
        ]);

      setPanel(panelData);
      setVestidos(vestidosData ?? []);
      setResumen(resumenData);

      // El backend puede devolver "vestidos" o "sesiones".
      const sesionesDelDia =
        resumenData.vestidos ??
        resumenData.sesiones ??
        [];

      const sesionAbierta = sesionesDelDia.find(
        (sesion) =>
          sesion.estado === "EN_CURSO" ||
          sesion.estado === "PAUSADA"
      );

      setSesionActual(sesionAbierta ?? null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la información."
      );
    } finally {
      if (inicial) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarDatos(true);
  }, [cargarDatos]);

  // ─── Ejecutar acciones ──────────────────────────────

  const ejecutar = async (
    accion: () => Promise<unknown>,
    mensaje: string
  ) => {
    if (procesando) return;

    setProcesando(true);

    try {
      await accion();

      toast.success(mensaje);

      setObservaciones("");
      setVestidoSeleccionado("");

      await cargarDatos();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "No se pudo completar la operación."
      );
    } finally {
      setProcesando(false);
    }
  };

  // ─── Acciones de jornada ────────────────────────────

  const marcarEntrada = () =>
    ejecutar(
      () => iniciarMiJornada(""),
      "Jornada iniciada correctamente."
    );

  const marcarSalida = () => {
    if (sesionActual) {
      toast.error(
        "Primero debes finalizar o pausar correctamente el vestido actual."
      );
      return;
    }

    ejecutar(
      () => finalizarMiJornada(""),
      "Jornada finalizada correctamente."
    );
  };

  // ─── Acciones de vestidos ───────────────────────────

  const iniciarVestido = () => {
    if (!vestidoSeleccionado) {
      toast.error("Selecciona un vestido.");
      return;
    }

    ejecutar(
      () =>
        iniciarSesionVestido(
          Number(vestidoSeleccionado),
          observaciones.trim()
        ),
      "Trabajo iniciado correctamente."
    );
  };

  const pausarVestido = () => {
    if (!sesionActual) return;

    ejecutar(
      () =>
        pausarSesionVestido(
          sesionActual.id,
          observaciones.trim()
        ),
      "Trabajo pausado correctamente."
    );
  };

  const reanudarVestido = () => {
    if (!sesionActual) return;

    ejecutar(
      () => reanudarSesionVestido(sesionActual.id),
      "Trabajo reanudado correctamente."
    );
  };

  const finalizarVestido = () => {
    if (!sesionActual) return;

    ejecutar(
      () =>
        finalizarSesionVestido(
          sesionActual.id,
          observaciones.trim()
        ),
      "Vestido finalizado correctamente."
    );
  };

  // ─── Carga inicial ──────────────────────────────────

  if (cargando) {
    return (
      <main className="flex min-h-full items-center justify-center bg-paper p-6">
        <Loader2 className="animate-spin text-gold" size={25} />
      </main>
    );
  }

  // ─── Interfaz ───────────────────────────────────────

  return (
    <main className="min-h-full bg-paper p-4 text-cocoa sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5">

        {/* ENCABEZADO */}

        <header className={cardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
                Fiancée · Taller
              </p>

              <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">
                Hola, {nombre}
              </h1>

              <p className="mt-2 flex items-center gap-2 text-sm capitalize text-cocoa-muted">
                <CalendarDays size={15} />
                {fecha}
              </p>
            </div>

            {!asistencia ? (
              <button
                type="button"
                onClick={marcarEntrada}
                disabled={procesando}
                className={`${primaryButton} w-full sm:w-auto`}
              >
                <LogIn size={17} />
                Iniciar jornada
              </button>
            ) : jornadaActiva ? (
              <span className="w-fit rounded-full border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-800">
                Jornada activa
              </span>
            ) : (
              <span className="w-fit rounded-full border border-line bg-paper px-3 py-2 text-xs font-medium text-cocoa-muted">
                Jornada finalizada
              </span>
            )}
          </div>
        </header>

        {/* ERROR */}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}

            <button
              type="button"
              onClick={() => void cargarDatos(true)}
              className="ml-2 font-semibold underline"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* ASISTENCIA */}

        {panel && (
          <section className={cardClass}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">
                Mi jornada
              </h2>

              {jornadaActiva && (
                <span className="text-xs text-green-700">
                  ● En curso
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-paper p-3">
                <p className="text-xs text-cocoa-muted">Entrada</p>
                <p className="mt-1 text-lg font-semibold">
                  {formatearHora(asistencia?.entrada)}
                </p>
              </div>

              <div className="rounded-lg bg-paper p-3">
                <p className="text-xs text-cocoa-muted">Salida</p>
                <p className="mt-1 text-lg font-semibold">
                  {formatearHora(asistencia?.salida)}
                </p>
              </div>
            </div>

            {jornadaActiva && (
              <button
                type="button"
                onClick={marcarSalida}
                disabled={procesando || !!sesionActual}
                className={`${secondaryButton} mt-4 w-full`}
              >
                <LogOut size={16} />
                Finalizar jornada
              </button>
            )}

            {jornadaActiva && sesionActual && (
              <p className="mt-2 text-center text-xs text-cocoa-muted">
                Finaliza el vestido actual antes de cerrar tu jornada.
              </p>
            )}
          </section>
        )}

        {/* TRABAJO */}

        {panel && (
          <section className={cardClass}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">
                  Mi trabajo
                </h2>

                <p className="mt-1 text-xs text-cocoa-muted">
                  Selecciona un vestido y registra tu tiempo de trabajo.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void cargarDatos()}
                disabled={procesando}
                title="Actualizar información"
                className="rounded-lg border border-line p-2 text-cocoa-muted hover:bg-paper"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            {!jornadaActiva ? (
              <div className="rounded-lg bg-paper p-4 text-center">
                <p className="text-sm text-cocoa-muted">
                  Inicia tu jornada para comenzar a trabajar.
                </p>
              </div>
            ) : sesionActual ? (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-line bg-paper p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-gold">
                      <Shirt size={21} />
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs text-cocoa-muted">
                        Vestido seleccionado
                      </p>

                      <h3 className="break-words font-semibold">
                        {sesionActual.codigo}
                      </h3>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                      sesionActual.estado === "EN_CURSO"
                        ? "bg-green-50 text-green-800"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {estadoLegible(sesionActual.estado)}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
                  <span className="flex items-center gap-2 text-cocoa-muted">
                    <Clock3 size={15} />
                    Inicio: {formatearHora(sesionActual.inicio)}
                  </span>

                  <span className="font-semibold">
                    {formatearNumero(sesionActual.horas_efectivas)} h
                  </span>
                </div>

                <label className="mt-4 block text-xs font-medium text-cocoa-muted">
                  Observaciones del proceso
                </label>

                <textarea
                  value={observaciones}
                  onChange={(event) =>
                    setObservaciones(event.target.value)
                  }
                  rows={3}
                  maxLength={1000}
                  placeholder="Describe el avance, alguna incidencia o el motivo de pausa..."
                  className={`${inputClass} mt-2 resize-none`}
                />

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {sesionActual.estado === "EN_CURSO" ? (
                    <button
                      type="button"
                      onClick={pausarVestido}
                      disabled={procesando}
                      className={secondaryButton}
                    >
                      <Pause size={16} />
                      Pausar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={reanudarVestido}
                      disabled={procesando}
                      className={secondaryButton}
                    >
                      <Play size={16} />
                      Reanudar
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={finalizarVestido}
                    disabled={procesando}
                    className={primaryButton}
                  >
                    <CheckCircle2 size={16} />
                    Finalizar
                  </button>
                </div>
              </motion.div>
            ) : (
              <div>
                {vestidos.length > 0 ? (
                  <>
                    <label
                      htmlFor="vestido"
                      className="mb-2 block text-sm font-medium"
                    >
                      ¿Qué vestido vas a trabajar?
                    </label>

                    <select
                      id="vestido"
                      value={vestidoSeleccionado}
                      onChange={(event) =>
                        setVestidoSeleccionado(event.target.value)
                      }
                      className={inputClass}
                    >
                      <option value="">
                        Selecciona un vestido disponible
                      </option>

                      {vestidos.map((vestido) => (
                        <option key={vestido.id} value={vestido.id}>
                          {vestido.codigo}
                          {vestido.tipo_vestido
                            ? ` · ${vestido.tipo_vestido}`
                            : ""}
                        </option>
                      ))}
                    </select>

                    {vestidoSeleccionado && (
                      <div className="mt-3 rounded-lg bg-paper p-3">
                        {(() => {
                          const vestido = vestidos.find(
                            (item) =>
                              item.id === Number(vestidoSeleccionado)
                          );

                          if (!vestido) return null;

                          return (
                            <>
                              <p className="text-sm font-semibold">
                                {vestido.codigo}
                              </p>

                              <p className="mt-1 text-xs text-cocoa-muted">
                                Cliente: {vestido.cliente || "No disponible"}
                              </p>

                              <p className="mt-1 text-xs text-cocoa-muted">
                                Contrato: {vestido.contrato}
                              </p>

                              {vestido.fecha_entrega && (
                                <p className="mt-1 text-xs text-cocoa-muted">
                                  Entrega: {vestido.fecha_entrega}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    <label className="mt-4 block text-xs font-medium text-cocoa-muted">
                      Observaciones iniciales
                    </label>

                    <textarea
                      value={observaciones}
                      onChange={(event) =>
                        setObservaciones(event.target.value)
                      }
                      rows={3}
                      maxLength={1000}
                      placeholder="Describe el estado inicial o indicaciones del trabajo..."
                      className={`${inputClass} mt-2 resize-none`}
                    />

                    <button
                      type="button"
                      onClick={iniciarVestido}
                      disabled={!vestidoSeleccionado || procesando}
                      className={`${primaryButton} mt-3 w-full`}
                    >
                      <Play size={16} />
                      Comenzar trabajo
                    </button>
                  </>
                ) : (
                  <div className="rounded-lg bg-paper p-6 text-center">
                    <Shirt size={28} className="mx-auto text-gold" />

                    <p className="mt-2 text-sm font-medium">
                      No hay vestidos disponibles
                    </p>

                    <p className="mt-1 text-xs text-cocoa-muted">
                      Los nuevos vestidos aparecerán aquí automáticamente.
                    </p>

                    <button
                      type="button"
                      onClick={() => void cargarDatos()}
                      className={`${secondaryButton} mt-4`}
                    >
                      <RefreshCw size={15} />
                      Actualizar
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* RESUMEN DEL DÍA */}

        {panel && (
          <section className={cardClass}>
            <h2 className="font-display text-lg font-semibold">
              Mi producción de hoy
            </h2>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-paper p-3">
                <p className="text-xs text-cocoa-muted">
                  Vestidos trabajados
                </p>

                <p className="mt-1 font-display text-2xl font-semibold">
                  {resumen?.total_vestidos ?? 0}
                </p>
              </div>

              <div className="rounded-lg bg-paper p-3">
                <p className="text-xs text-cocoa-muted">
                  Tiempo efectivo
                </p>

                <p className="mt-1 font-display text-2xl font-semibold">
                  {formatearNumero(resumen?.horas_efectivas)} h
                </p>
              </div>
            </div>

            {(
              resumen?.vestidos ??
              resumen?.sesiones ??
              []
            ).length > 0 ? (
              <div className="mt-4 divide-y divide-line">
                {(
                  resumen?.vestidos ??
                  resumen?.sesiones ??
                  []
                ).map((sesion) => (
                  <div
                    key={sesion.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {sesion.codigo}
                      </p>

                      <p className="mt-1 text-xs text-cocoa-muted">
                        {formatearHora(sesion.inicio)}
                      </p>

                      {sesion.observaciones && (
                        <p className="mt-1 break-words text-xs text-cocoa-muted">
                          {sesion.observaciones}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium">
                        {formatearNumero(sesion.horas_efectivas)} h
                      </p>

                      <p className="mt-1 text-xs text-cocoa-muted">
                        {estadoLegible(sesion.estado)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-cocoa-muted">
                Aún no hay vestidos registrados hoy.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
