import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CalendarHeartIcon,
  FilePlus2Icon,
  MessageCircleIcon,
  RefreshCwIcon,
  ShirtIcon,
  SparklesIcon,
  WalletIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ProductionDressDrawer } from '../../components/production/ProductionDressDrawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import { useProduction } from '../../hooks/useProduction';
import {
  comercialApi,
  cuandoFalta,
  DELIVERY_TONE,
  fmtFecha,
  fmtSoles,
  variacion,
  whatsapp,
} from '../../services/comercialApi';
import type { ComercialHome, Delivery } from '../../services/comercialApi';
import { cn } from '../../utils/format';

type Filtro = 'todas' | 'semana' | 'atrasadas' | 'listas';

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** Inicio de comercial con datos reales. */
export function FioHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const store = useProduction();
  const [data, setData] = useState<ComercialHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [dressId, setDressId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await comercialApi.home());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el inicio.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entregas = useMemo(() => {
    const list = data?.deliveries ?? [];
    if (filtro === 'semana') return list.filter((d) => d.daysLeft >= 0 && d.daysLeft <= 7);
    if (filtro === 'atrasadas') return list.filter((d) => d.daysLeft < 0 && d.status !== 'LISTO');
    if (filtro === 'listas') return list.filter((d) => d.status === 'LISTO');
    return list;
  }, [data, filtro]);

  // Un grupo por contrato y fecha de recojo (el saldo es del contrato).
  const grupos = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of entregas) {
      const key = `${d.contractId}-${d.date}`;
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return [...map.values()];
  }, [entregas]);

  const abrir = (d: Delivery) => (d.dressId ? setDressId(d.dressId) : navigate(`/fio/contratos?abrir=${d.contractId}`));

  const nombre = user?.nombre?.trim()?.split(/\s+/)[0] || user?.username || '';
  const k = data?.kpis;
  const cambio = k ? variacion(k.collectedMonth, k.collectedPrev) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${saludo()}${nombre ? `, ${nombre}` : ''}`}
        subtitle={new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/fio/simulador" className="inline-flex items-center gap-2 rounded-xl border border-gold-soft bg-paper px-4 py-2.5 text-sm font-semibold text-cocoa hover:bg-champagne-soft">
              <SparklesIcon className="h-4 w-4" /> Simular
            </Link>
            <Link to="/fio/contratos" className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-[#3a281f]">
              <FilePlus2Icon className="h-4 w-4" /> Contratos
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Reintentar
          </button>
        </div>
      )}

      {/* Números del mes */}
      {k && data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            icon={<WalletIcon className="h-4 w-4" />}
            label={`Cobrado en ${data.monthLabel.split(' ')[0]}`}
            value={fmtSoles(k.collectedMonth)}
            foot={
              cambio ? (
                <span className={cn('inline-flex items-center gap-0.5 font-semibold', cambio.up ? 'text-emerald-700' : 'text-rose-700')}>
                  {cambio.up ? <ArrowUpRightIcon className="h-3.5 w-3.5" /> : <ArrowDownRightIcon className="h-3.5 w-3.5" />}
                  {cambio.text} vs. mes pasado
                </span>
              ) : (
                'Primer mes con cobros'
              )
            }
            to="/fio/finanzas"
          />
          <Kpi
            icon={<FilePlus2Icon className="h-4 w-4" />}
            label="Vendido este mes"
            value={fmtSoles(k.soldMonth)}
            foot={`${k.contractsMonth} contrato(s) nuevo(s)`}
            to="/fio/contratos"
          />
          <Kpi
            icon={<WalletIcon className="h-4 w-4" />}
            label="Por cobrar"
            value={fmtSoles(k.toCollect)}
            foot={`${k.contractsWithBalance} contrato(s) con saldo`}
            tone={k.toCollect > 0 ? 'risk' : undefined}
            to="/fio/finanzas"
          />
          <Kpi
            icon={<ShirtIcon className="h-4 w-4" />}
            label="Vestidos en taller"
            value={String(k.inWorkshop)}
            foot={
              <span>
                {k.late > 0 && <span className="font-semibold text-rose-700">{k.late} atrasado(s) · </span>}
                {k.ready} listo(s) para recoger
              </span>
            }
            to="/fio/vestidos"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Próximas entregas */}
        <section className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Próximas entregas</h2>
            <button type="button" onClick={() => void load()} aria-label="Actualizar" className="text-cocoa-muted hover:text-cocoa">
              <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {(
              [
                ['todas', 'Próximos 30 días'],
                ['semana', 'Esta semana'],
                ['atrasadas', 'Atrasadas'],
                ['listas', 'Listas para recoger'],
              ] as [Filtro, string][]
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFiltro(v)}
                className={cn(
                  'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  filtro === v ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted hover:text-cocoa'
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {loading && !data ? (
            <p className="mt-4 text-sm text-cocoa-muted">Cargando…</p>
          ) : grupos.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-line bg-paper p-8 text-center text-sm text-cocoa-faint">
              No hay entregas con este filtro.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {grupos.map((g) => (
                <EntregaGrupo key={`${g[0].contractId}-${g[0].date}`} items={g} onOpen={abrir} onContract={() => navigate(`/fio/contratos?abrir=${g[0].contractId}`)} />
              ))}
            </ul>
          )}
        </section>

        <aside className="min-w-0 space-y-5">
          {data && data.collect.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <h2 className="text-sm font-semibold text-amber-900">Cobrar antes del recojo</h2>
              <p className="text-xs text-amber-800">Contratos con saldo que se recogen en los próximos 15 días.</p>
              <ul className="mt-3 space-y-2">
                {data.collect.map((c) => {
                  const wa = whatsapp(c.phone, `Hola ${c.client}, te escribimos de Fiancée por el saldo de tu contrato ${c.contract}.`);
                  return (
                    <li key={c.contractId} className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2.5">
                      <Link to={`/fio/contratos?abrir=${c.contractId}`} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-cocoa">{c.client || c.contract}</span>
                        <span className="block text-xs text-cocoa-muted">
                          {c.contract} · recojo {cuandoFalta(c.daysLeft)}
                        </span>
                      </Link>
                      <span className="tabular shrink-0 text-sm font-semibold text-amber-900">{fmtSoles(c.balance)}</span>
                      {wa && <WhatsApp href={wa} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {data && (data.events.length > 0 || data.reminders.length > 0) && (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-cocoa">
                <CalendarHeartIcon className="h-4 w-4 text-gold" /> Para no olvidar
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.reminders.map((r) => (
                  <li key={`${r.code}-r`} className="rounded-xl bg-champagne-soft/50 px-3 py-2">
                    <span className="block font-medium text-cocoa">Coordinar 1.ª prueba · {r.client}</span>
                    <span className="block text-xs text-cocoa-muted">
                      {r.code} · {r.due ? 'ya toca' : cuandoFalta(r.daysLeft)}
                    </span>
                  </li>
                ))}
                {data.events.map((e) => (
                  <li key={`${e.contractId}-e`} className="flex items-center justify-between gap-3 rounded-xl bg-cream/60 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-cocoa">
                        {e.type} de {e.client}
                      </span>
                      <span className="block text-xs text-cocoa-muted">{fmtFecha(e.date, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-cocoa">{cuandoFalta(e.daysLeft)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <h2 className="text-sm font-semibold text-cocoa">Ventas y cobros · últimos 6 meses</h2>
              <div className="mt-3 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.months} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EDE3D6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#76604F' }} tickLine={false} axisLine={false} tickFormatter={(v: string) => v.split(' ')[0]} />
                    <YAxis tick={{ fontSize: 11, fill: '#76604F' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip formatter={(v: number) => fmtSoles(v)} cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sold" name="Vendido" fill="#CDB17A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="collected" name="Cobrado" fill="#4A3428" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {data.kpis.simulations > 0 && (
                <p className="mt-2 text-xs text-cocoa-muted">
                  Este mes: {data.kpis.simulations} simulación(es), {data.kpis.simulationsAccepted} se volvieron contrato.
                </p>
              )}
            </section>
          )}
        </aside>
      </div>

      <ProductionDressDrawer dressId={dressId} onClose={() => setDressId(null)} readOnly store={store} />
    </div>
  );
}

const PESO_TONO: Record<Delivery['tone'], number> = { late: 0, risk: 1, idle: 2, progress: 3, ok: 4 };

function etiquetaDe(d: Delivery) {
  if (d.status === 'LISTO') return d.daysLeft < 0 ? 'Listo · falta recoger' : 'Listo';
  if (d.tone === 'late') return 'Atrasado';
  return d.statusLabel;
}

function EntregaGrupo({
  items,
  onOpen,
  onContract,
}: {
  items: Delivery[];
  onOpen: (d: Delivery) => void;
  onContract: () => void;
}) {
  const first = items[0];
  const peor = [...items].sort((a, b) => PESO_TONO[a.tone] - PESO_TONO[b.tone])[0];
  const t = DELIVERY_TONE[peor.tone];
  const listos = items.filter((d) => d.status === 'LISTO').length;
  const wa = whatsapp(
    first.phone,
    listos === items.length
      ? `Hola ${first.client}, tu pedido ya está listo para recoger en Fiancée.`
      : `Hola ${first.client}, te escribimos de Fiancée sobre tu pedido ${first.contract}.`
  );

  return (
    <li className={cn('rounded-xl border border-l-4 border-line bg-paper px-3 py-3', t.border)}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onContract} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="w-12 shrink-0 text-center">
            <span className="tabular block text-lg font-semibold leading-none text-cocoa">{fmtFecha(first.date, { day: 'numeric' })}</span>
            <span className="block text-[11px] uppercase text-cocoa-muted">{fmtFecha(first.date, { month: 'short' })}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-cocoa">
              {first.client || 'Sin nombre'} <span className="font-normal text-cocoa-muted">· {first.contract}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-cocoa-muted">
              <span>Recojo {cuandoFalta(first.daysLeft)}</span>
              <span>· {listos}/{items.length} {items.length === 1 ? 'listo' : 'listos'}</span>
              {first.balance > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">Saldo {fmtSoles(first.balance)}</span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">Pagado</span>
              )}
            </span>
          </span>
        </button>
        {wa && <WhatsApp href={wa} />}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[3.75rem]">
        {items.map((d) => {
          const dt = DELIVERY_TONE[d.tone];
          return (
            <button
              key={d.code}
              type="button"
              onClick={() => onOpen(d)}
              title={d.currentProcess ? `${d.dressType} · ahora en ${d.currentProcess}` : d.dressType}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80', dt.chip)}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', dt.dot)} aria-hidden="true" />
              {d.code.split('-').pop()} · {etiquetaDe(d)}
              {d.status === 'EN_PROCESO' && <span className="tabular opacity-70">{Math.round(d.progress * 100)}%</span>}
            </button>
          );
        })}
      </div>
    </li>
  );
}

function WhatsApp({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Escribir por WhatsApp"
      aria-label="Escribir por WhatsApp"
      className="shrink-0 rounded-full border border-emerald-200 p-2 text-emerald-700 hover:bg-emerald-50"
    >
      <MessageCircleIcon className="h-4 w-4" />
    </a>
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
  value: string;
  foot: ReactNode;
  tone?: 'risk';
  to: string;
}) {
  return (
    <Link to={to} className="rounded-2xl border border-line bg-paper p-4 transition-colors hover:bg-cream/50">
      <p className="flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
        <span className="text-gold">{icon}</span> {label}
      </p>
      <p className={cn('tabular mt-1 truncate text-2xl font-semibold', tone === 'risk' ? 'text-amber-800' : 'text-cocoa')}>{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-cocoa-muted">{foot}</p>
    </Link>
  );
}
