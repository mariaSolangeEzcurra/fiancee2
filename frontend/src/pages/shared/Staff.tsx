import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, RefreshCwIcon, SearchIcon, ShirtIcon } from 'lucide-react';

import { WorkerModal } from '../../components/staff/WorkerModal';
import { PageHeader } from '../../components/ui/PageHeader';
import { horaCorta, horas, staffApi, TODAY_STYLE } from '../../services/staffApi';
import type { StaffMember, TodayStatus } from '../../services/staffApi';
import { cn, inputClass } from '../../utils/format';

const ORDEN: Record<TodayStatus, number> = { TRABAJANDO: 0, SIN_MARCAR: 1, TERMINO: 2, PERMISO: 3, DESCANSO: 4 };

/** Personal del taller (solo vista). Al tocar a alguien se abre su ficha. */
export function Staff() {
  const [items, setItems] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [area, setArea] = useState('todas');
  const [estado, setEstado] = useState<TodayStatus | 'todos'>('todos');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await staffApi.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el personal.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const areas = useMemo(() => [...new Set(items.map((w) => w.area))].sort(), [items]);

  const counts = useMemo(() => {
    const c: Record<TodayStatus, number> = { TRABAJANDO: 0, SIN_MARCAR: 0, TERMINO: 0, PERMISO: 0, DESCANSO: 0 };
    for (const w of items) c[w.today.status] += 1;
    return c;
  }, [items]);

  const list = useMemo(
    () =>
      items
        .filter((w) => area === 'todas' || w.area === area)
        .filter((w) => estado === 'todos' || w.today.status === estado)
        .filter((w) =>
          `${w.name} ${w.skills.map((s) => s.name).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())
        )
        .sort((a, b) => ORDEN[a.today.status] - ORDEN[b.today.status] || a.name.localeCompare(b.name)),
    [items, area, estado, q]
  );

  return (
    <div>
      <PageHeader title="Personal" subtitle="Quién está hoy en el taller. Toca a una persona para ver su horario e historial." />

      {/* Estado de hoy (también sirve como filtro) */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(ORDEN) as TodayStatus[]).map((s) => {
          const st = TODAY_STYLE[s];
          const active = estado === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setEstado(active ? 'todos' : s)}
              aria-pressed={active}
              className={cn(
                'rounded-2xl border px-4 py-3 text-left transition-colors',
                active ? 'border-cocoa bg-paper ring-1 ring-cocoa' : 'border-line bg-paper hover:bg-cream/60'
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
                <span className={cn('h-2 w-2 rounded-full', st.dot)} aria-hidden="true" /> {st.label}
              </span>
              <span className="tabular mt-0.5 block text-2xl font-semibold text-cocoa">{counts[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cocoa-faint" aria-hidden="true" />
          <input
            aria-label="Buscar"
            className={cn(inputClass, 'pl-9')}
            placeholder="Buscar por nombre o proceso"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {['todas', ...areas].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setArea(a)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                area === a ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted hover:text-cocoa'
              )}
            >
              {a === 'todas' ? 'Todas las áreas' : a}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Actualizar"
          className="ml-auto hidden rounded-lg border border-line p-2 text-cocoa hover:bg-cream sm:block"
        >
          <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <p className="flex items-center gap-2 p-6 text-sm text-cocoa-muted">
          <RefreshCwIcon className="h-4 w-4 animate-spin" /> Cargando personal…
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-line bg-paper p-10 text-center text-sm text-cocoa-faint">
          No hay personas con estos filtros.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((w) => (
            <WorkerCard key={w.id} w={w} onOpen={() => setOpenId(w.id)} />
          ))}
        </ul>
      )}

      <WorkerModal workerId={openId} member={items.find((w) => w.id === openId)} onClose={() => setOpenId(null)} />
    </div>
  );
}

function WorkerCard({ w, onOpen }: { w: StaffMember; onOpen: () => void }) {
  const st = TODAY_STYLE[w.today.status];
  const avance = w.weekHours ? Math.min(1, w.weekWorked / w.weekHours) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex h-full w-full flex-col rounded-2xl border border-line bg-paper p-4 text-left transition-colors hover:border-nude hover:bg-cream/40"
      >
        <span className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blush-soft text-sm font-semibold text-blush-deep">
            {w.initials}
            <span className={cn('absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-paper', st.dot)} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-cocoa">{w.name}</span>
            <span className="block truncate text-xs text-cocoa-muted">{w.area}</span>
          </span>
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-cocoa-faint transition group-hover:translate-x-0.5" aria-hidden="true" />
        </span>

        <span className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cn('rounded-full px-2 py-0.5 font-medium', st.chip)}>
            {st.label}
            {w.today.checkIn && w.today.status === 'TRABAJANDO' ? ` desde ${horaCorta(w.today.checkIn)}` : ''}
          </span>
          {w.activeSession && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-cocoa">
              <ShirtIcon className="h-3 w-3" aria-hidden="true" /> {w.activeSession.dress}
            </span>
          )}
        </span>

        {w.skills.length > 0 && (
          <span className="mt-2 line-clamp-1 text-xs capitalize text-cocoa-muted">
            {w.skills.map((s) => s.name).join(' · ')}
          </span>
        )}

        <span className="mt-auto block pt-3">
          <span className="flex justify-between text-[11px] text-cocoa-muted">
            <span>Esta semana</span>
            <span className="tabular">
              {horas(w.weekWorked)} de {horas(w.weekHours)}
            </span>
          </span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sand/60">
            <span className="block h-full rounded-full bg-cocoa/70" style={{ width: `${avance * 100}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}
