import { useEffect, useState } from 'react';
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  ClockIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  ShirtIcon,
  TimerResetIcon,
} from 'lucide-react';

import {
  DAY_STYLE,
  diaSemana,
  fechaCorta,
  horaCorta,
  horas,
  staffApi,
  TODAY_STYLE,
} from '../../services/staffApi';
import type { HistoryDay, StaffDetail, StaffMember } from '../../services/staffApi';
import { cn } from '../../utils/format';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Segmented';

type Tab = 'resumen' | 'historial';
type Range = '7' | '30' | '90';

/** Ficha de una trabajadora: horario, habilidades e historial (solo lectura). */
export function WorkerModal({
  workerId,
  member,
  onClose,
}: {
  workerId: string | null;
  member?: StaffMember;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [range, setRange] = useState<Range>('30');
  const [data, setData] = useState<StaffDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab('resumen');
    setRange('30');
  }, [workerId]);

  useEffect(() => {
    if (!workerId) return;
    let alive = true;
    setLoading(true);
    setError('');
    staffApi
      .detail(workerId, Number(range))
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [workerId, range]);

  const shown = data && data.id === workerId ? data : null;
  const today = member?.today;
  const todayStyle = today ? TODAY_STYLE[today.status] : null;

  return (
    <Modal
      open={!!workerId}
      onClose={onClose}
      title={shown?.name ?? member?.name ?? 'Trabajadora'}
      icon={
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blush-soft text-sm font-semibold text-blush-deep">
          {shown?.initials ?? member?.initials}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{shown?.area ?? member?.area}</span>
          {todayStyle && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', todayStyle.chip)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', todayStyle.dot)} aria-hidden="true" />
              {todayStyle.label}
              {today?.checkIn ? ` · entró ${horaCorta(today.checkIn)}` : ''}
            </span>
          )}
        </span>
      }
    >
      <nav role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {(
          [
            { id: 'resumen', label: 'Resumen', icon: CalendarDaysIcon },
            { id: 'historial', label: 'Días trabajados', icon: HistoryIcon },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              tab === t.id ? 'border-cocoa text-cocoa' : 'border-transparent text-cocoa-muted hover:text-cocoa'
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {!shown && loading && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-cocoa-muted">
          <Loader2Icon className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      )}

      {shown && tab === 'resumen' && <Resumen d={shown} member={member} />}

      {shown && tab === 'historial' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-64">
              <Segmented<Range>
                ariaLabel="Periodo"
                value={range}
                onChange={setRange}
                options={[
                  { value: '7', label: '7 días' },
                  { value: '30', label: '30 días' },
                  { value: '90', label: '3 meses' },
                ]}
              />
            </div>
            {loading && <Loader2Icon className="h-4 w-4 animate-spin text-cocoa-muted" />}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Días trabajados" value={String(shown.totals.daysWorked)} />
            <Mini label="Horas" value={horas(shown.totals.hours)} />
            <Mini label="Horas extra" value={horas(shown.totals.extraHours)} />
            <Mini label="Faltó" value={String(shown.totals.missed)} tone={shown.totals.missed ? 'bad' : undefined} />
          </div>
          {(shown.totals.autoClosed > 0 || shown.totals.absences > 0) && (
            <p className="text-xs text-cocoa-muted">
              {shown.totals.autoClosed > 0 && `${shown.totals.autoClosed} día(s) no marcó su salida (se cerró con su horario). `}
              {shown.totals.absences > 0 && `${shown.totals.absences} día(s) con permiso.`}
            </p>
          )}

          {shown.history.length === 0 ? (
            <p className="rounded-2xl bg-cream/60 p-8 text-center text-sm text-cocoa-faint">Sin registros en este periodo.</p>
          ) : (
            <ul className="space-y-2">
              {shown.history.map((day) => (
                <DayRow key={day.date} day={day} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

function Resumen({ d, member }: { d: StaffDetail; member?: StaffMember }) {
  const max = Math.max(8, ...d.schedule.map((s) => s.hours));
  const hoy = (new Date().getDay() + 6) % 7;
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-cocoa">Su horario</h3>
          <span className="tabular text-xs text-cocoa-muted">{horas(d.weekHours)} a la semana</span>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {d.schedule.map((s) => (
            <div
              key={s.day}
              className={cn(
                'flex flex-col items-center rounded-xl border px-1 py-2',
                s.day === hoy ? 'border-gold-soft bg-champagne-soft/50' : 'border-line bg-paper'
              )}
              title={`${s.longLabel}: ${horas(s.hours)}`}
            >
              <span className="text-[11px] font-medium text-cocoa-muted">{s.label}</span>
              <div className="mt-2 flex h-14 w-3 items-end overflow-hidden rounded-full bg-sand/60">
                <div className="w-full rounded-full bg-cocoa/70" style={{ height: `${(s.hours / max) * 100}%` }} />
              </div>
              <span className={cn('tabular mt-1.5 text-xs font-semibold', s.hours ? 'text-cocoa' : 'text-cocoa-faint')}>
                {s.hours ? `${s.hours} h` : 'Libre'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {member && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Mini label="Esta semana" value={`${horas(member.weekWorked)}`} sub={`de ${horas(member.weekHours)}`} />
          <Mini label="Vestidos asignados" value={String(member.assignedDresses)} />
          <Mini
            label="Ahora"
            value={member.activeSession ? member.activeSession.dress : '—'}
            sub={member.activeSession ? `${member.activeSession.paused ? 'En pausa' : 'Trabajando'} · ${member.activeSession.process}` : 'Sin vestido abierto'}
          />
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-cocoa">Lo que sabe hacer</h3>
        {d.skills.length === 0 ? (
          <p className="mt-2 text-sm text-cocoa-faint">Aún no tiene procesos asignados. Pídele a gerencia que los agregue.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.skills.map((s) => (
              <span key={s.id} className="rounded-full border border-line bg-paper px-2.5 py-1 text-xs capitalize text-cocoa">
                {s.name}
                <span className="text-cocoa-faint"> · {s.area}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {d.absences.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-cocoa">Permisos y vacaciones</h3>
          <ul className="mt-2 space-y-1.5">
            {d.absences.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900">
                <span>
                  {fechaCorta(a.from)}
                  {a.to !== a.from ? ` al ${fechaCorta(a.to)}` : ''}
                  {a.reason ? ` · ${a.reason}` : ''}
                </span>
                <span className="tabular text-xs">{horas(a.hours)}/día</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.notes && (
        <section className="rounded-xl bg-cream/60 p-3 text-sm text-cocoa">
          <p className="text-xs font-semibold text-cocoa-muted">Observaciones</p>
          <p className="mt-1 whitespace-pre-line">{d.notes}</p>
        </section>
      )}
    </div>
  );
}

function DayRow({ day }: { day: HistoryDay }) {
  const [open, setOpen] = useState(false);
  const style = DAY_STYLE[day.status];
  const notas = [day.notesIn, day.notesOut].filter(Boolean);
  const detalle = day.sessions.length > 0 || notas.length > 0 || !!day.extraReason;
  const trabajo = day.status !== 'NO_VINO' && day.status !== 'PERMISO';

  return (
    <li className="rounded-xl border border-line bg-paper">
      <button
        type="button"
        onClick={() => detalle && setOpen((v) => !v)}
        aria-expanded={detalle ? open : undefined}
        className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left', detalle && 'hover:bg-cream/50')}
      >
        <span className="w-12 shrink-0 text-center">
          <span className="block text-[11px] capitalize text-cocoa-muted">{diaSemana(day.date)}</span>
          <span className="tabular block text-sm font-semibold text-cocoa">{fechaCorta(day.date)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', style.chip)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden="true" />
            {style.label}
          </span>
          <span className="mt-0.5 block truncate text-xs text-cocoa-muted">
            {trabajo
              ? `${horaCorta(day.checkIn)} – ${day.checkOut ? horaCorta(day.checkOut) : 'ahora'}`
              : day.status === 'PERMISO'
                ? day.absence?.reason || 'Permiso registrado'
                : `Tenía ${horas(day.scheduled)} programadas`}
            {day.sessions.length > 0 && ` · ${day.sessions.length} vestido(s)`}
          </span>
        </span>
        {trabajo && (
          <span className="shrink-0 text-right">
            <span className="tabular block text-sm font-semibold text-cocoa">{horas(day.hours)}</span>
            {!!day.extra && <span className="tabular block text-[11px] font-medium text-gold">+{horas(day.extra)} extra</span>}
          </span>
        )}
        {detalle && (
          <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-cocoa-faint transition', open && 'rotate-180')} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-line px-3 py-3 text-xs">
          {day.sessions.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg bg-cream/60 px-2.5 py-2">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium text-cocoa">
                  <ShirtIcon className="h-3.5 w-3.5" aria-hidden="true" /> {s.dress}
                  {s.process && <span className="font-normal text-cocoa-muted">· {s.process}</span>}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-cocoa-muted">
                  <ClockIcon className="h-3 w-3" aria-hidden="true" />
                  {horaCorta(s.start)} – {s.end ? horaCorta(s.end) : 'ahora'}
                  {s.pauses > 0 && ` · ${s.pauses} pausa(s)`}
                </span>
                {s.notes && <span className="mt-0.5 block whitespace-pre-line text-cocoa-muted">{s.notes}</span>}
              </span>
              <span className="tabular shrink-0 font-semibold text-cocoa">{horas(s.hours)}</span>
            </div>
          ))}
          {day.extraReason && (
            <p className="flex items-start gap-1.5 text-cocoa">
              <TimerResetIcon className="mt-0.5 h-3.5 w-3.5 text-gold" aria-hidden="true" /> Horas extra: {day.extraReason}
            </p>
          )}
          {notas.map((n, i) => (
            <p key={i} className="flex items-start gap-1.5 text-cocoa-muted">
              <MessageSquareTextIcon className="mt-0.5 h-3.5 w-3.5" aria-hidden="true" /> {n}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <div className="rounded-xl bg-cream/60 px-3 py-2.5">
      <p className="text-[11px] text-cocoa-muted">{label}</p>
      <p className={cn('tabular mt-0.5 truncate text-lg font-semibold', tone === 'bad' ? 'text-rose-700' : 'text-cocoa')}>{value}</p>
      {sub && <p className="truncate text-[11px] text-cocoa-faint">{sub}</p>}
    </div>
  );
}
