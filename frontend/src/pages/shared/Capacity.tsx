import { useCallback, useEffect, useState } from 'react';
import { ChevronRightIcon, RefreshCwIcon, UsersIcon, WorkflowIcon } from 'lucide-react';

import { WorkerModal } from '../../components/staff/WorkerModal';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { AREA_STYLE, fechaCorta, horas, staffApi } from '../../services/staffApi';
import type { AreaCapacity, CapacityWeek } from '../../services/staffApi';
import { cn } from '../../utils/format';

type Week = '0' | '1' | '2' | '3';

/** Capacidad del taller por área. Al tocar un área se ve quién apoya en ella. */
export function Capacity() {
  const [week, setWeek] = useState<Week>('0');
  const [data, setData] = useState<CapacityWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [areaCode, setAreaCode] = useState<string | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);

  const load = useCallback(async (w: Week) => {
    setLoading(true);
    setError('');
    try {
      setData(await staffApi.capacity(Number(w)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la capacidad.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(week);
  }, [week, load]);

  const area = data?.areas.find((a) => a.code === areaCode) ?? null;
  const t = data?.totals;
  const libre = t ? Math.max(0, t.capacity - t.busy) : 0;
  const uso = t && t.capacity ? t.busy / t.capacity : 0;

  return (
    <div>
      <PageHeader
        title="Capacidad"
        subtitle="Horas del personal según su horario, menos permisos y trabajo ya separado. Toca un área para ver quién apoya."
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-[26rem]">
          <Segmented<Week>
            ariaLabel="Semana"
            value={week}
            onChange={setWeek}
            options={[
              { value: '0', label: 'Esta semana' },
              { value: '1', label: 'La próxima' },
              { value: '2', label: 'En 2 semanas' },
              { value: '3', label: 'En 3 semanas' },
            ]}
          />
        </div>
        {data && (
          <span className="text-xs text-cocoa-muted">
            Del {fechaCorta(data.from)} al {fechaCorta(data.to)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load(week)}
          aria-label="Actualizar"
          className="ml-auto hidden rounded-lg border border-line p-2 text-cocoa hover:bg-cream sm:block"
        >
          <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {t && (
        <section className="mb-6 rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Big label="Horas del personal" value={horas(t.capacity)} sub={`${t.people} personas`} />
            <Big label="Ya ocupadas" value={horas(t.busy)} sub={`${Math.round(uso * 100)}% del total`} />
            <Big label="Libres" value={horas(libre)} tone={libre > 0 ? 'ok' : 'bad'} />
            <Big label="Trabajo por hacer" value={horas(t.pendingHours)} sub="separado esta semana" />
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-sand/60">
            <div
              className={cn('h-full rounded-full', uso >= 0.95 ? 'bg-rose-500' : uso >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500')}
              style={{ width: `${Math.min(100, uso * 100)}%` }}
            />
          </div>
        </section>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <p className="flex items-center gap-2 p-6 text-sm text-cocoa-muted">
          <RefreshCwIcon className="h-4 w-4 animate-spin" /> Calculando capacidad…
        </p>
      ) : (
        <ul className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')}>
          {data?.areas.map((a) => (
            <AreaCard key={a.code} a={a} onOpen={() => setAreaCode(a.code)} />
          ))}
        </ul>
      )}

      <AreaModal area={area} onClose={() => setAreaCode(null)} onWorker={setWorkerId} />
      <WorkerModal workerId={workerId} onClose={() => setWorkerId(null)} />
    </div>
  );
}

function AreaCard({ a, onOpen }: { a: AreaCapacity; onOpen: () => void }) {
  const st = AREA_STYLE[a.status];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex h-full w-full flex-col rounded-2xl border border-l-4 border-line bg-paper p-4 text-left transition-colors hover:bg-cream/40',
          st.border
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="block font-display text-xl font-semibold text-cocoa">{a.name}</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-cocoa-muted">
              <UsersIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {a.people === 1 ? '1 persona apoya' : `${a.people} personas apoyan`}
            </span>
          </span>
          <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', st.chip)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} aria-hidden="true" /> {st.label}
          </span>
        </span>

        <span className="mt-4 block h-2 overflow-hidden rounded-full bg-sand/60">
          <span className={cn('block h-full rounded-full', st.bar)} style={{ width: `${Math.min(100, a.utilization * 100)}%` }} />
        </span>
        <span className="mt-2 flex justify-between text-xs">
          <span className="text-cocoa-muted">
            <span className="tabular font-semibold text-cocoa">{horas(a.free)}</span> libres
          </span>
          <span className="tabular text-cocoa-muted">
            {horas(a.busy)} de {horas(a.capacity)}
          </span>
        </span>

        <span className="mt-auto flex items-center justify-between pt-3 text-xs text-cocoa-muted">
          <span>{a.pendingHours > 0 ? `${horas(a.pendingHours)} de trabajo de esta área` : 'Sin trabajo separado'}</span>
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
  const st = area ? AREA_STYLE[area.status] : null;
  const max = area ? Math.max(1, ...area.days.map((d) => d.capacity)) : 1;

  return (
    <Modal
      open={!!area}
      onClose={onClose}
      title={area?.name ?? ''}
      subtitle={
        area &&
        st && (
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', st.chip)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} aria-hidden="true" /> {st.label}
            </span>
            <span>
              {horas(area.free)} libres de {horas(area.capacity)}
            </span>
          </span>
        )
      }
    >
      {area && (
        <div className="space-y-6">
          {/* Día por día */}
          <section>
            <h3 className="text-sm font-semibold text-cocoa">Día por día</h3>
            <div className="mt-3 grid grid-cols-7 gap-1.5">
              {area.days.map((d) => {
                const libre = Math.max(0, d.capacity - d.busy);
                const lleno = d.capacity > 0 && d.busy / d.capacity >= 0.95;
                return (
                  <div key={d.date} className="flex flex-col items-center rounded-xl border border-line bg-paper px-1 py-2" title={`${horas(d.busy)} ocupadas de ${horas(d.capacity)}`}>
                    <span className="text-[11px] font-medium text-cocoa-muted">{d.label}</span>
                    <div className="relative mt-2 flex h-16 w-4 items-end overflow-hidden rounded-full bg-sand/50">
                      <div className="absolute bottom-0 w-full rounded-full bg-cocoa/15" style={{ height: `${(d.capacity / max) * 100}%` }} />
                      <div
                        className={cn('relative w-full rounded-full', lleno ? 'bg-rose-500' : 'bg-cocoa/70')}
                        style={{ height: `${(d.busy / max) * 100}%` }}
                      />
                    </div>
                    <span className={cn('tabular mt-1.5 text-[11px] font-semibold', d.capacity ? 'text-cocoa' : 'text-cocoa-faint')}>
                      {d.capacity ? `${Math.round(libre * 10) / 10} h` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-cocoa-faint">Debajo de cada día: horas libres.</p>
          </section>

          {/* Quién apoya */}
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cocoa">
              <UsersIcon className="h-4 w-4" aria-hidden="true" /> Quién apoya en {area.name.toLowerCase()}
            </h3>
            {area.workers.length === 0 ? (
              <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
                Nadie tiene procesos de esta área. Pide a gerencia que se los asigne a alguien.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {area.workers.map((w) => {
                  const uso = w.hours ? w.busy / w.hours : 0;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => onWorker(w.id)}
                        className="flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 text-left hover:bg-cream/50"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-soft text-xs font-semibold text-blush-deep">
                          {w.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-cocoa">{w.name}</span>
                            <span className="tabular shrink-0 text-xs text-cocoa-muted">
                              <span className="font-semibold text-cocoa">{horas(w.free)}</span> libres
                            </span>
                          </span>
                          <span className="block truncate text-[11px] capitalize text-cocoa-muted">
                            {w.processes.join(' · ')}
                            {w.mainArea !== area.name ? ` · de ${w.mainArea.toLowerCase()}` : ''}
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sand/60">
                            <span
                              className={cn('block h-full rounded-full', uso >= 0.95 ? 'bg-rose-500' : uso >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500')}
                              style={{ width: `${Math.min(100, uso * 100)}%` }}
                            />
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Procesos del área */}
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cocoa">
              <WorkflowIcon className="h-4 w-4" aria-hidden="true" /> Procesos de esta área
            </h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
              {area.processes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block capitalize text-cocoa">{p.name}</span>
                    <span className={cn('block truncate text-[11px]', p.workers.length ? 'text-cocoa-muted' : 'font-medium text-rose-700')}>
                      {p.workers.length ? p.workers.join(', ') : 'Nadie sabe hacerlo'}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-cocoa-muted">
                    {p.pendingHours > 0 ? `${horas(p.pendingHours)} por hacer` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-cocoa-muted">{label}</p>
      <p className={cn('tabular mt-0.5 truncate text-xl font-semibold sm:text-2xl', tone === 'bad' ? 'text-rose-700' : tone === 'ok' ? 'text-emerald-700' : 'text-cocoa')}>
        {value}
      </p>
      {sub && <p className="truncate text-[11px] text-cocoa-faint">{sub}</p>}
    </div>
  );
}
