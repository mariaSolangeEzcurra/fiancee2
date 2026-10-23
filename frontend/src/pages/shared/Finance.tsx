import React, { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { incomeItems, pendingExpenses } from '../../data/finance';
import { FixedCostsForm } from '../../components/finance/FixedCostsForm';
import { GoalProgress } from '../../components/finance/GoalProgress';
import { RevenueCapacityPanel } from '../../components/finance/RevenueCapacityPanel';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { fmtShort } from '../../utils/dates';
import { computeFinance } from '../../utils/finance';
import { fmtMoney, fmtPct } from '../../utils/format';

export function Finance() {
  const { finance } = useApp();
  const [editing, setEditing] = useState(false);
  const s = useMemo(() => computeFinance(finance, incomeItems), [finance]);
  const pendingTotal = pendingExpenses.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-8">
      <PageHeader title="Finanzas" subtitle="Septiembre 2026 · ingresos, costos y meta del mes, relacionados con la capacidad real del taller." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="rounded-2xl border border-line bg-paper p-6">
          <h2 className="font-display text-2xl font-semibold text-cocoa">Meta mensual</h2>
          <div className="mt-5">
            <GoalProgress settings={finance} summary={s} />
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-paper p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Gastos fijos mensuales</h2>
            <button type="button" onClick={() => setEditing((e) => !e)} className="text-xs font-medium text-gold hover:underline">
              {editing ? 'Cancelar' : 'Modificar'}
            </button>
          </div>
          {editing ?
          <div className="mt-5">
              <FixedCostsForm onSaved={() => setEditing(false)} />
            </div> :

          <dl className="mt-5 space-y-3 text-sm">
              <Line label="Personal operativo del taller" value={fmtMoney(finance.personal)} />
              <Line label="Servicios y otros" value={fmtMoney(finance.servicios)} />
              <Line label="Alquiler" value={fmtMoney(finance.alquiler)} />
              <div className="flex justify-between border-t border-line pt-3 text-base font-semibold text-cocoa">
                <dt>Total</dt>
                <dd className="tabular">{fmtMoney(s.fixed)}</dd>
              </div>
            </dl>
          }
        </section>
      </div>

      <section className="grid grid-cols-2 gap-6 border-y border-line py-6 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Ingresos del mes" value={fmtMoney(s.revenue)} />
        <Stat label="Costos" value={fmtMoney(s.costs)} sub={`fijos + materiales ${fmtPct(finance.materialsRate)}`} />
        <Stat label="Margen de contribución" value={fmtMoney(s.contribution)} />
        <Stat label="Utilidad" value={fmtMoney(s.profit)} tone={s.profit >= 0 ? 'ok' : 'bad'} />
        <Stat label="Margen" value={fmtPct(s.margin)} sub={`objetivo ${fmtPct(finance.targetMargin)}`} tone={s.margin >= finance.targetMargin ? 'ok' : 'bad'} />
        <Stat label="Punto de equilibrio" value={fmtMoney(s.breakEven)} />
        <Stat label="Gastos pendientes" value={fmtMoney(pendingTotal)} tone="risk" />
      </section>

      <RevenueCapacityPanel />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-paper p-6">
          <h2 className="font-display text-2xl font-semibold text-cocoa">Ingresos del mes</h2>
          <ul className="mt-4 divide-y divide-line text-sm">
            {incomeItems.map((i) =>
            <li key={i.id} className="flex justify-between gap-4 py-2.5">
                <span className="text-cocoa">
                  {i.concept} <span className="tabular text-xs text-cocoa-faint">· {fmtShort(i.date)}</span>
                </span>
                <span className="tabular font-medium text-cocoa">{fmtMoney(i.amount)}</span>
              </li>
            )}
          </ul>
        </section>
        <section className="rounded-2xl border border-line bg-paper p-6">
          <h2 className="font-display text-2xl font-semibold text-cocoa">Gastos pendientes</h2>
          <ul className="mt-4 divide-y divide-line text-sm">
            {pendingExpenses.map((p) =>
            <li key={p.id} className="flex justify-between gap-4 py-2.5">
                <span className="text-cocoa">
                  {p.concept} <span className="tabular text-xs text-cocoa-faint">· vence {fmtShort(p.due)}</span>
                </span>
                <span className="tabular font-medium text-cocoa">{fmtMoney(p.amount)}</span>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>);

}

function Line({ label, value }: {label: string;value: string;}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-cocoa-muted">{label}</dt>
      <dd className="tabular font-medium text-cocoa">{value}</dd>
    </div>);

}