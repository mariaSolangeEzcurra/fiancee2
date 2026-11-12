import { useCallback, useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, CircleHelpIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';

import { WorkerModal } from '../../components/staff/WorkerModal';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { fechaCorta, staffApi } from '../../services/staffApi';
import type { AreaCapacity, CapacityWeek } from '../../services/staffApi';
import { cn } from '../../utils/format';

type Week = 0 | 1 | 2 | 3;

/** Semáforo sencillo según qué tan ocupada está una área. */
type Luz = 'verde' | 'ambar' | 'rojo' | 'gris';

const LUZ: Record<Luz, { titulo: string; frase: string; punto: string; chip: string; barra: string; caja: string }> = {
  verde: {
    titulo: 'Hay espacio',
    frase: 'Se puede recibir más trabajo.',
    punto: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-800',
    barra: 'bg-emerald-500',
    caja: 'border-emerald-200 bg-emerald-50/60',
  },
  ambar: {
    titulo: 'Casi lleno',
    frase: 'Queda poco espacio: cuidado con recibir más.',
    punto: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800',
    barra: 'bg-amber-500',
    caja: 'border-amber-200 bg-amber-50/60',
  },
  rojo: {
    titulo: 'Lleno',
    frase: 'No hay espacio: un trabajo nuevo se tendría que mover a otra semana.',
    punto: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700',
    barra: 'bg-rose-500',
    caja: 'border-rose-200 bg-rose-50/60',
  },
  gris: {
    titulo: 'Sin personal',
    frase: 'Nadie tiene asignados los procesos de esta área.',
    punto: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-700',
    barra: 'bg-slate-400',
    caja: 'border-line bg-paper',
  },
};

function luzDe(uso: number, capacidad: number): Luz {
  if (capacidad <= 0) return 'gris';
  if (uso >= 0.95) return 'rojo';
  if (uso >= 0.8) return 'ambar';
  return 'verde';
}

/** "30 h" → "unos 4 días de trabajo de una persona" (jornada de 8 h). */
function enDias(horas: number): string {
  const dias = horas / 8;
  if (horas <= 0) return 'nada de tiempo libre';
  if (dias < 1) return `menos de 1 día de trabajo de una persona`;
  const n = Math.round(dias);
  return `unos ${n} día${n === 1 ? '' : 's'} de trabajo de una persona`;
}

function h(n: number) {
  return `${Math.round(n)} h`;
}

const SEMANAS: { value: Week; label: string }[] = [
  { value: 0, label: 'Esta semana' },
  { value: 1, label: 'Próxima semana' },
  { value: 2, label: 'En 2 semanas' },
  { value: 3, label: 'En 3 semanas' },
];

/** Capacidad del taller en lenguaje sencillo: ¿hay espacio o no? */
export function Capacity() {
  const [week, setWeek] = useState<Week>(0);
  const [data, setData] = useState<CapacityWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [areaCode, setAreaCode] = useState<string | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [ayuda, setAyuda] = useState(false);

  const load = useCallback(async (w: Week) => {
    setLoading(true);
    setError('');
    try {
      setData(await staffApi.capacity(w));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la capacidad.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(week);
  }, [week, load]);

  const t = data?.totals;
  const libre = t ? Math.max(0, t.capacity - t.busy) : 0;
  const uso = t && t.capacity ? t.busy / t.capacity : 0;
  const luzGeneral = t ? luzDe(uso, t.capacity) : 'gris';
  // Si un área está llena, eso manda: un vestido nuevo tendrá que esperar ahí.
  const llenas = (data?.areas ?? []).filter((a) => a.busy > 0 && luzDe(a.utilization, a.capacity) === 'rojo');
  const casi = (data?.areas ?? []).filter((a) => a.busy > 0 && luzDe(a.utilization, a.capacity) === 'ambar');
  const luz: Luz = luzGeneral === 'verde' && llenas.length ? 'ambar' : luzGeneral;
  const nombres = (xs: { name: string }[]) => xs.map((a) => a.name.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1');
  const area = data?.areas.find((a) => a.code === areaCode) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Capacidad del taller" subtitle="¿Cuánto trabajo más puede recibir el taller? Se calcula con el horario de cada persona." />

      {/* Semana */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {SEMANAS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setWeek(s.value)}
            className={cn(
              'whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              week === s.value ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted hover:text-cocoa'
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(week)}
          aria-label="Actualizar"
          className="ml-auto rounded-full border border-line bg-paper p-2 text-cocoa hover:bg-cream"
        >
          <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {/* Respuesta general */}
      {t && data && (
        <section className={cn('rounded-2xl border p-5 sm:p-6', LUZ[luz].caja, loading && 'opacity-60')}>
          <p className="text-sm text-cocoa-muted">
            Del {fechaCorta(data.from)} al {fechaCorta(data.to)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className={cn('h-4 w-4 rounded-full', LUZ[luz].punto)} aria-hidden="true" />
            <h2 className="font-display text-3xl font-semibold text-cocoa">
              {luzGeneral === 'verde' && llenas.length ? 'Hay espacio, pero no en todas las áreas' : LUZ[luz].titulo}
            </h2>
          </div>
          <p className="mt-2 text-base text-cocoa">
            El taller está ocupado al <b>{Math.round(uso * 100)}%</b>. Quedan <b>{h(libre)} libres</b>, o sea {enDias(libre)}.
          </p>
          {llenas.length > 0 && (
            <p className="mt-2 rounded-lg bg-paper/80 px-3 py-2 text-sm text-rose-800">
              <b>Ojo:</b> {nombres(llenas)} {llenas.length === 1 ? 'está llena' : 'están llenas'}. Un vestido nuevo que pase por ahí
              tendría que esperar a la próxima semana.
            </p>
          )}
          {llenas.length === 0 && casi.length > 0 && (
            <p className="mt-2 rounded-lg bg-paper/80 px-3 py-2 text-sm text-amber-900">
              {nombres(casi)} {casi.length === 1 ? 'está casi llena' : 'están casi llenas'}.
            </p>
          )}
          <div className="mt-4 h-4 overflow-hidden rounded-full bg-paper">
            <div className={cn('h-full rounded-full transition-all', LUZ[luz].barra)} style={{ width: `${Math.min(100, uso * 100)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-cocoa-muted">
            <span>Ocupado: {h(t.busy)}</span>
            <span>Total del personal: {h(t.capacity)}</span>
          </div>
        </section>
      )}

      {/* Cómo se lee */}
      <section className="rounded-2xl border border-line bg-paper">
        <button type="button" onClick={() => setAyuda((v) => !v)} aria-expanded={ayuda} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-cocoa">
          <CircleHelpIcon className="h-4 w-4 text-gold" /> ¿Cómo se calcula?
          <ChevronDownIcon className={cn('ml-auto h-4 w-4 text-cocoa-faint transition', ayuda && 'rotate-180')} />
        </button>
        {ayuda && (
          <ul className="space-y-1.5 border-t border-line px-4 py-3 text-sm text-cocoa-muted">
            <li>
              <b className="text-cocoa">Total del personal:</b> la suma de las horas que cada persona trabaja en la semana según su horario (sin contar
              permisos ni vacaciones).
            </li>
            <li>
              <b className="text-cocoa">Ocupado:</b> las horas que ya están separadas para los vestidos de los contratos.
            </li>
            <li>
              <b className="text-cocoa">Libre:</b> lo que queda. Es el espacio para trabajos nuevos.
            </li>
            <li>
              <b className="text-cocoa">Semáforo:</b> verde = hay espacio · ámbar = más del 80% ocupado · rojo = lleno.
            </li>
          </ul>
        )}
      </section>

      {/* Por área */}
      {data && (
        <section className={cn(loading && 'opacity-60')}>
          <h2 className="font-display text-2xl font-semibold text-cocoa">Por área</h2>
          <p className="mb-3 text-sm text-cocoa-muted">Toca un área para ver quiénes trabajan ahí y qué días tienen espacio.</p>
          <ul className="space-y-2">
            {data.areas.map((a) => (
              <AreaRow key={a.code} a={a} onOpen={() => setAreaCode(a.code)} />
            ))}
          </ul>
        </section>
      )}

      {loading && !data && (
        <p className="flex items-center gap-2 p-6 text-sm text-cocoa-muted">
          <RefreshCwIcon className="h-4 w-4 animate-spin" /> Calculando…
        </p>
      )}

      <AreaModal area={area} onClose={() => setAreaCode(null)} onWorker={setWorkerId} />
      <WorkerModal workerId={workerId} onClose={() => setWorkerId(null)} />
    </div>
  );
}

function AreaRow({ a, onOpen }: { a: AreaCapacity; onOpen: () => void }) {
  const luz = luzDe(a.utilization, a.capacity);
  const L = LUZ[luz];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-paper px-4 py-3.5 text-left transition-colors hover:bg-cream/50 sm:grid-cols-[11rem_1fr_9rem_auto]"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-cocoa">{a.name}</span>
          <span className="flex items-center gap-1 text-xs text-cocoa-muted">
            <UsersIcon className="h-3 w-3" aria-hidden="true" />
            {a.people} {a.people === 1 ? 'persona' : 'personas'}
          </span>
        </span>
        <span className={cn('inline-flex items-center gap-1.5 justify-self-end rounded-full px-2.5 py-1 text-xs font-semibold sm:hidden', L.chip)}>
          <span className={cn('h-2 w-2 rounded-full', L.punto)} /> {L.titulo}
        </span>
        <span className="col-span-2 sm:col-span-1">
          <span className="block h-3 overflow-hidden rounded-full bg-sand/60">
            <span className={cn('block h-full rounded-full', L.barra)} style={{ width: `${Math.min(100, a.utilization * 100)}%` }} />
          </span>
          <span className="mt-1 block text-[11px] text-cocoa-muted">{a.capacity > 0 ? `${Math.round(a.utilization * 100)}% ocupado` : 'Sin horas disponibles'}</span>
        </span>
        <span className="hidden text-right sm:block">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', L.chip)}>
            <span className={cn('h-2 w-2 rounded-full', L.punto)} /> {L.titulo}
          </span>
          <span className="tabular mt-1 block text-xs text-cocoa-muted">{h(a.free)} libres</span>
        </span>
        <span className="col-span-2 flex items-center justify-between text-xs text-cocoa-muted sm:col-span-1 sm:justify-end">
          <span className="tabular sm:hidden">{h(a.free)} libres</span>
          <ChevronRightIcon className="h-4 w-4 text-cocoa-faint transition group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}

function AreaModal({
  area,
  onClose,
  onWorker,
}: {
  area: AreaCapacity | null;
  onClose: () => void;
  onWorker: (id: string) => void;
}) {
  const luz = area ? luzDe(area.utilization, area.capacity) : 'gris';
  const L = LUZ[luz];
  const sinNadie = area?.processes.filter((p) => p.workers.length === 0) ?? [];

  return (
    <Modal open={!!area} onClose={onClose} title={area?.name ?? ''}>
      {area && (
        <div className="space-y-6">
          {/* Resumen */}
          <section className={cn('rounded-2xl border p-4', L.caja)}>
            <p className="flex items-center gap-2 font-semibold text-cocoa">
              <span className={cn('h-3 w-3 rounded-full', L.punto)} /> {L.titulo}
            </p>
            <p className="mt-1 text-sm text-cocoa">
              {L.frase} Esta semana quedan <b>{h(area.free)} libres</b> en {area.name.toLowerCase()} ({enDias(area.free)}).
            </p>
          </section>

          {/* Días */}
          <section>
            <h3 className="text-sm font-semibold text-cocoa">¿Qué días hay espacio?</h3>
            <ul className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {area.days.map((d) => {
                const libre = Math.max(0, d.capacity - d.busy);
                const dl = luzDe(d.capacity ? d.busy / d.capacity : 0, d.capacity);
                return (
                  <li key={d.date} className={cn('rounded-xl border px-2 py-2 text-center', d.capacity ? LUZ[dl].caja : 'border-line bg-cream/40')}>
                    <span className="block text-[11px] font-medium text-cocoa-muted">
                      {d.label} {fechaCorta(d.date).split(' ')[0]}
                    </span>
                    <span className="tabular mt-0.5 block text-base font-semibold text-cocoa">{d.capacity ? h(libre) : '—'}</span>
                    <span className="block text-[10px] text-cocoa-muted">{d.capacity ? 'libres' : 'no se trabaja'}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Personas */}
          <section>
            <h3 className="text-sm font-semibold text-cocoa">¿Quiénes trabajan en {area.name.toLowerCase()}?</h3>
            <p className="text-xs text-cocoa-muted">Las personas que saben hacer algún proceso de esta área. Toca a una para ver su horario.</p>
            {area.workers.length === 0 ? (
              <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">Nadie. Pide a gerencia que asigne estos procesos a alguien en Personal.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {area.workers.map((w) => (
                  <li key={w.id}>
                    <button type="button" onClick={() => onWorker(w.id)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 text-left hover:bg-cream/50">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-soft text-xs font-semibold text-blush-deep">{w.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-cocoa">{w.name}</span>
                        <span className="block truncate text-[11px] capitalize text-cocoa-muted">Hace: {w.processes.join(', ').toLowerCase()}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cn('tabular block text-sm font-semibold', w.free > 0 ? 'text-emerald-700' : 'text-rose-700')}>{h(w.free)}</span>
                        <span className="block text-[10px] text-cocoa-muted">libres</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sinNadie.length > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Ojo: nadie sabe hacer <b>{sinNadie.map((p) => p.name.toLowerCase()).join(', ')}</b>. Asígnalo a alguien en Personal.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
