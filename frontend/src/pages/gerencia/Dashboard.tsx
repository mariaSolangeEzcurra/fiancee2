import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  GaugeIcon,
  PlusIcon,
  RefreshCwIcon,
  ShirtIcon,
  TargetIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import { comercialApi, cuandoFalta, DELIVERY_TONE, fmtFecha, fmtSoles } from '../../services/comercialApi';
import type { ComercialHome } from '../../services/comercialApi';
import { gerenciaApi, pct } from '../../services/gerenciaApi';
import type { FinanceSummary } from '../../services/gerenciaApi';
import { AREA_STYLE, staffApi } from '../../services/staffApi';
import type { CapacityWeek, StaffMember } from '../../services/staffApi';
import { cn } from '../../utils/format';

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

interface Aviso {
  tone: 'bad' | 'risk';
  text: ReactNode;
  to: string;
}

/** Inicio de gerencia: cómo va el negocio hoy, en una sola pantalla. */
export function Dashboard() {
  const { user } = useAuth();
  const [fin, setFin] = useState<FinanceSummary | null>(null);
  const [com, setCom] = useState<ComercialHome | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [cap, setCap] = useState<CapacityWeek | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, c, s, k] = await Promise.allSettled([gerenciaApi.finance(), comercialApi.home(), staffApi.list(), staffApi.capacity(0)]);
    if (f.status === 'fulfilled') setFin(f.value);
    if (c.status === 'fulfilled') setCom(c.value);
    if (s.status === 'fulfilled') setStaff(s.value);
    if (k.status === 'fulfilled') setCap(k.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trabajando = staff.filter((w) => w.today.status === 'TRABAJANDO').length;
  const lesToca = staff.filter((w) => w.today.status !== 'DESCANSO' && w.today.status !== 'PERMISO').length;
  const sinMarcar = staff.filter((w) => w.today.status === 'SIN_MARCAR').length;
  const areaTop = cap?.areas[0];

  const avisos = useMemo(() => {
    const a: Aviso[] = [];
    const vencidos = fin?.expense.toPay.filter((x) => x.overdue) ?? [];
    if (vencidos.length)
      a.push({ tone: 'bad', text: <>Tienes <b>{vencidos.length} pago(s) vencido(s)</b> por {fmtSoles(vencidos.reduce((s, x) => s + x.amount, 0))}</>, to: '/gerencia/finanzas' });
    if (com?.kpis.late)
      a.push({ tone: 'bad', text: <><b>{com.kpis.late} vestido(s) atrasado(s)</b> en el taller</>, to: '/gerencia/produccion' });
    if (com?.collect.length)
      a.push({ tone: 'risk', text: <><b>{com.collect.length} contrato(s)</b> con saldo se recogen pronto ({fmtSoles(com.collect.reduce((s, x) => s + x.balance, 0))})</>, to: '/gerencia/contratos' });
    for (const ar of cap?.areas ?? []) {
      if (ar.status === 'LLENA' || ar.status === 'SIN_PERSONAL')
        a.push({ tone: 'risk', text: <>El área de <b>{ar.name.toLowerCase()}</b> está {AREA_STYLE[ar.status].label.toLowerCase()} esta semana</>, to: '/gerencia/capacidad' });
    }
    if (fin && fin.goal.amount === 0)
      a.push({ tone: 'risk', text: <>Aún no pusiste la <b>meta del mes</b></>, to: '/gerencia/finanzas' });
    if (fin && fin.result.margin !== null && fin.result.margin * 100 < fin.result.targetMargin)
      a.push({ tone: 'risk', text: <>El margen va en <b>{pct(fin.result.margin)}</b>, debajo del {fin.result.targetMargin}% objetivo</>, to: '/gerencia/finanzas' });
    return a;
  }, [fin, com, cap]);

  const nombre = user?.nombre?.trim()?.split(/\s+/)[0] || user?.username || '';
  const g = fin?.goal;
  const progreso = Math.min(1, g?.progress ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${saludo()}${nombre ? `, ${nombre}` : ''}`}
        subtitle={`Así va Fiancée hoy, ${new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}.`}
        actions={
          <div className="flex gap-2">
            <Link to="/gerencia/finanzas" className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-[#3a281f]">
              <PlusIcon className="h-4 w-4" /> Registrar gasto
            </Link>
            <button type="button" onClick={() => void load()} aria-label="Actualizar" className="rounded-xl border border-line bg-paper p-2.5 text-cocoa hover:bg-cream">
              <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {/* Dinero del mes */}
      {fin && (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Link to="/gerencia/finanzas" className="rounded-2xl border border-gold-soft bg-champagne-soft/40 p-5 transition-colors hover:bg-champagne-soft/60">
            <p className="flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
              <TargetIcon className="h-4 w-4 text-gold" /> Meta de {fin.monthLabel.split(' ')[0]}
            </p>
            {g && g.amount > 0 ? (
              <>
                <p className="mt-1 font-display text-3xl font-semibold text-cocoa">{pct(g.progress)}</p>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper">
                  <div className={cn('h-full rounded-full', progreso >= 1 ? 'bg-emerald-500' : 'bg-gold')} style={{ width: `${progreso * 100}%` }} />
                </div>
                <p className="mt-2 text-xs text-cocoa-muted">
                  {fmtSoles(fin.income.total)} de {fmtSoles(g.amount)}
                  {g.missing > 0 && g.daysLeft > 0 ? ` · faltan ${fmtSoles(g.missing)} en ${g.daysLeft} días` : ''}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-cocoa">Ponle una meta al mes para ver cuánto te falta →</p>
            )}
          </Link>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Entró" value={fmtSoles(fin.income.total)} tone="ok" foot={`${fin.income.count} pago(s)`} to="/gerencia/finanzas" />
            <Kpi label="Salió" value={fmtSoles(fin.expense.month)} tone="bad" foot={fin.expense.pendingMonth ? `${fmtSoles(fin.expense.pendingMonth)} por pagar` : 'Todo pagado'} to="/gerencia/finanzas" />
            <Kpi
              label="Quedó"
              value={fmtSoles(fin.result.profitEstimated)}
              tone={fin.result.profitEstimated >= 0 ? 'ok' : 'bad'}
              foot={fin.result.margin !== null ? `Margen ${pct(fin.result.margin)}` : 'Sin ingresos aún'}
              to="/gerencia/finanzas"
            />
            <Kpi label="Por cobrar" value={fmtSoles(fin.income.toCollectAll)} tone="risk" foot="saldo de clientas" to="/gerencia/contratos" />
          </div>
        </section>
      )}

      {/* Operación */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<WalletIcon className="h-4 w-4" />}
          label="Vendido este mes"
          value={com ? fmtSoles(com.kpis.soldMonth) : '—'}
          foot={com ? `${com.kpis.contractsMonth} contrato(s) nuevo(s)` : ''}
          to="/gerencia/contratos"
        />
        <Kpi
          icon={<ShirtIcon className="h-4 w-4" />}
          label="Vestidos en taller"
          value={com ? String(com.kpis.inWorkshop) : '—'}
          foot={com ? `${com.kpis.late} atrasado(s) · ${com.kpis.ready} listo(s)` : ''}
          tone={com?.kpis.late ? 'bad' : undefined}
          to="/gerencia/produccion"
        />
        <Kpi
          icon={<UsersIcon className="h-4 w-4" />}
          label="Personal trabajando"
          value={staff.length ? `${trabajando} de ${lesToca}` : '—'}
          foot={sinMarcar ? `${sinMarcar} aún no marca(n)` : 'Todas marcaron'}
          to="/gerencia/horas"
        />
        <Kpi
          icon={<GaugeIcon className="h-4 w-4" />}
          label="Área más cargada"
          value={areaTop ? areaTop.name : '—'}
          foot={areaTop ? `${AREA_STYLE[areaTop.status].label} · ${pct(areaTop.utilization)} ocupada` : ''}
          tone={areaTop && (areaTop.status === 'LLENA' || areaTop.status === 'SIN_PERSONAL') ? 'bad' : areaTop?.status === 'CASI_LLENA' ? 'risk' : undefined}
          to="/gerencia/capacidad"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          {/* Ingresos vs gastos */}
          {fin && (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-cocoa">Ingresos y gastos · últimos 6 meses</h2>
                <Link to="/gerencia/kpi" className="text-xs font-medium text-gold hover:underline">
                  Indicadores
                </Link>
              </div>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fin.months.slice(-6)} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EDE3D6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#76604F' }} tickLine={false} axisLine={false} tickFormatter={(v: string) => v.split(' ')[0]} />
                    <YAxis tick={{ fontSize: 11, fill: '#76604F' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip formatter={(v: number, n: string) => [fmtSoles(v), n]} cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Gastos" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Próximas entregas */}
          {com && (
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-2xl font-semibold text-cocoa">Próximas entregas</h2>
                <Link to="/gerencia/produccion" className="text-xs font-medium text-gold hover:underline">
                  Ver producción
                </Link>
              </div>
              {com.deliveries.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-line bg-paper p-6 text-center text-sm text-cocoa-faint">Sin entregas en los próximos 30 días.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-paper">
                  {com.deliveries.slice(0, 6).map((d) => {
                    const t = DELIVERY_TONE[d.tone];
                    return (
                      <li key={d.code} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', t.dot)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-cocoa">
                            <b className="font-medium">{d.code}</b> · {d.client}
                          </span>
                          <span className="block text-xs text-cocoa-muted">
                            {d.status === 'LISTO' ? 'Listo' : d.tone === 'late' ? 'Atrasado' : d.statusLabel} · {fmtFecha(d.date)} ({cuandoFalta(d.daysLeft)})
                          </span>
                        </span>
                        {d.balance > 0 && <span className="tabular shrink-0 text-xs font-semibold text-amber-800">Debe {fmtSoles(d.balance)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          {/* Atención */}
          <section className={cn('rounded-2xl border p-4', avisos.length ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60')}>
            <h2 className={cn('flex items-center gap-2 text-sm font-semibold', avisos.length ? 'text-amber-900' : 'text-emerald-900')}>
              <AlertTriangleIcon className="h-4 w-4" /> {avisos.length ? 'Necesita tu atención' : 'Todo en orden'}
            </h2>
            {avisos.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-900">No hay pagos vencidos, atrasos ni áreas llenas. 👌</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {avisos.map((a, i) => (
                  <li key={i}>
                    <Link to={a.to} className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2 text-sm text-cocoa hover:bg-cream">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', a.tone === 'bad' ? 'bg-rose-500' : 'bg-amber-500')} />
                      <span className="min-w-0 flex-1">{a.text}</span>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-cocoa-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Por pagar pronto */}
          {fin && fin.expense.toPay.length > 0 && (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-cocoa">Por pagar</h2>
                <span className="tabular text-sm font-semibold text-rose-700">{fmtSoles(fin.expense.pendingAll)}</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {fin.expense.toPay.slice(0, 5).map((x) => (
                  <li key={`${x.kind}-${x.id}`} className="flex justify-between gap-3">
                    <span className={cn('truncate', x.overdue ? 'text-rose-700' : 'text-cocoa')}>
                      {x.concept}
                      <span className="text-xs text-cocoa-muted">{x.due ? ` · ${fmtFecha(x.due)}` : ''}</span>
                    </span>
                    <span className="tabular shrink-0 text-cocoa">{fmtSoles(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Cobrar pronto */}
          {com && com.collect.length > 0 && (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <h2 className="text-sm font-semibold text-cocoa">Cobrar antes del recojo</h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {com.collect.slice(0, 5).map((c) => (
                  <li key={c.contractId} className="flex justify-between gap-3">
                    <span className="truncate text-cocoa">
                      {c.client || c.contract} <span className="text-xs text-cocoa-muted">· {cuandoFalta(c.daysLeft)}</span>
                    </span>
                    <span className="tabular shrink-0 font-semibold text-amber-800">{fmtSoles(c.balance)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  foot,
  tone,
  to,
  icon,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: 'ok' | 'bad' | 'risk';
  to: string;
  icon?: ReactNode;
}) {
  return (
    <Link to={to} className="min-w-0 rounded-2xl border border-line bg-paper p-4 transition-colors hover:bg-cream/50">
      <p className="flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
        {icon && <span className="text-gold">{icon}</span>} {label}
      </p>
      <p
        className={cn(
          'tabular mt-1 truncate text-xl font-semibold sm:text-2xl',
          tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : tone === 'risk' ? 'text-amber-800' : 'text-cocoa'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-cocoa-muted">{foot}</p>
    </Link>
  );
}
