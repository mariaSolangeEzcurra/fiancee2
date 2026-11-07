import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BellRingIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';

import { ProductionDressDrawer } from '../../components/production/ProductionDressDrawer';
import { ProductionDressTable } from '../../components/production/ProductionDressTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { Stat } from '../../components/ui/Stat';
import { useProduction } from '../../hooks/useProduction';
import { dressTone, prodTotals, TONE_STYLES } from '../../services/productionApi';
import { cn, fmtH, inputClass } from '../../utils/format';

type WorkshopFilter = 'todos' | 'Taller A' | 'Taller C' | 'Tienda';
type StatusFilter = 'pendientes' | 'sin_iniciar' | 'en_proceso' | 'atrasados' | 'terminados' | 'todos';

const PRIORITY_ORDER = { Alta: 0, Media: 1, Baja: 2 } as const;

/**
 * Vestidos de los contratos en producción (datos reales de Django).
 * Jefa de taller: /taller/vestidos · Gerencia: /gerencia/produccion (readOnly)
 */
export function ProductionDresses({ readOnly = false, title }: { readOnly?: boolean; title?: string }) {
  const store = useProduction();
  const { dresses, reminders, loading, error, reload } = store;

  const [q, setQ] = useState('');
  const [workshop, setWorkshop] = useState<WorkshopFilter>('todos');
  const [status, setStatus] = useState<StatusFilter>('pendientes');
  const [openId, setOpenId] = useState<string | null>(null);

  // /taller/vestidos?abrir=12 (desde una notificación)
  const [params, setParams] = useSearchParams();
  const toOpen = params.get('abrir');
  useEffect(() => {
    if (toOpen && dresses.some((d) => d.id === toOpen)) {
      setOpenId(toOpen);
      setStatus('todos');
      params.delete('abrir');
      setParams(params, { replace: true });
    }
  }, [toOpen, dresses, params, setParams]);

  const list = useMemo(
    () =>
      dresses
        .filter((d) => `${d.code} ${d.client} ${d.contract}`.toLowerCase().includes(q.toLowerCase()))
        .filter((d) => workshop === 'todos' || d.workshop === workshop)
        .filter((d) => {
          const tone = dressTone(d);
          if (status === 'pendientes') return d.status !== 'Terminado';
          if (status === 'sin_iniciar') return d.status === 'Sin iniciar';
          if (status === 'en_proceso') return d.status === 'En proceso';
          if (status === 'atrasados') return tone === 'late' || tone === 'risk';
          if (status === 'terminados') return d.status === 'Terminado';
          return true;
        })
        // Primero lo más urgente: prioridad, luego la fecha de entrega. Los terminados al final.
        .sort(
          (a, b) =>
            Number(a.status === 'Terminado') - Number(b.status === 'Terminado') ||
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
            a.deadline.localeCompare(b.deadline)
        ),
    [dresses, q, workshop, status]
  );

  const active = dresses.filter((d) => d.status !== 'Terminado');
  const late = active.filter((d) => dressTone(d) === 'late').length;
  const risky = active.filter((d) => dressTone(d) === 'risk').length;

  return (
    <div>
      <PageHeader
        title={title ?? (readOnly ? 'Producción' : 'Vestidos')}
        subtitle={
          readOnly
            ? 'Cómo va cada vestido en el taller. Solo puedes verlo; los cambios los hace la jefa de taller.'
            : 'Ordenados por prioridad. Abre un vestido para iniciar procesos, asignar personal, registrar pagos u observaciones.'
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-6">
        <Stat label="Sin iniciar" value={active.filter((d) => d.status === 'Sin iniciar').length} />
        <Stat label="En proceso" value={active.filter((d) => d.status === 'En proceso').length} />
        <Stat label="Ojo con la fecha" value={risky} tone={risky ? 'risk' : 'ok'} />
        <Stat label="Atrasados" value={late} tone={late ? 'bad' : 'ok'} />
        <Stat label="Terminados" value={dresses.filter((d) => d.status === 'Terminado').length} />
        <Stat label="Horas por hacer" value={fmtH(active.reduce((s, d) => s + prodTotals(d).remaining, 0))} />
      </div>

      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-cocoa-muted" aria-label="Leyenda de colores">
        {Object.values(TONE_STYLES).map((t) => (
          <li key={t.label} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', t.dot)} aria-hidden="true" /> {t.label}
          </li>
        ))}
      </ul>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cocoa-faint" aria-hidden="true" />
          <input aria-label="Buscar vestido" className={cn(inputClass, 'pl-9')} placeholder="Buscar código, clienta o contrato" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="lg:w-80">
          <Segmented<WorkshopFilter>
            ariaLabel="Filtrar por taller"
            value={workshop}
            onChange={setWorkshop}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'Taller A', label: 'Taller A' },
              { value: 'Taller C', label: 'Taller C' },
              { value: 'Tienda', label: 'Tienda' },
            ]}
          />
        </div>
        <div className="-mx-1 overflow-x-auto px-1 lg:w-[34rem]">
          <Segmented<StatusFilter>
            className="min-w-[30rem]"
            ariaLabel="Filtrar por estado"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pendientes', label: 'Pendientes' },
              { value: 'sin_iniciar', label: 'Sin iniciar' },
              { value: 'en_proceso', label: 'En proceso' },
              { value: 'atrasados', label: 'Atrasados' },
              { value: 'terminados', label: 'Terminados' },
              { value: 'todos', label: 'Todos' },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="ml-auto rounded-lg border border-line p-2 text-cocoa hover:bg-cream"
          title="Actualizar"
          aria-label="Actualizar"
        >
          <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {reminders.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <BellRingIcon className="h-4 w-4" aria-hidden="true" /> Recordatorios de seguimiento ({reminders.length})
          </h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {reminders.slice(0, 8).map((r) => (
              <li key={`${r.dressId}-${r.type}`}>
                <button
                  type="button"
                  onClick={() => r.dressId && setOpenId(r.dressId)}
                  className="w-full rounded-xl border border-amber-200 bg-paper px-3 py-2 text-left text-sm hover:bg-cream"
                >
                  <span className="font-semibold text-cocoa">{r.code}</span>
                  <span className="text-cocoa-muted"> · {r.client}</span>
                  <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', r.due ? 'bg-amber-200 text-amber-900' : 'bg-cream text-cocoa-muted')}>
                    {r.due ? 'Hoy' : `En ${r.daysLeft} d`}
                  </span>
                  <p className="mt-0.5 text-xs text-cocoa-muted">
                    {r.title}: {r.message}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {reminders.length > 8 && <p className="mt-2 text-xs text-amber-900">Y {reminders.length - 8} más…</p>}
        </section>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">No se pudo cargar la producción</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-paper">
        {loading && dresses.length === 0 ? (
          <p className="flex items-center gap-3 p-6 text-sm text-cocoa-muted">
            <RefreshCwIcon className="h-5 w-5 animate-spin" /> Cargando vestidos…
          </p>
        ) : (
          <ProductionDressTable dresses={list} onOpen={setOpenId} />
        )}
      </div>

      <ProductionDressDrawer dressId={openId} onClose={() => setOpenId(null)} readOnly={readOnly} store={store} />
    </div>
  );
}
