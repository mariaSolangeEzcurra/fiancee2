import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, SparklesIcon } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { incomeItems } from '../../data/finance';
import { clientRequests } from '../../data/requests';
import { AreaCapacityList } from '../../components/capacity/AreaCapacityList';
import { GoalProgress } from '../../components/finance/GoalProgress';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusPill } from '../../components/ui/StatusPill';
import { bottleneck, periodLoad } from '../../utils/capacity';
import { fmtLong, fmtShort, TODAY } from '../../utils/dates';
import { dressRisk } from '../../utils/dresses';
import { computeFinance } from '../../utils/finance';
import { fmtH, fmtMoney } from '../../utils/format';
import { areaName } from '../../utils/processes';

export function FioHome() {
  const { dresses, workers, finance } = useApp();
  const loads = useMemo(() => periodLoad(dresses, workers, TODAY, 0, 24), [dresses, workers]);
  const b = bottleneck(loads);
  const summary = useMemo(() => computeFinance(finance, incomeItems), [finance]);
  const recent = [...dresses].sort((a, b2) => a.isNew === b2.isNew ? b2.code.localeCompare(a.code) : a.isNew ? -1 : 1).slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Buenos días, Fio"
        subtitle={`Hoy es ${fmtLong(TODAY)}. Tienes ${clientRequests.length} solicitudes por evaluar antes de confirmar fechas.`}
        actions={
        <Link to="/fio/simulador" className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-5 py-2.5 text-sm font-semibold text-ivory transition-colors duration-150 hover:bg-[#3a281f]">
            <SparklesIcon className="h-4 w-4" aria-hidden="true" /> Nueva simulación
          </Link>
        } />
      

      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section>
          <h2 className="font-display text-2xl font-semibold text-cocoa">Solicitudes por evaluar</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {clientRequests.map((r) =>
            <li key={r.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-base font-medium text-cocoa">{r.summary}</p>
                  <p className="mt-0.5 text-xs text-cocoa-muted">
                    {r.client} · {r.channel} · recibido {r.received.toLowerCase()} · {fmtMoney(r.price)}
                  </p>
                </div>
                <Link
                to={`/fio/simulador?solicitud=${r.id}`}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-cocoa/20 bg-paper px-4 py-2 text-sm font-medium text-cocoa transition-colors duration-150 hover:bg-cream">
                
                  Simular capacidad <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            )}
          </ul>

          <h2 className="mt-10 font-display text-2xl font-semibold text-cocoa">Contratos recientes</h2>
          <ul className="mt-4 divide-y divide-line">
            {recent.map((d) => {
              const risk = dressRisk(d, TODAY);
              return (
                <li key={d.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="tabular font-semibold text-cocoa">{d.code}</span> <span className="text-cocoa">{d.client}</span>
                    {d.isNew && <span className="ml-2 rounded-full bg-blush-soft px-1.5 py-0.5 text-[10px] font-semibold text-blush-deep">Nuevo</span>}
                    <span className="block text-xs text-cocoa-muted">
                      {d.status} · entrega {fmtShort(d.deadline)}
                    </span>
                  </span>
                  <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                </li>);

            })}
          </ul>
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-line bg-paper p-6">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Horas libres · 4 semanas</h2>
            <p className="mt-1 text-xs text-cocoa-muted">Lo que todavía se puede vender, proceso por proceso.</p>
            <div className="mt-5">
              <AreaCapacityList loads={loads} variant="compact" />
            </div>
            {b && b.utilization >= 0.85 &&
            <p className="mt-5 rounded-lg bg-risk-soft px-3 py-2 text-xs text-risk">
                {areaName(b.area)} es el proceso más cargado: solo {fmtH(b.available)} libres. Revisa vestidos que lo necesiten intensamente.
              </p>
            }
          </section>

          <section className="rounded-2xl border border-line bg-paper p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold text-cocoa">Meta de septiembre</h2>
              <Link to="/fio/finanzas" className="text-xs font-medium text-gold hover:underline">
                Ver finanzas
              </Link>
            </div>
            <div className="mt-4">
              <GoalProgress settings={finance} summary={summary} size="sm" />
            </div>
          </section>
        </aside>
      </div>
    </div>);

}