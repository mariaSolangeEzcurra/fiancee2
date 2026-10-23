import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';
import { AlertItem } from '../../components/alerts/AlertItem';
import { AreaCapacityList } from '../../components/capacity/AreaCapacityList';
import { BottleneckBanner } from '../../components/capacity/BottleneckBanner';
import { DressDrawer } from '../../components/dress/DressDrawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { StatusPill } from '../../components/ui/StatusPill';
import { buildAlerts } from '../../utils/alerts';
import { periodLoad } from '../../utils/capacity';
import { calendarDaysUntil, fmtLong, fmtShort, TODAY } from '../../utils/dates';
import { currentStep, dressRisk, dressTotals } from '../../utils/dresses';
import { fmtH } from '../../utils/format';
import { processName } from '../../utils/processes';

export function JefaHome() {
  const { dresses, workers } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const active = dresses.filter((d) => d.status !== 'Terminado');
  const week = useMemo(() => periodLoad(dresses, workers, TODAY, 0, 6), [dresses, workers]);
  const alerts = useMemo(() => buildAlerts(dresses, workers, TODAY), [dresses, workers]);
  const dueSoon = active.filter((d) => calendarDaysUntil(d.deadline) <= 14).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const fresh = active.filter((d) => d.isNew);
  const unassigned = active.filter((d) => d.status === 'En cola' && d.steps[0]?.workerIds.length === 0);
  const inRisk = active.filter((d) => dressRisk(d, TODAY).tone !== 'ok').length;

  return (
    <div className="space-y-8">
      <PageHeader title="Control de producción" subtitle={`Buenos días, Patricia. ${fmtLong(TODAY)[0].toUpperCase()}${fmtLong(TODAY).slice(1)}.`} />

      <div className="grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-4">
        <Stat label="En producción" value={active.filter((d) => d.status === 'En producción').length} />
        <Stat label="En cola" value={active.filter((d) => d.status === 'En cola').length} sub={`${unassigned.length} sin asignar`} />
        <Stat label="Con riesgo o atraso" value={inRisk} tone={inRisk ? 'risk' : 'ok'} />
        <Stat label="Horas pendientes" value={fmtH(active.reduce((s, d) => s + dressTotals(d).remaining, 0))} />
      </div>

      {fresh.length > 0 &&
      <section className="rounded-2xl border border-blush bg-blush-soft/60 p-5">
          <h2 className="text-sm font-semibold text-cocoa">Nuevos contratos aceptados por Comercial</h2>
          <ul className="mt-3 space-y-2">
            {fresh.map((d) =>
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-cocoa">
                  <span className="tabular font-semibold">{d.code}</span> · {d.client} · entrega {fmtShort(d.deadline)} · {fmtH(dressTotals(d).est)}
                </span>
                <button type="button" onClick={() => setOpenId(d.id)} className="rounded-lg bg-cocoa px-3 py-1.5 text-xs font-medium text-ivory">
                  Asignar procesos y personal
                </button>
              </li>
          )}
          </ul>
        </section>
      }

      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Vencen en los próximos 14 días</h2>
            <Link to="/taller/cola" className="text-xs font-medium text-gold hover:underline">
              Ver cola completa
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {dueSoon.map((d) => {
              const risk = dressRisk(d, TODAY);
              const step = currentStep(d);
              const days = calendarDaysUntil(d.deadline);
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => setOpenId(d.id)} className="grid w-full grid-cols-[3.5rem_1fr_auto] items-center gap-4 py-3.5 text-left transition-colors duration-150 hover:bg-cream/50">
                    <span className="text-center">
                      <span className="tabular block text-xl font-semibold leading-none text-cocoa">{Math.max(0, days)}</span>
                      <span className="block text-[10px] text-cocoa-muted">{days === 1 ? 'día' : 'días'}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-cocoa">
                        <span className="tabular font-semibold">{d.code}</span> · {d.client}
                      </span>
                      <span className="block text-xs text-cocoa-muted">
                        {step ? processName(step.process) : '—'} · faltan {fmtH(dressTotals(d).remaining)} · entrega {fmtShort(d.deadline)}
                      </span>
                    </span>
                    <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                  </button>
                </li>);

            })}
          </ul>

          <div className="mt-10 flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Alertas prioritarias</h2>
            <Link to="/taller/alertas" className="text-xs font-medium text-gold hover:underline">
              Ver todas ({alerts.length})
            </Link>
          </div>
          <div className="mt-2 divide-y divide-line">
            {alerts.slice(0, 4).map((a) =>
            <AlertItem key={a.id} alert={a} compact />
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <BottleneckBanner loads={week} />
          <section className="rounded-2xl border border-line bg-paper p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold text-cocoa">Horas libres esta semana</h2>
              <Link to="/taller/capacidad" className="text-xs font-medium text-gold hover:underline">
                Detalle
              </Link>
            </div>
            <div className="mt-5">
              <AreaCapacityList loads={week} variant="compact" />
            </div>
          </section>
        </aside>
      </div>

      <DressDrawer dressId={openId} onClose={() => setOpenId(null)} />
    </div>);

}