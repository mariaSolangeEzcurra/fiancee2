import React, { useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { AreaCapacityList } from '../../components/capacity/AreaCapacityList';
import { BottleneckBanner } from '../../components/capacity/BottleneckBanner';
import { RevenueCapacityPanel } from '../../components/finance/RevenueCapacityPanel';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { periodLoad } from '../../utils/capacity';
import { calendarDaysUntil, TODAY } from '../../utils/dates';
import { dressRisk, dressTotals } from '../../utils/dresses';
import { fmtH } from '../../utils/format';

export function FioSummary() {
  const { dresses, workers } = useApp();
  const active = dresses.filter((d) => d.status !== 'Terminado');
  const loads = useMemo(() => periodLoad(dresses, workers, TODAY, 0, 24), [dresses, workers]);
  const pending = active.reduce((s, d) => s + dressTotals(d).remaining, 0);
  const atRisk = active.filter((d) => dressRisk(d, TODAY).tone !== 'ok').length;

  return (
    <div className="space-y-8">
      <PageHeader title="Resumen" subtitle="Situación comercial y productiva en una sola vista." />
      <div className="grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-4">
        <Stat label="En producción" value={active.filter((d) => d.status === 'En producción').length} />
        <Stat label="En cola" value={active.filter((d) => d.status === 'En cola').length} />
        <Stat label="Entregas en 30 días" value={active.filter((d) => calendarDaysUntil(d.deadline) <= 30).length} />
        <Stat label="Con riesgo o atraso" value={atRisk} tone={atRisk ? 'risk' : 'ok'} sub={`${fmtH(pending)} pendientes en total`} />
      </div>
      <RevenueCapacityPanel />
      <section className="rounded-2xl border border-line bg-paper p-6">
        <h2 className="font-display text-2xl font-semibold text-cocoa">Capacidad de las próximas 4 semanas</h2>
        <BottleneckBanner loads={loads} className="mt-4" />
        <div className="mt-2">
          <AreaCapacityList loads={loads} />
        </div>
      </section>
    </div>);

}