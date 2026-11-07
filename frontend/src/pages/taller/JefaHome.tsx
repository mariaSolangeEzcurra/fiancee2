import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClockIcon,
  CalendarCheck2Icon,
  CircleAlertIcon,
  GaugeIcon,
  RefreshCwIcon,
  ShirtIcon,
  UserRoundPlusIcon,
  UsersIcon,
} from 'lucide-react';

import { ProductionDressDrawer } from '../../components/production/ProductionDressDrawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { WhatsAppButton } from '../../components/ui/WhatsAppButton';
import { useAuth } from '../../contexts/AuthContext';
import { useProduction } from '../../hooks/useProduction';
import { dressTone, prodTotals, todayISO, TONE_STYLES } from '../../services/productionApi';
import type { DressTone, ProdDress } from '../../services/productionApi';
import { AREA_STYLE, horaCorta, staffApi, TODAY_STYLE } from '../../services/staffApi';
import type { CapacityWeek, StaffMember } from '../../services/staffApi';
import { fmtDate } from '../../utils/dates';
import { cn, fmtH } from '../../utils/format';

const PRIORIDAD = { Alta: 0, Media: 1, Baja: 2 } as const;
const PESO: Record<DressTone, number> = { late: 0, risk: 1, progress: 2, idle: 3, done: 4 };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

function diasHasta(iso: string) {
  const hoy = new Date(`${todayISO()}T00:00:00`).getTime();
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - hoy) / 86_400_000);
}

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** Inicio de la jefa de taller: lo importante del día y del mes. */
export function JefaHome() {
  const store = useProduction();
  const { dresses, reminders, loading, reload } = store;
  const { user } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [cap, setCap] = useState<CapacityWeek | null>(null);

  const cargarExtras = () => {
    staffApi.list().then(setStaff).catch(() => undefined);
    staffApi.capacity(0).then(setCap).catch(() => undefined);
  };
  useEffect(cargarExtras, []);

  const hoy = todayISO();
  const mesActual = hoy.slice(0, 7);
  const active = useMemo(() => dresses.filter((d) => d.status !== 'Terminado'), [dresses]);

  // ─── Números ───────────────────────────────────────
  const delMes = dresses.filter((d) => d.deadline.slice(0, 7) === mesActual);
  const listosMes = delMes.filter((d) => d.status === 'Terminado').length;
  const semana = active.filter((d) => {
    const n = diasHasta(d.deadline);
    return n >= 0 && n <= 7;
  });
  const atrasados = active.filter((d) => dressTone(d) === 'late');
  const trabajando = staff.filter((w) => w.today.status === 'TRABAJANDO');
  const lesToca = staff.filter((w) => w.today.status !== 'DESCANSO' && w.today.status !== 'PERMISO');
  const sinMarcar = staff.filter((w) => w.today.status === 'SIN_MARCAR');

  // ─── Distribución por estado ───────────────────────
  const conteo = useMemo(() => {
    const c: Record<DressTone, number> = { idle: 0, progress: 0, risk: 0, late: 0, done: 0 };
    for (const d of active) c[dressTone(d)] += 1;
    return c;
  }, [active]);

  // ─── Lo más urgente ────────────────────────────────
  const urgentes = useMemo(
    () =>
      [...active]
        .sort(
          (a, b) =>
            PESO[dressTone(a)] - PESO[dressTone(b)] ||
            PRIORIDAD[a.priority] - PRIORIDAD[b.priority] ||
            a.deadline.localeCompare(b.deadline)
        )
        .slice(0, 6),
    [active]
  );

  // ─── Entregas por mes (este y los 2 siguientes) ────
  const meses = useMemo(() => {
    const [y, m] = mesActual.split('-').map(Number);
    return [0, 1, 2].map((i) => {
      const d = new Date(y, m - 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lista = dresses.filter((x) => x.deadline.slice(0, 7) === key);
      return {
        key,
        nombre: MESES[d.getMonth()],
        total: lista.length,
        listos: lista.filter((x) => x.status === 'Terminado').length,
        proceso: lista.filter((x) => x.status === 'En proceso').length,
        sinIniciar: lista.filter((x) => x.status === 'Sin iniciar').length,
        horas: lista.reduce((s, x) => s + prodTotals(x).remaining, 0),
      };
    });
  }, [dresses, mesActual]);

  // ─── Pendientes de hoy ─────────────────────────────
  const sinAsignar = active.filter((d) => {
    const s = d.steps[d.currentIndex];
    return s && !s.isDelivery && s.timeType === 'TRABAJO' && s.workerIds.length === 0;
  });
  const avisos = reminders.filter((r) => r.due || r.daysLeft <= 2);

  const pendientes = (sinAsignar.length > 0 || avisos.length > 0) && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlarmClockIcon className="h-4 w-4" /> Pendientes de hoy
              </h2>
              <ul className="mt-3 space-y-1.5">
                {sinAsignar.slice(0, 4).map((d) => (
                  <Pendiente key={`a-${d.id}`} onClick={() => setOpenId(d.id)} icon={<UserRoundPlusIcon className="h-4 w-4" />}>
                    Asignar personal a <b>{d.code}</b> · {d.steps[d.currentIndex]?.name}
                  </Pendiente>
                ))}
                {avisos.slice(0, 4).map((r) => (
                  <Pendiente key={`r-${r.dressId}-${r.type}`} onClick={() => r.dressId && setOpenId(r.dressId)} icon={<AlarmClockIcon className="h-4 w-4" />}>
                    {r.type === 'BORDADO' ? 'Empezar bordado' : 'Coordinar 1.ª prueba'} de <b>{r.code}</b>
                    {r.due ? ' · ya toca' : ` · en ${r.daysLeft} día(s)`}
                  </Pendiente>
                ))}
                {sinAsignar.length + avisos.length > 8 && (
                  <li className="text-xs text-amber-900">Y {sinAsignar.length + avisos.length - 8} más…</li>
                )}
              </ul>
            </section>
          );

  const nombre = user?.nombre?.trim()?.split(/\s+/)[0] || user?.username || '';
  const areasCargadas = (cap?.areas ?? []).filter((a) => a.status !== 'CON_ESPACIO' && a.status !== 'LIBRE').slice(0, 3);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${saludo()}${nombre ? `, ${nombre}` : ''}`}
        subtitle={new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={
          <button
            type="button"
            onClick={() => {
              void reload();
              cargarExtras();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm font-medium text-cocoa hover:bg-cream"
          >
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} /> Actualizar
          </button>
        }
      />

      {/* 4 números clave */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<CalendarCheck2Icon className="h-4 w-4" />}
          label={`Entregas de ${MESES[Number(mesActual.slice(5)) - 1]}`}
          value={delMes.length}
          foot={`${listosMes} listo(s) · ${delMes.length - listosMes} por terminar`}
          to="/taller/vestidos"
        />
        <Kpi
          icon={<ShirtIcon className="h-4 w-4" />}
          label="Se entregan esta semana"
          value={semana.length}
          foot={semana.length ? `La primera: ${fmtDate(semana.map((d) => d.deadline).sort()[0])}` : 'Ninguna en 7 días'}
          to="/taller/vestidos"
        />
        <Kpi
          icon={<UsersIcon className="h-4 w-4" />}
          label="Trabajando ahorita"
          value={staff.length ? `${trabajando.length} de ${lesToca.length}` : '—'}
          foot={sinMarcar.length ? `${sinMarcar.length} aún no marca(n) entrada` : 'Todas marcaron'}
          tone={sinMarcar.length ? 'risk' : undefined}
          to="/taller/personal"
        />
        <Kpi
          icon={<CircleAlertIcon className="h-4 w-4" />}
          label="Atrasados"
          value={atrasados.length}
          foot={atrasados.length ? 'Revísalos primero' : '¡Ninguno!'}
          tone={atrasados.length ? 'bad' : 'ok'}
          to="/taller/vestidos"
        />
      </div>

      {/* Cómo están los vestidos */}
      {active.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-cocoa">Cómo están los {active.length} vestidos pendientes</h2>
            <Link to="/taller/vestidos" className="text-xs font-medium text-gold hover:underline">
              Ver todos
            </Link>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-sand/50">
            {(['late', 'risk', 'progress', 'idle'] as DressTone[]).map((t) =>
              conteo[t] ? (
                <div key={t} className={TONE_STYLES[t].dot} style={{ width: `${(conteo[t] / active.length) * 100}%` }} title={`${TONE_STYLES[t].label}: ${conteo[t]}`} />
              ) : null
            )}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-cocoa-muted">
            {(['late', 'risk', 'progress', 'idle'] as DressTone[]).map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', TONE_STYLES[t].dot)} />
                {TONE_STYLES[t].label} <span className="tabular font-semibold text-cocoa">{conteo[t]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          <div className="lg:hidden">{pendientes}</div>

          {/* Lo más urgente */}
          <section>
            <h2 className="font-display text-2xl font-semibold text-cocoa">Lo más urgente</h2>
            {urgentes.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-line bg-paper p-8 text-center text-sm text-cocoa-faint">
                {loading ? 'Cargando…' : 'No hay vestidos pendientes. ¡Todo al día!'}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {urgentes.map((d) => (
                  <DressRow key={d.id} d={d} onOpen={() => setOpenId(d.id)} />
                ))}
              </ul>
            )}
          </section>

          {/* Entregas por mes */}
          <section>
            <h2 className="font-display text-2xl font-semibold text-cocoa">Entregas por mes</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {meses.map((m, i) => (
                <div key={m.key} className={cn('rounded-2xl border bg-paper p-4', i === 0 ? 'border-gold-soft' : 'border-line')}>
                  <p className="text-xs font-medium text-cocoa-muted">
                    <span className="capitalize">{m.nombre}</span>
                    {i === 0 && ' · este mes'}
                  </p>
                  <p className="tabular mt-1 text-2xl font-semibold text-cocoa">
                    {m.total} <span className="text-sm font-normal text-cocoa-muted">vestido(s)</span>
                  </p>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-sand/50">
                    {m.total > 0 && (
                      <>
                        <div className="bg-sky-500" style={{ width: `${(m.listos / m.total) * 100}%` }} />
                        <div className="bg-emerald-500" style={{ width: `${(m.proceso / m.total) * 100}%` }} />
                        <div className="bg-slate-300" style={{ width: `${(m.sinIniciar / m.total) * 100}%` }} />
                      </>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-cocoa-muted">
                    {m.total === 0
                      ? 'Sin entregas todavía'
                      : `${m.listos} listos · ${m.proceso} en proceso · ${m.sinIniciar} sin iniciar`}
                  </p>
                  {m.horas > 0 && <p className="tabular text-[11px] text-cocoa-faint">Faltan {fmtH(m.horas)} de trabajo</p>}
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <div className="hidden lg:block">{pendientes}</div>

          {/* Ahorita en el taller */}
          <section className="rounded-2xl border border-line bg-paper p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-cocoa">Ahorita en el taller</h2>
              <Link to="/taller/personal" className="text-xs font-medium text-gold hover:underline">
                Personal
              </Link>
            </div>
            {staff.length === 0 ? (
              <p className="mt-3 text-sm text-cocoa-faint">Cargando…</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {trabajando.slice(0, 6).map((w) => {
                  const st = TODAY_STYLE[w.today.status];
                  return (
                    <li key={w.id} className="flex items-center gap-3">
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blush-soft text-[11px] font-semibold text-blush-deep">
                        {w.initials}
                        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-paper', st.dot)} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-cocoa">{w.name}</span>
                        <span className="block truncate text-xs text-cocoa-muted">
                          {w.today.status === 'TRABAJANDO'
                            ? w.activeSession
                              ? `${w.activeSession.paused ? 'En pausa' : 'Trabajando'} en ${w.activeSession.dress}`
                              : `Entró ${horaCorta(w.today.checkIn)} · sin vestido abierto`
                            : 'Aún no marca su entrada'}
                        </span>
                      </span>
                    </li>
                  );
                })}
                {trabajando.length === 0 && <li className="text-sm text-cocoa-faint">Nadie trabajando en este momento.</li>}
                {sinMarcar.length > 0 && (
                  <li className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-semibold">Aún no marcan ({sinMarcar.length}):</span>{' '}
                    {sinMarcar.map((w) => w.name).join(', ')}
                  </li>
                )}
              </ul>
            )}
          </section>

          {/* Áreas apretadas */}
          {cap && (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-cocoa">
                  <GaugeIcon className="h-4 w-4 text-gold" /> Esta semana
                </h2>
                <Link to="/taller/capacidad" className="text-xs font-medium text-gold hover:underline">
                  Capacidad
                </Link>
              </div>
              {areasCargadas.length === 0 ? (
                <p className="mt-2 text-sm text-emerald-800">Todas las áreas tienen espacio. 👌</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {areasCargadas.map((a) => {
                    const st = AREA_STYLE[a.status];
                    return (
                      <li key={a.code}>
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-cocoa">{a.name}</span>
                          <span className={cn('rounded-full px-1.5 font-semibold', st.chip)}>
                            {st.label} · {fmtH(a.free)} libres
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand/60">
                          <div className={cn('h-full rounded-full', st.bar)} style={{ width: `${Math.min(100, a.utilization * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>

      <ProductionDressDrawer dressId={openId} onClose={() => setOpenId(null)} store={store} />
    </div>
  );
}

function DressRow({ d, onOpen }: { d: ProdDress; onOpen: () => void }) {
  const tone = TONE_STYLES[dressTone(d)];
  const days = diasHasta(d.deadline);
  const step = d.steps[d.currentIndex];
  const nombre = d.client.split(/\s+/)[0] || '';
  return (
    <li className={cn('flex items-center gap-3 rounded-xl border border-l-4 border-line bg-paper px-3 py-3', tone.row)}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="w-12 shrink-0 text-center">
          <span className={cn('tabular block text-xl font-semibold leading-none', days < 0 ? 'text-rose-700' : 'text-cocoa')}>
            {Math.abs(days)}
          </span>
          <span className="block text-[10px] leading-tight text-cocoa-muted">{days < 0 ? 'días tarde' : days === 1 ? 'día' : 'días'}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-cocoa">
            <span className="font-semibold">{d.code}</span> · {d.client}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', tone.chip)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} /> {tone.label}
            </span>
            <span className="truncate text-cocoa-muted">
              {step?.name ?? '—'}
              {d.activeSession ? ` · ${d.activeSession.worker}` : step?.workers.length ? ` · ${step.workers.join(', ')}` : ' · sin asignar'}
            </span>
            {d.priority === 'Alta' && <span className="rounded-full bg-bad-soft px-1.5 py-0.5 font-semibold text-bad">Alta</span>}
          </span>
        </span>
      </button>
      <WhatsAppButton
        phone={d.clientPhone}
        text={`Hola ${nombre}, te escribimos del taller de Fiancée sobre tu vestido (${d.code}).`}
      />
    </li>
  );
}

function Kpi({
  icon,
  label,
  value,
  foot,
  tone,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  foot: string;
  tone?: 'risk' | 'bad' | 'ok';
  to: string;
}) {
  return (
    <Link to={to} className="rounded-2xl border border-line bg-paper p-4 transition-colors hover:bg-cream/50">
      <p className="flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
        <span className="text-gold">{icon}</span> {label}
      </p>
      <p
        className={cn(
          'tabular mt-1 text-2xl font-semibold',
          tone === 'bad' ? 'text-rose-700' : tone === 'risk' ? 'text-amber-800' : tone === 'ok' ? 'text-emerald-700' : 'text-cocoa'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-cocoa-muted">{foot}</p>
    </Link>
  );
}

function Pendiente({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-start gap-2 rounded-lg bg-paper px-3 py-2 text-left text-sm text-cocoa hover:bg-cream">
        <span className="mt-0.5 shrink-0 text-amber-700">{icon}</span>
        <span className="min-w-0">{children}</span>
      </button>
    </li>
  );
}
