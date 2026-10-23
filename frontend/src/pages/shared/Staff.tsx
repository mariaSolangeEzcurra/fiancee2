import React from 'react';
import { useApp, workerWeekHours } from '../../contexts/AppContext';
import { Meter } from '../../components/ui/Meter';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { StatusPill } from '../../components/ui/StatusPill';
import { fmtShort, parseDate, TODAY, workingDaysBetween } from '../../utils/dates';
import { fmtH, fmtPct } from '../../utils/format';

export function Staff() {
  const { workers, logs, dresses } = useApp();
  const rows = workers.map((w) => {
    const available = Object.values(w.areas).reduce<number>((s, h) => s + (h ?? 0), 0);
    const logged = workerWeekHours(w, logs);
    const assigned = dresses.filter((d) => d.status !== 'Terminado' && d.steps.some((s, i) => !s.done && i <= d.currentIndex + 1 && s.workerIds.includes(w.id))).length;
    const gap = workingDaysBetween(parseDate(w.lastLog), TODAY);
    return { w, available, logged, assigned, gap, util: available > 0 ? logged / available : 0 };
  });
  const totalAvail = rows.reduce((s, r) => s + r.available, 0);
  const totalLogged = rows.reduce((s, r) => s + r.logged, 0);
  const totalPaid = workers.reduce((s, w) => s + w.paidHours, 0);

  return (
    <div>
      <PageHeader title="Personal" subtitle="Horas disponibles para producción, horas registradas y carga de cada trabajadora esta semana." />
      <div className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Trabajadoras activas" value={workers.length} />
        <Stat label="Horas disponibles" value={fmtH(totalAvail)} sub="productivas por semana" />
        <Stat label="Horas trabajadas" value={fmtH(totalLogged)} sub="registradas esta semana" />
        <Stat label="Horas pagadas" value={fmtH(totalPaid)} sub="jornada de 48 h" />
        <Stat label="Utilización" value={fmtPct(totalLogged / totalAvail)} tone={totalLogged / totalAvail >= 0.85 ? 'ok' : 'risk'} />
        <Stat label="Horas por trabajadora" value={fmtH(totalLogged / workers.length)} sub="promedio" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-cocoa-muted">
              <th scope="col" className="px-5 py-3 font-medium">Trabajadora</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Pagadas</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Disponibles</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Registradas</th>
              <th scope="col" className="w-44 px-3 py-3 font-medium">Utilización</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Vestidos</th>
              <th scope="col" className="px-5 py-3 font-medium">Último registro</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, available, logged, assigned, gap, util }) =>
            <tr key={w.id} className="border-b border-line/70 last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blush-soft text-[11px] font-semibold text-blush-deep">{w.initials}</span>
                    <span>
                      <span className="block font-medium text-cocoa">{w.name}</span>
                      <span className="block text-[11px] text-cocoa-muted">{w.role}</span>
                    </span>
                  </div>
                </td>
                <td className="tabular px-3 py-3 text-right text-cocoa-muted">{fmtH(w.paidHours)}</td>
                <td className="tabular px-3 py-3 text-right text-cocoa">{fmtH(available)}</td>
                <td className="tabular px-3 py-3 text-right font-medium text-cocoa">{fmtH(logged)}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Meter value={util} tone={util < 0.6 ? 'risk' : 'ok'} label={`Utilización de ${w.name}`} />
                    <span className="tabular w-10 text-right text-xs text-cocoa-muted">{fmtPct(util)}</span>
                  </div>
                </td>
                <td className="tabular px-3 py-3 text-right text-cocoa">{assigned}</td>
                <td className="px-5 py-3">{gap >= 2 ? <StatusPill tone="risk">{fmtShort(w.lastLog)} · sin registro</StatusPill> : <span className="tabular text-cocoa-muted">{fmtShort(w.lastLog)}</span>}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>);

}