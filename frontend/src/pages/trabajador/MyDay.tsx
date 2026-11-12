import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  LogIn,
  LogOut,
  MessageSquarePlus,
  Pause,
  Play,
  RefreshCw,
  Shirt,
  Star,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";

import { useNotifications } from "../../contexts/NotificationsContext";
import {
  finalizarMiJornada,
  finalizarSesionVestido,
  iniciarMiJornada,
  iniciarSesionVestido,
  obtenerMiPanel,
  obtenerResumenDiarioVestidos,
  obtenerVestidosDisponibles,
  pausarSesionVestido,
  reanudarSesionVestido,
  registrarHorasExtra,
  type PanelTaller,
  type ResumenDiarioVestidos,
  type SesionVestido,
  type VestidoDisponible,
} from "../../services/tallerApi";

// ─── Estilos ───────────────────────────────────────────

const card = "rounded-2xl border border-line bg-paper p-5 sm:p-6";

const bigPrimary =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cocoa px-5 py-3.5 text-base font-medium text-ivory transition hover:bg-[#3a281f] disabled:cursor-not-allowed disabled:opacity-50";

const bigSecondary =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 py-3.5 text-base font-medium text-cocoa transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50";

const input =
  "w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-sm text-cocoa outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/10";

// ─── Utilidades ────────────────────────────────────────

function hora(valor?: string | null) {
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

function duracion(horas?: number | string) {
  const h = Number(horas ?? 0);
  if (!Number.isFinite(h) || h <= 0) return "0 min";
  const total = Math.floor(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh} h`;
  return `${hh} h ${mm} min`;
}

function diaCorto(iso?: string) {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function diasPara(iso?: string) {
  if (!iso) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - hoy.getTime()) / 86_400_000);
}

const PRIORIDAD: Record<string, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

// ─── Pantalla ──────────────────────────────────────────

export default function MyDay() {
  const [panel, setPanel] = useState<PanelTaller | null>(null);
  const [vestidos, setVestidos] = useState<VestidoDisponible[]>([]);
  const [sesion, setSesion] = useState<SesionVestido | null>(null);
  const [resumen, setResumen] = useState<ResumenDiarioVestidos | null>(null);
  const [cargadoEn, setCargadoEn] = useState(() => Date.now());
  const [ahora, setAhora] = useState(() => Date.now());

  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  const { items: notificaciones, markRead } = useNotifications();

  const cargar = useCallback(async (inicial = false) => {
    if (inicial) setCargando(true);
    setError("");
    try {
      const [p, v, r] = await Promise.all([
        obtenerMiPanel(),
        obtenerVestidosDisponibles(),
        obtenerResumenDiarioVestidos(),
      ]);
      setPanel(p);
      setVestidos(v ?? []);
      setResumen(r);
      const delDia = r.vestidos ?? r.sesiones ?? [];
      setSesion(delDia.find((s) => s.estado === "EN_CURSO" || s.estado === "PAUSADA") ?? null);
      setCargadoEn(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la información.");
    } finally {
      if (inicial) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(true);
    const t = window.setInterval(() => void cargar(), 60_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  // Reloj para el tiempo en vivo.
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const hacer = async (accion: () => Promise<unknown>, mensaje: string) => {
    if (procesando) return false;
    setProcesando(true);
    try {
      await accion();
      toast.success(mensaje);
      await cargar();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo completar.");
      return false;
    } finally {
      setProcesando(false);
    }
  };

  // ─── Datos derivados ────────────────────────────────

  const asistencia = panel?.asistencia ?? null;
  const enJornada = !!asistencia && !asistencia.salida;
  const terminoHoy = !!asistencia?.salida;
  const horasHoy = Number(panel?.horas_programadas_hoy ?? 0);
  const nombre = panel?.trabajadora.nombre?.trim().split(/\s+/)[0] || "";

  const salidaEstimada = useMemo(() => {
    if (!asistencia?.entrada || !horasHoy) return null;
    return new Date(new Date(asistencia.entrada).getTime() + horasHoy * 3_600_000).toISOString();
  }, [asistencia?.entrada, horasHoy]);

  const horasEnSesion =
    sesion && sesion.estado === "EN_CURSO"
      ? Number(sesion.horas_efectivas ?? 0) + (ahora - cargadoEn) / 3_600_000
      : Number(sesion?.horas_efectivas ?? 0);

  const lista = useMemo(
    () =>
      [...vestidos].sort(
        (a, b) =>
          Number(!!b.asignada_a_mi) - Number(!!a.asignada_a_mi) ||
          (PRIORIDAD[a.prioridad ?? "MEDIA"] ?? 1) - (PRIORIDAD[b.prioridad ?? "MEDIA"] ?? 1) ||
          (a.fecha_entrega ?? "").localeCompare(b.fecha_entrega ?? "")
      ),
    [vestidos]
  );

  const avisosNuevos = notificaciones.filter(
    (n) => !n.read && (n.type === "ASIGNACION" || n.type === "PROCESO")
  );

  const jornadaAuto = panel?.ultima_jornada_automatica ?? null;
  const pedirExtraAuto = !!jornadaAuto && Number(jornadaAuto.horas_extra ?? 0) === 0;

  if (!cargando && !panel && /permiso|vinculad|trabajadora/i.test(error)) {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <Shirt size={32} className="mx-auto text-gold" />
        <h1 className="mt-3 font-display text-2xl font-semibold text-cocoa">Tu usuario aún no tiene ficha de personal</h1>
        <p className="mt-2 text-sm text-cocoa-muted">
          Para marcar tu jornada y ver tus vestidos, gerencia debe vincular tu usuario a tu ficha en <b>Personal</b>.
        </p>
        <button type="button" onClick={() => void cargar(true)} className={`${bigSecondary} mt-5`}>
          <RefreshCw size={16} /> Volver a intentar
        </button>
      </div>
    );
  }

  if (cargando) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-gold" size={26} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      {/* SALUDO */}
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-cocoa sm:text-4xl">
            Hola{nombre ? `, ${nombre}` : ""}
          </h1>
          <p className="mt-1 text-sm capitalize text-cocoa-muted">
            {new Intl.DateTimeFormat("es-PE", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "America/Lima",
            }).format(new Date())}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          aria-label="Actualizar"
          className="rounded-full border border-line bg-paper p-2.5 text-cocoa-muted hover:bg-cream"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}{" "}
          <button type="button" onClick={() => void cargar(true)} className="font-semibold underline">
            Reintentar
          </button>
        </div>
      )}

      {/* AVISOS DE ASIGNACIÓN */}
      {avisosNuevos.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <BellRing size={16} />
            {avisosNuevos.length === 1 ? "Tienes un aviso nuevo" : `Tienes ${avisosNuevos.length} avisos nuevos`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {avisosNuevos.slice(0, 3).map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 text-sm text-emerald-900">
                <span>
                  <span className="font-medium">{n.title}</span>
                  {n.message && <span className="block text-xs text-emerald-800">{n.message}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => void markRead(n.id)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium hover:bg-emerald-100"
                >
                  Listo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* JORNADA CERRADA SOLA */}
      {pedirExtraAuto && jornadaAuto && (
        <HorasExtraAuto
          jornada={jornadaAuto}
          procesando={procesando}
          onGuardar={(horas, motivo) =>
            hacer(() => registrarHorasExtra(horas, motivo, jornadaAuto.fecha), "Horas extra guardadas.")
          }
        />
      )}

      {/* 1. MI JORNADA */}
      <Jornada
        enJornada={enJornada}
        terminoHoy={terminoHoy}
        entrada={asistencia?.entrada}
        salida={asistencia?.salida}
        horasHoy={horasHoy}
        salidaEstimada={salidaEstimada}
        horasExtra={Number(asistencia?.horas_extra ?? 0)}
        hayVestidoAbierto={!!sesion}
        procesando={procesando}
        onEntrada={() => hacer(() => iniciarMiJornada(""), "¡Buen día! Tu entrada quedó registrada.")}
        onSalida={(extra, motivo) =>
          hacer(() => finalizarMiJornada("", extra, motivo), "Tu salida quedó registrada. ¡Hasta mañana!")
        }
      />

      {/* 2. LO QUE ESTOY HACIENDO */}
      {enJornada && sesion && (
        <EnCurso
          sesion={sesion}
          vestido={vestidos.find((v) => v.vestido_id === sesion.vestido_id || v.id === sesion.vestido_id)}
          horas={horasEnSesion}
          procesando={procesando}
          onPausar={(nota) => hacer(() => pausarSesionVestido(sesion.id, nota), "Pausado.")}
          onSeguir={() => hacer(() => reanudarSesionVestido(sesion.id), "¡A seguir!")}
          onTerminar={(nota) =>
            hacer(
              () => finalizarSesionVestido(sesion.id, nota),
              "Listo, guardamos tu avance. La jefa da por terminado el proceso."
            )
          }
        />
      )}

      {/* 3. MIS VESTIDOS */}
      {enJornada && !sesion && (
        <section className={card}>
          <h2 className="font-display text-xl font-semibold text-cocoa">¿Qué vas a trabajar?</h2>
          <p className="mt-1 text-xs text-cocoa-muted">
            Solo aparecen los vestidos de tus procesos. Los que te asignó la jefa salen primero.
          </p>

          {lista.length === 0 ? (
            <div className="mt-5 rounded-xl bg-cream/60 p-6 text-center">
              <Shirt size={28} className="mx-auto text-gold" />
              <p className="mt-2 text-sm font-medium text-cocoa">Por ahora no hay vestidos para ti</p>
              <p className="mt-1 text-xs text-cocoa-muted">
                Te llegará un aviso cuando la jefa te asigne uno.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {lista.map((v) => (
                <VestidoCard
                  key={v.id}
                  v={v}
                  procesando={procesando}
                  onEmpezar={(nota) =>
                    hacer(() => iniciarSesionVestido(v.vestido_id ?? v.id, nota), `Empezaste ${v.codigo}.`)
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 4. MI DÍA */}
      {(enJornada || terminoHoy) && (
        <section className={card}>
          <h2 className="font-display text-xl font-semibold text-cocoa">Mi día</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-cream/60 p-3">
              <p className="text-xs text-cocoa-muted">Vestidos trabajados</p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-cocoa">{resumen?.total_vestidos ?? 0}</p>
            </div>
            <div className="rounded-xl bg-cream/60 p-3">
              <p className="text-xs text-cocoa-muted">Tiempo trabajado</p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-cocoa">
                {duracion(resumen?.horas_efectivas)}
              </p>
            </div>
          </div>
          {(resumen?.vestidos ?? resumen?.sesiones ?? []).length > 0 && (
            <ul className="mt-3 divide-y divide-line text-sm">
              {(resumen?.vestidos ?? resumen?.sesiones ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="font-medium text-cocoa">{s.codigo}</span>
                    <span className="text-xs text-cocoa-muted"> · desde {hora(s.inicio)}</span>
                  </span>
                  <span className="tabular shrink-0 text-cocoa">{duracion(s.horas_efectivas)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Mi jornada ────────────────────────────────────────

function Jornada({
  enJornada,
  terminoHoy,
  entrada,
  salida,
  horasHoy,
  salidaEstimada,
  horasExtra,
  hayVestidoAbierto,
  procesando,
  onEntrada,
  onSalida,
}: {
  enJornada: boolean;
  terminoHoy: boolean;
  entrada?: string;
  salida?: string | null;
  horasHoy: number;
  salidaEstimada: string | null;
  horasExtra: number;
  hayVestidoAbierto: boolean;
  procesando: boolean;
  onEntrada: () => Promise<boolean>;
  onSalida: (horasExtra: number, motivo: string) => Promise<boolean>;
}) {
  const [cerrando, setCerrando] = useState(false);
  const [extra, setExtra] = useState("");
  const [motivo, setMotivo] = useState("");

  const estado = enJornada
    ? { texto: "Trabajando", punto: "bg-emerald-500", caja: "border-emerald-200 bg-emerald-50/60" }
    : terminoHoy
      ? { texto: "Jornada terminada", punto: "bg-sky-500", caja: "border-line bg-paper" }
      : { texto: "Aún no marcas tu entrada", punto: "bg-slate-400", caja: "border-line bg-paper" };

  return (
    <section className={`rounded-2xl border p-5 sm:p-6 ${estado.caja}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-cocoa">Mi jornada</h2>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-cocoa">
          <span className={`h-2.5 w-2.5 rounded-full ${estado.punto}`} aria-hidden="true" />
          {estado.texto}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-paper/80 p-3">
          <p className="text-[11px] text-cocoa-muted">Entrada</p>
          <p className="tabular mt-1 text-lg font-semibold text-cocoa">{hora(entrada)}</p>
        </div>
        <div className="rounded-xl bg-paper/80 p-3">
          <p className="text-[11px] text-cocoa-muted">{salida ? "Salida" : "Sales aprox."}</p>
          <p className="tabular mt-1 text-lg font-semibold text-cocoa">{hora(salida ?? (horasHoy > 0 ? salidaEstimada : null))}</p>
        </div>
        <div className="rounded-xl bg-paper/80 p-3">
          <p className="text-[11px] text-cocoa-muted">Tu horario hoy</p>
          <p className="tabular mt-1 text-lg font-semibold text-cocoa">
            {horasHoy > 0 ? `${horasHoy} h` : "Libre"}
            {horasExtra > 0 ? ` + ${horasExtra}` : ""}
          </p>
        </div>
      </div>

      {!enJornada && !terminoHoy && (
        <button type="button" onClick={() => void onEntrada()} disabled={procesando} className={`${bigPrimary} mt-4`}>
          <LogIn size={18} /> Marcar entrada
        </button>
      )}

      {enJornada && !cerrando && (
        <>
          <button
            type="button"
            onClick={() => setCerrando(true)}
            disabled={procesando}
            className={`${bigSecondary} mt-4`}
          >
            <LogOut size={18} /> Marcar salida
          </button>
          <p className="mt-2 text-center text-xs text-cocoa-muted">
            {horasHoy > 0
              ? "Si te olvidas, tu jornada se cierra sola con tu horario."
              : "Hoy es tu día libre: si te olvidas, se cierra sola a las 8 h."}
            {hayVestidoAbierto && " El vestido que tienes abierto también se cerrará."}
          </p>
        </>
      )}

      <AnimatePresence>
        {enJornada && cerrando && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-3 rounded-xl border border-line bg-paper p-4">
              <p className="text-sm font-medium text-cocoa">¿Te quedaste más tiempo de lo normal?</p>
              <div className="grid grid-cols-[7rem_1fr] gap-2">
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  inputMode="decimal"
                  aria-label="Horas extra"
                  placeholder="0 h"
                  className={`${input} tabular`}
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                />
                <input
                  aria-label="Motivo de las horas extra"
                  placeholder="Motivo (opcional)"
                  className={input}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCerrando(false)} className={bigSecondary}>
                  Volver
                </button>
                <button
                  type="button"
                  disabled={procesando}
                  onClick={() =>
                    void onSalida(Number(extra) || 0, motivo.trim()).then((ok) => {
                      if (ok) {
                        setCerrando(false);
                        setExtra("");
                        setMotivo("");
                      }
                    })
                  }
                  className={bigPrimary}
                >
                  <LogOut size={18} /> Confirmar salida
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ─── Jornada que se cerró sola ─────────────────────────

function HorasExtraAuto({
  jornada,
  procesando,
  onGuardar,
}: {
  jornada: NonNullable<PanelTaller["ultima_jornada_automatica"]>;
  procesando: boolean;
  onGuardar: (horas: number, motivo: string) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [horas, setHoras] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <TimerReset size={17} className="mt-0.5 shrink-0" />
        <span>
          El <span className="font-semibold">{diaCorto(jornada.fecha)}</span> no marcaste tu salida. Tu jornada se
          cerró sola con tu horario ({duracion(jornada.horas_trabajadas)}).
        </span>
      </p>
      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-2 rounded-lg px-2 py-1 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline"
        >
          ¿Te quedaste más? Anotar horas extra
        </button>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr_auto]">
          <input
            type="number"
            min={0}
            max={12}
            step={0.5}
            placeholder="0 h"
            aria-label="Horas extra"
            className={`${input} tabular`}
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
          />
          <input
            placeholder="Motivo"
            aria-label="Motivo"
            className={input}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <button
            type="button"
            disabled={procesando || !(Number(horas) > 0)}
            onClick={() => void onGuardar(Number(horas), motivo.trim())}
            className="rounded-xl bg-cocoa px-4 py-2.5 text-sm font-medium text-ivory disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Vestido en curso ──────────────────────────────────

function EnCurso({
  sesion,
  vestido,
  horas,
  procesando,
  onPausar,
  onSeguir,
  onTerminar,
}: {
  sesion: SesionVestido;
  vestido?: VestidoDisponible;
  horas: number;
  procesando: boolean;
  onPausar: (nota: string) => Promise<boolean>;
  onSeguir: () => Promise<boolean>;
  onTerminar: (nota: string) => Promise<boolean>;
}) {
  const [nota, setNota] = useState("");
  const [conNota, setConNota] = useState(false);
  const pausado = sesion.estado === "PAUSADA";

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-5 sm:p-6 ${pausado ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-paper"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-cocoa-muted">
        {pausado ? "En pausa" : "Estás trabajando en"}
      </p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-3xl font-semibold text-cocoa">{sesion.codigo}</h2>
          <p className="text-sm text-cocoa-muted">
            {vestido?.proceso_actual ?? "Proceso actual"}
            {vestido?.cliente ? ` · ${vestido.cliente}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular font-display text-3xl font-semibold text-cocoa">{duracion(horas)}</p>
          <p className="flex items-center justify-end gap-1 text-xs text-cocoa-muted">
            <Clock3 size={12} /> desde {hora(sesion.inicio)}
          </p>
        </div>
      </div>

      {conNota ? (
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          maxLength={1000}
          autoFocus
          placeholder="Ej.: terminé el corte, falta el forro…"
          className={`${input} mt-4 resize-none`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setConNota(true)}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-cocoa-muted hover:text-cocoa"
        >
          <MessageSquarePlus size={14} /> Agregar una nota
        </button>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {pausado ? (
          <button type="button" onClick={() => void onSeguir()} disabled={procesando} className={bigSecondary}>
            <Play size={18} /> Seguir
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onPausar(nota.trim()).then((ok) => ok && setNota(""))}
            disabled={procesando}
            className={bigSecondary}
          >
            <Pause size={18} /> Pausar
          </button>
        )}
        <button
          type="button"
          onClick={() => void onTerminar(nota.trim()).then((ok) => ok && setNota(""))}
          disabled={procesando}
          className={bigPrimary}
        >
          <CheckCircle2 size={18} /> Terminé por hoy
        </button>
      </div>
    </motion.section>
  );
}

// ─── Tarjeta de vestido disponible ─────────────────────

function VestidoCard({
  v,
  procesando,
  onEmpezar,
}: {
  v: VestidoDisponible;
  procesando: boolean;
  onEmpezar: (nota: string) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  const dias = diasPara(v.fecha_entrega);
  const urgente = v.prioridad === "ALTA" || (dias !== null && dias <= 7);
  const notas = v.observaciones ?? [];

  return (
    <li
      className={`rounded-xl border bg-paper ${
        v.asignada_a_mi ? "border-emerald-300" : "border-line"
      }`}
    >
      <div className="flex items-center gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-cocoa">{v.codigo}</span>
            {v.asignada_a_mi && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <Star size={11} /> Te asignaron
              </span>
            )}
            {urgente && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">Urgente</span>
            )}
          </p>
          <p className="mt-0.5 truncate text-sm text-cocoa-muted">
            {v.proceso_actual}
            {v.cliente ? ` · ${v.cliente}` : ""}
          </p>
          {dias !== null && (
            <p className="mt-0.5 text-xs text-cocoa-faint">
              {dias < 0 ? `Entrega pasada hace ${-dias} días` : dias === 0 ? "Se entrega hoy" : `Se entrega en ${dias} días`}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={procesando}
          onClick={() => void onEmpezar("")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-medium text-ivory hover:bg-[#3a281f] disabled:opacity-50"
        >
          <Play size={16} /> Empezar
        </button>
      </div>

      {(notas.length > 0 || v.descripcion) && (
        <>
          <button
            type="button"
            onClick={() => setAbierto((x) => !x)}
            aria-expanded={abierto}
            className="flex w-full items-center justify-between border-t border-line px-3.5 py-2 text-xs font-medium text-cocoa-muted hover:text-cocoa"
          >
            {notas.length > 0 ? `Ver indicaciones (${notas.length})` : "Ver detalle"}
            <ChevronDown size={14} className={`transition ${abierto ? "rotate-180" : ""}`} />
          </button>
          {abierto && (
            <div className="space-y-2 px-3.5 pb-3.5 text-xs">
              {v.descripcion && <p className="text-cocoa">{v.descripcion}</p>}
              {notas.map((n) => (
                <div key={n.id} className="rounded-lg bg-cream/60 p-2">
                  <p className="text-cocoa">
                    {n.tipo === "INCIDENCIA" ? "⚠ " : ""}
                    {n.texto}
                  </p>
                  <p className="mt-0.5 text-cocoa-faint">{n.autor}</p>
                  {n.imagenes.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {n.imagenes.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt="Foto del vestido" className="h-14 w-14 rounded-md border border-line object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </li>
  );
}
