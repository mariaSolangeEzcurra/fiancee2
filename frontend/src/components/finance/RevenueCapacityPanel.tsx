import React, { useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { incomeItems } from '../../data/finance';
import { TODAY } from '../../utils/dates';
import { computeFinance, revenueCapacity } from '../../utils/finance';
import { cn, fmtH, fmtMoney, fmtNum } from '../../utils/format';
import { areaName } from '../../utils/processes';

export function RevenueCapacityPanel() {
  const { dresses, workers, templates, finance } = useApp();
  const summary = useMemo(() => computeFinance(finance, incomeItems), [finance]);
  const rc = useMemo(() => revenueCapacity(dresses, workers, templates, TODAY, summary.gap), [dresses, workers, templates, summary.gap]);
  const enough = rc.possible >= rc.neededDresses;

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h2 className="font-display text-2xl font-semibold text-cocoa">¿Cuánto necesitamos generar para alcanzar la meta?</h2>
      <p className="mt-1 text-sm text-cocoa-muted">La meta financiera se contrasta con la capacidad productiva real, no con ventas ilimitadas.</p>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-cocoa-muted">Meta financiera</p>
          <p className="tabular mt-1 text-3xl font-semibold text-cocoa">{fmtMoney(summary.gap)}</p>
          <p className="mt-2 text-sm leading-relaxed text-cocoa">
            ≈ <span className="font-semibold">{fmtNum(rc.neededDresses)} vestidos</span> con un ticket promedio de {fmtMoney(rc.avgTicket)}, que requieren unas{' '}
            <span className="font-semibold">{fmtH(rc.neededHours)}</span> de producción.
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-cocoa-muted">Capacidad productiva disponible · próximos {rc.horizonDays} días hábiles</p>
          <p className={cn('tabular mt-1 text-3xl font-semibold', enough ? 'text-ok' : 'text-bad')}>{fmtNum(rc.possible)} vestidos</p>
          <p className="mt-2 text-sm leading-relaxed text-cocoa">
            Hay {fmtH(rc.freeHours)} libres en total, pero <span className="font-semibold">{areaName(rc.limiting)}</span> limita cuántos vestidos más puede absorber el taller (potencial {fmtMoney(rc.potentialRevenue)}).
          </p>
        </div>
      </div>

      <p className={cn('mt-6 rounded-xl px-4 py-3 text-sm', enough ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
        {enough ?
        `La meta es alcanzable con la capacidad actual. Prioriza contratos que usen poco ${areaName(rc.limiting).toLowerCase()}.` :
        `Con la capacidad actual no se alcanza la meta solo con vestidos promedio. Conviene priorizar contratos de mayor valor o liberar horas de ${areaName(rc.limiting).toLowerCase()}.`}
      </p>
    </section>);

}