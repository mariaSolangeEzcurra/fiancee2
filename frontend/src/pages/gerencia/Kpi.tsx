import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { fmtSoles } from '../../services/comercialApi';
import { gerenciaApi, pct } from '../../services/gerenciaApi';
import type { Indicators, Slice } from '../../services/gerenciaApi';
import { staffApi } from '../../services/staffApi';
import type { CapacityWeek } from '../../services/staffApi';
import { cn } from '../../utils/format';

type Periodo = '3' | '6' | '12';

const PALETA = ['#4A3428', '#9A7640', '#CDB17A', '#10b981', '#0ea5e9', '#f43f5e', '#8b5cf6', '#94a3b8', '#f59e0b'];
const AX = { fontSize: 11, fill: '#76604F' };
const GRID = '#EDE3D6';
const miles = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
const mesCorto = (v: string) => v.split(' ')[0];

/** Indicadores del negocio para gerencia, con gráficos y explicación sencilla. */
export function Kpi() {
  const [periodo, setPeriodo] = useState<Periodo>('6');
  const [d, setD] = useState<Indicators | null>(null);
  const [cap, setCap] = useState<CapacityWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    gerenciaApi
      .indicators(Number(periodo))
      .then((x) => alive && setD(x))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [periodo]);

  useEffect(() => {
    staffApi.capacity(0).then(setCap).catch(() => undefined);
  }, []);

  const margenSerie = d?.series.map((x) => ({ ...x, marginPct: x.margin === null ? null : Math.round(x.margin * 100) })) ?? [];
  const capData = (cap?.areas ?? []).map((a) => ({ name: a.name, uso: Math.round(a.utilization * 100), status: a.status }));

  return (
    <div className="space-y-8">
      <PageHeader title="Indicadores" subtitle="Cómo le va al negocio: dinero, ventas, producción y personal. Cada número y gráfico tiene su explicación." />

      <div className="flex items-center gap-3">
        <div className="w-80 max-w-full">
          <Segmented<Periodo>
            ariaLabel="Periodo"
            value={periodo}
            onChange={setPeriodo}
            options={[
              { value: '3', label: 'Últimos 3 meses' },
              { value: '6', label: '6 meses' },
              { value: '12', label: '12 meses' },
            ]}
          />
        </div>
        {loading && <RefreshCwIcon className="h-4 w-4 animate-spin text-cocoa-muted" />}
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {d && (
        <div className={cn('space-y-10', loading && 'opacity-60')}>
          {/* ─────────── DINERO ─────────── */}
          <Bloque titulo="Dinero">
            <Fila>
              <Ind label="Ingresos" value={fmtSoles(d.money.income)} help="Todo lo cobrado en el periodo." />
              <Ind label="Gastos" value={fmtSoles(d.money.expense)} help="Gastos pagados registrados en Finanzas." />
              <Ind
                label="Margen"
                value={pct(d.money.margin)}
                tone={d.money.margin === null ? undefined : d.money.margin * 100 >= d.money.targetMargin ? 'ok' : 'bad'}
                help={`De cada S/ 100 que entran, cuánto queda (con gastos pagados). Objetivo: ${d.money.targetMargin}%.`}
              />
              <Ind label="Metas cumplidas" value={`${d.money.goalsReached} de ${d.series.length}`} help="Meses en que se llegó a la meta de ingresos." />
            </Fila>
            <Grid2>
              <Grafico titulo="Cobrado vs. meta" ayuda="Barra verde: lo cobrado. Línea dorada: la meta del mes.">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.series} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} tickFormatter={mesCorto} />
                    <YAxis tick={AX} tickLine={false} axisLine={false} tickFormatter={miles} />
                    <Tooltip formatter={(v: number, n: string) => [fmtSoles(v), n]} cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Cobrado" fill="#10b981" radius={[4, 4, 0, 0]}>
                      {d.series.map((x) => (
                        <Cell key={x.month} fill={x.goalReached ? '#10b981' : '#6ee7b7'} />
                      ))}
                    </Bar>
                    <Line dataKey="goal" name="Meta" stroke="#9A7640" strokeDasharray="5 4" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="Ingresos, gastos y utilidad" ayuda="La línea oscura es lo que quedó cada mes.">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.series} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} tickFormatter={mesCorto} />
                    <YAxis tick={AX} tickLine={false} axisLine={false} tickFormatter={miles} />
                    <Tooltip formatter={(v: number, n: string) => [fmtSoles(v), n]} cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Gastos" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    <Line dataKey="profit" name="Utilidad" stroke="#4A3428" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="Margen de cada mes" ayuda={`La línea punteada es tu objetivo (${d.money.targetMargin}%).`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={margenSerie} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} tickFormatter={mesCorto} />
                    <YAxis tick={AX} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip formatter={(v: number) => [`${v}%`, 'Margen']} />
                    <ReferenceLine y={d.money.targetMargin} stroke="#9A7640" strokeDasharray="5 4" />
                    <Line dataKey="marginPct" name="Margen" stroke="#4A3428" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="¿En qué se gasta?" ayuda="Gastos pagados del periodo por categoría." alto="auto">
                <Dona datos={d.expenseCategories} vacio="Aún no hay gastos registrados en el periodo." />
              </Grafico>
            </Grid2>
          </Bloque>

          {/* ─────────── VENTAS ─────────── */}
          <Bloque titulo="Ventas y cobros">
            <Fila>
              <Ind label="Contratos" value={String(d.sales.contracts)} help={`${d.sales.dresses} vestido(s) vendidos en total.`} />
              <Ind label="Ticket promedio" value={fmtSoles(d.sales.avgTicket)} help={`Lo que vale en promedio un contrato. Por vestido: ${fmtSoles(d.sales.avgDressPrice)}.`} />
              <Ind label="Simulaciones" value={String(d.sales.simulations)} help={`${pct(d.sales.conversion)} de las simulaciones terminaron en contrato.`} />
              <Ind
                label="Ya cobrado de lo vendido"
                value={pct(d.sales.collectedRate)}
                tone={d.sales.collectedRate !== null && d.sales.collectedRate < 0.5 ? 'risk' : undefined}
                help="De los contratos del periodo, cuánto ya se pagó."
              />
            </Fila>
            <Grid2>
              <Grafico titulo="Ventas por mes" ayuda="Barras: monto vendido. Línea: ticket promedio por contrato.">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.series} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} tickFormatter={mesCorto} />
                    <YAxis tick={AX} tickLine={false} axisLine={false} tickFormatter={miles} />
                    <Tooltip formatter={(v: number, n: string) => [fmtSoles(v), n]} cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sold" name="Vendido" fill="#CDB17A" radius={[4, 4, 0, 0]} />
                    <Line dataKey="avgTicket" name="Ticket promedio" stroke="#4A3428" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="¿Qué se vende más?" ayuda="Por tipo de evento (monto vendido)." alto="auto">
                <Dona datos={d.byEvent} vacio="Sin contratos en el periodo." />
              </Grafico>
              <Grafico titulo="Taller y modalidad" ayuda="Dónde se hacen los vestidos y si son venta o alquiler." alto="auto">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-cocoa-muted">Por taller</p>
                    <Dona datos={d.byWorkshop} chica vacio="Sin datos." />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-cocoa-muted">Venta o alquiler</p>
                    <Dona datos={d.byModality} chica vacio="Sin datos." />
                  </div>
                </div>
              </Grafico>
              <Grafico titulo="¿Cómo pagan las clientas?" ayuda="Pagos recibidos del periodo por método." alto="auto">
                <Dona datos={d.paymentMethods} vacio="Sin pagos en el periodo." />
              </Grafico>
              <Grafico titulo="¿Cuánto falta cobrar y para cuándo?" ayuda="Saldo de contratos activos según la fecha de recojo.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.receivables} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" tick={AX} tickLine={false} axisLine={false} tickFormatter={miles} />
                    <YAxis type="category" dataKey="name" tick={AX} tickLine={false} axisLine={false} width={110} />
                    <Tooltip formatter={(v: number) => [fmtSoles(v), 'Por cobrar']} cursor={{ fill: '#F6EEDD' }} />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                      {d.receivables.map((x, i) => (
                        <Cell key={x.name} fill={['#f43f5e', '#f59e0b', '#CDB17A', '#94a3b8'][i] ?? '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="De contrato a pagado" ayuda="Contratos del periodo: cuántos ya pagaron algo y cuántos ya pagaron todo." alto="auto">
                <Embudo pasos={d.funnel} />
              </Grafico>
            </Grid2>
          </Bloque>

          {/* ─────────── PRODUCCIÓN Y PERSONAL ─────────── */}
          <Bloque titulo="Producción y personal">
            <Fila>
              <Ind
                label="Entregados a tiempo"
                value={pct(d.production.onTimeRate)}
                tone={d.production.onTimeRate === null ? undefined : d.production.onTimeRate >= 0.9 ? 'ok' : d.production.onTimeRate >= 0.7 ? 'risk' : 'bad'}
                help={`${d.production.onTime} de ${d.production.finished} vestido(s) terminados antes de su fecha.`}
              />
              <Ind label="Días en el taller" value={d.production.avgDays !== null ? `${d.production.avgDays} días` : '—'} help="Promedio desde el primer proceso hasta terminar el vestido." />
              <Ind label="Tiempo en vestidos" value={pct(d.people.productive)} help="Del tiempo que el personal estuvo en el taller, cuánto fue trabajando vestidos." />
              <Ind label="Horas trabajadas" value={`${Math.round(d.people.worked)} h`} help={`${Math.round(d.people.inDresses)} h fueron en vestidos.`} />
            </Fila>
            <Grid2>
              <Grafico titulo="Entregas a tiempo y tarde" ayuda="Vestidos terminados cada mes.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} tickFormatter={mesCorto} />
                    <YAxis tick={AX} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="deliveredOnTime" name="A tiempo" stackId="e" fill="#10b981" />
                    <Bar dataKey="deliveredLate" name="Tarde" stackId="e" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="Horas del personal por mes" ayuda="Horas en el taller vs. horas trabajando vestidos.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.series} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} tickFormatter={mesCorto} />
                    <YAxis tick={AX} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number, n: string) => [`${v} h`, n]} cursor={{ fill: '#F6EEDD' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="hoursWorked" name="En el taller" fill="#CDB17A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="hoursInDresses" name="En vestidos" fill="#4A3428" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="¿En qué procesos se va el tiempo?" ayuda="Horas registradas por las trabajadoras en cada proceso.">
                {d.hoursByProcess.length === 0 ? (
                  <Vacio texto="Aún no hay horas registradas en procesos." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.hoursByProcess} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" tick={AX} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tick={AX} tickLine={false} axisLine={false} width={120} />
                      <Tooltip formatter={(v: number) => [`${v} h`, 'Horas']} cursor={{ fill: '#F6EEDD' }} />
                      <Bar dataKey="hours" fill="#9A7640" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Grafico>
              <Grafico titulo="Carga del taller esta semana" ayuda="Qué tan ocupada está cada área (100% = llena).">
                {capData.length === 0 ? (
                  <Vacio texto="Cargando…" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={capData} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" domain={[0, 100]} tick={AX} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={AX} tickLine={false} axisLine={false} width={90} />
                      <Tooltip formatter={(v: number) => [`${v}%`, 'Ocupado']} cursor={{ fill: '#F6EEDD' }} />
                      <ReferenceLine x={80} stroke="#f59e0b" strokeDasharray="4 4" />
                      <Bar dataKey="uso" radius={[0, 4, 4, 0]}>
                        {capData.map((x) => (
                          <Cell key={x.name} fill={{ SIN_PERSONAL: '#f43f5e', LLENA: '#f43f5e', CASI_LLENA: '#f59e0b', CON_ESPACIO: '#10b981', LIBRE: '#0ea5e9' }[x.status] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Grafico>
            </Grid2>
            <Grid2>
              <Grafico titulo="¿Los tiempos del catálogo son reales?" ayuda="Horas estimadas vs. horas que de verdad tomó cada proceso (promedio por vestido)." alto="auto">
                {d.production.processes.length === 0 ? (
                  <Vacio texto="Todavía no hay procesos terminados con tiempo registrado por las trabajadoras." />
                ) : (
                  <ul className="divide-y divide-line">
                    {d.production.processes.map((p) => {
                      const diff = p.diff ?? 0;
                      return (
                        <li key={p.name} className="flex items-center gap-3 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate capitalize text-cocoa">{p.name}</span>
                            <span className="block text-[11px] text-cocoa-muted">
                              {p.count} vestido(s) · estimado {p.estimated} h · real {p.real} h
                            </span>
                          </span>
                          <span
                            className={cn(
                              'tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                              Math.abs(diff) <= 0.15 ? 'bg-emerald-50 text-emerald-800' : diff > 0 ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-800'
                            )}
                          >
                            {Math.abs(diff) <= 0.15 ? 'Justo' : diff > 0 ? `+${pct(diff)} más lento` : `${pct(-diff)} más rápido`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Grafico>
              <Grafico titulo="Clientas que más compraron" ayuda="Monto total de sus contratos en el periodo." alto="auto">
                {d.topClients.length === 0 ? (
                  <Vacio texto="Sin contratos en el periodo." />
                ) : (
                  <ol className="space-y-2.5">
                    {d.topClients.map((c, i) => {
                      const max = d.topClients[0].total || 1;
                      return (
                        <li key={c.name}>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-champagne-soft text-xs font-semibold text-cocoa">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-cocoa">{c.name}</span>
                            <span className="tabular shrink-0 font-semibold text-cocoa">{fmtSoles(c.total)}</span>
                          </div>
                          <div className="ml-9 mt-1 h-1.5 overflow-hidden rounded-full bg-sand/60">
                            <div className="h-full rounded-full bg-gold" style={{ width: `${(c.total / max) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Grafico>
            </Grid2>
          </Bloque>
        </div>
      )}
    </div>
  );
}

// ─── Piezas ────────────────────────────────────────────

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl font-semibold text-cocoa">{titulo}</h2>
      {children}
    </section>
  );
}

function Fila({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2">{children}</div>;
}

function Grafico({ titulo, ayuda, children, alto = 'h-60' }: { titulo: string; ayuda: string; children: ReactNode; alto?: string }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-paper p-4">
      <h3 className="text-sm font-semibold text-cocoa">{titulo}</h3>
      <p className="text-xs text-cocoa-muted">{ayuda}</p>
      <div className={cn('mt-3', alto !== 'auto' && alto)}>{children}</div>
    </section>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p className="flex h-full min-h-[6rem] items-center justify-center text-center text-sm text-cocoa-faint">{texto}</p>;
}

/** Dona con leyenda al costado (monto y %). */
function Dona({ datos, vacio, chica = false }: { datos: Slice[]; vacio: string; chica?: boolean }) {
  const total = datos.reduce((s, x) => s + x.total, 0);
  if (!datos.length || total <= 0) return <Vacio texto={vacio} />;
  const tam = chica ? 120 : 170;
  return (
    <div className={cn('flex items-center gap-4', chica ? 'flex-col' : 'flex-col sm:flex-row')}>
      <div className="relative shrink-0" style={{ width: tam, height: tam }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={datos} dataKey="total" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={datos.length > 1 ? 2 : 0} stroke="none">
              {datos.map((x, i) => (
                <Cell key={x.name} fill={PALETA[i % PALETA.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [fmtSoles(v), n]} />
          </PieChart>
        </ResponsiveContainer>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-sm font-semibold text-cocoa">{fmtSoles(total)}</span>
          {!chica && <span className="text-[10px] text-cocoa-muted">total</span>}
        </span>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {datos.slice(0, 7).map((x, i) => (
          <li key={x.name} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETA[i % PALETA.length] }} />
            <span className="min-w-0 flex-1 truncate text-cocoa">{x.name}</span>
            <span className="tabular shrink-0 text-cocoa-muted">{Math.round((x.total / total) * 100)}%</span>
            {!chica && <span className="tabular w-20 shrink-0 text-right font-semibold text-cocoa">{fmtSoles(x.total)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Embudo({ pasos }: { pasos: { name: string; value: number }[] }) {
  const max = Math.max(1, ...pasos.map((p) => p.value));
  if (!pasos.length || max === 0) return <Vacio texto="Sin contratos en el periodo." />;
  return (
    <ul className="space-y-2">
      {pasos.map((p, i) => (
        <li key={p.name}>
          <div className="flex justify-between text-xs">
            <span className="text-cocoa">{p.name}</span>
            <span className="tabular font-semibold text-cocoa">
              {p.value}
              {i > 0 && pasos[0].value > 0 && <span className="font-normal text-cocoa-muted"> ({Math.round((p.value / pasos[0].value) * 100)}%)</span>}
            </span>
          </div>
          <div className="mt-1 h-6 overflow-hidden rounded-lg bg-sand/50">
            <div className="h-full rounded-lg" style={{ width: `${(p.value / max) * 100}%`, background: PALETA[i] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}


function Ind({ label, value, help, tone }: { label: string; value: string; help: string; tone?: 'ok' | 'bad' | 'risk' }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <p className="text-xs font-medium text-cocoa-muted">{label}</p>
      <p
        className={cn(
          'tabular mt-1 truncate text-2xl font-semibold',
          tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : tone === 'risk' ? 'text-amber-800' : 'text-cocoa'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-cocoa-muted">{help}</p>
    </div>
  );
}
