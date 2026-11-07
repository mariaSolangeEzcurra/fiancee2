import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilePlus2Icon, RefreshCwIcon, SearchIcon } from 'lucide-react';

import { PageHeader } from '../../components/ui/PageHeader';
import {
  ApiError,
  contractsApi,
  ESTADOS_CONTRATO,
  takeSimulatorPrefill,
} from '../../services/contractsApi';
import type {
  ContractPrefill,
  ContratoResumen,
  EstadoContrato,
  FiltrosContratos,
} from '../../services/contractsApi';
import { fmtShort } from '../../utils/dates';
import { ContractForm } from './ContractForm';

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

const estadoCls: Record<EstadoContrato, string> = {
  ACTIVO: 'bg-champagne-soft text-cocoa',
  EN_PRODUCCION: 'bg-blue-50 text-blue-800',
  ENTREGADO: 'bg-green-50 text-green-800',
  CANCELADO: 'bg-red-50 text-red-700',
};

type View = { mode: 'list' } | { mode: 'form'; id: number | null; prefill?: ContractPrefill | null };

export function Contracts({ viewOnly = false }: { viewOnly?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    // Si se llega desde el simulador, se abre el formulario prellenado.
    const prefill = takeSimulatorPrefill();
    if (prefill) return { mode: 'form', id: null, prefill };
    // Desde una notificación: /fio/contratos?abrir=12
    const abrir = Number(params.get('abrir'));
    return abrir > 0 ? { mode: 'form', id: abrir } : { mode: 'list' };
  });
  useEffect(() => {
    if (params.has('abrir')) {
      const abrir = Number(params.get('abrir'));
      if (abrir > 0) setView({ mode: 'form', id: abrir });
      params.delete('abrir');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const [filters, setFilters] = useState<FiltrosContratos>({ q: '', estado: '', origen: '' });
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ContratoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (f: FiltrosContratos = filters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await contractsApi.list(f);
      setItems(data.contratos);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view.mode === 'list') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.mode, filters]);

  // Búsqueda con pequeña espera mientras se escribe.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => (f.q === query ? f : { ...f, q: query }));
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  if (view.mode === 'form') {
    return (
      <ContractForm
        key={view.id ?? 'nuevo'}
        contractId={view.id}
        prefill={view.prefill}
        viewOnly={viewOnly}
        onBack={() => setView({ mode: 'list' })}
        onSaved={(contrato) => {
          // Un contrato nuevo pasa a modo edición tras guardarse.
          if (view.id === null && contrato.id !== null) {
            setView({ mode: 'form', id: contrato.id });
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contratos"
        subtitle={
          viewOnly
            ? 'Todos los contratos con sus vestidos, pagos y saldos. Solo lectura: los registra y modifica comercial.'
            : 'Registra contratos directamente o desde el simulador. Cada contrato reserva automáticamente la capacidad del taller.'
        }
      />

      <section className="sticky top-0 z-20 rounded-2xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {!viewOnly && <button
            type="button"
            onClick={() => setView({ mode: 'form', id: null })}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cocoa px-4 py-3 text-sm font-semibold text-white hover:bg-[#3a281f]"
          >
            <FilePlus2Icon className="h-4 w-4" />
            Nuevo contrato
          </button>}

          <div className="relative min-w-[220px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-cocoa-muted" />
            <input
              className="w-full rounded-xl border border-line bg-paper py-3 pl-9 pr-3 text-sm text-cocoa outline-none focus:border-gold-soft focus:ring-2 focus:ring-champagne-soft"
              placeholder="Buscar por N.º, clienta o DNI…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <select
            className="rounded-xl border border-line bg-paper px-3 py-3 text-sm text-cocoa"
            value={filters.estado}
            onChange={(e) => setFilters((f) => ({ ...f, estado: e.target.value as EstadoContrato | '' }))}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_CONTRATO.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>

          <select
            className="rounded-xl border border-line bg-paper px-3 py-3 text-sm text-cocoa"
            value={filters.origen}
            onChange={(e) => setFilters((f) => ({ ...f, origen: e.target.value as FiltrosContratos['origen'] }))}
          >
            <option value="">Todo origen</option>
            <option value="MANUAL">Manual</option>
            <option value="SIMULADOR">Simulador</option>
          </select>

          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-line p-3 text-cocoa hover:bg-cream"
            title="Actualizar"
            aria-label="Actualizar"
          >
            <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <div className="ml-auto text-right">
            <p className="text-xs text-cocoa-muted">Contratos</p>
            <p className="text-lg font-semibold text-cocoa">{items.length}</p>
          </div>
        </div>
      </section>

      {error && (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">No se pudieron cargar los contratos</p>
          <p className="mt-1">{error}</p>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-champagne-soft/50 text-xs uppercase tracking-wide text-cocoa">
              <tr>
                <th className="px-4 py-3 font-semibold">N.º</th>
                <th className="px-4 py-3 font-semibold">Clienta</th>
                <th className="px-4 py-3 font-semibold">Evento</th>
                <th className="px-4 py-3 font-semibold">Recojo</th>
                <th className="px-4 py-3 font-semibold">Vestidos</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setView({ mode: 'form', id: c.id })}
                  className="cursor-pointer border-t border-line hover:bg-cream/60"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-cocoa">{c.numero}</p>
                    <p className="text-xs text-cocoa-muted">
                      {fmtShort(c.fecha_firma)} · {c.origen === 'SIMULADOR' ? 'Simulador' : 'Manual'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-cocoa">{c.cliente_nombre ?? '—'}</p>
                    <p className="text-xs text-cocoa-muted">DNI {c.cliente_documento || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-cocoa">
                    {c.tipo_evento_display}
                    <p className="text-xs text-cocoa-muted">{c.fecha_evento ? fmtShort(c.fecha_evento) : 'Sin fecha'}</p>
                  </td>
                  <td className="px-4 py-3 text-cocoa">{fmtShort(c.fecha_entrega)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.resumen_vestidos.slice(0, 3).map((v) => (
                        <span key={v.codigo} className="rounded-full bg-cream px-2 py-0.5 text-xs text-cocoa">
                          {v.tipo_vestido}{v.taller ? ` · ${v.taller}` : ''}
                        </span>
                      ))}
                      {c.resumen_vestidos.length > 3 && (
                        <span className="text-xs text-cocoa-muted">+{c.resumen_vestidos.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-cocoa">{money.format(Number(c.precio_total))}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${estadoCls[c.estado]}`}>
                      {c.estado_display}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && items.length === 0 && !error && (
          <p className="m-4 rounded-xl border border-dashed border-nude p-8 text-center text-sm text-cocoa-muted">
            No hay contratos con esos filtros.
          </p>
        )}

        {loading && items.length === 0 && (
          <p className="flex items-center gap-3 p-4 text-sm text-cocoa-muted">
            <RefreshCwIcon className="h-5 w-5 animate-spin" /> Cargando contratos…
          </p>
        )}
      </section>
    </div>
  );
}
