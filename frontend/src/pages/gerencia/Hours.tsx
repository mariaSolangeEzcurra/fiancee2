import React from 'react';
import { useApp, workerWeekHours } from '../../contexts/AppContext';
import { Meter } from '../../components/ui/Meter';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { fmtShort } from '../../utils/dates';
import { fmtH, fmtPct } from '../../utils/format';
import { processName } from '../../utils/processes';

export function Hours() {
  const { workers, logs } = useApp();
  const rows = workers.map((w) => {
    const available = Object.values(w.areas).reduce<number>((s, h) => s + (h ?? 0), 0);
    return { w, available, logged: workerWeekHours(w, logs) };
  });
  const logged = rows.reduce((s, r) => s + r.logged, 0);
  const available = rows.reduce((s, r) => s + r.available, 0);
  const paid = workers.reduce((s, w) => s + w.paidHours, 0);
  const recent = [...logs].sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
  const nameOf = (id: string) => workers.find((w) => w.id === id)?.name ?? id;

  return (
    <div className="space-y-8">
      <PageHeader title="Horas" subtitle="Horas reales registradas por el personal frente a las horas disponibles y pagadas." />
      <div className="grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-4">
        <Stat label="Horas registradas" value={fmtH(logged)} sub="esta semana" />
        <Stat label="Horas disponibles" value={fmtH(available)} />
        <Stat label="Horas pagadas" value={fmtH(paid)} />
        <Stat label="Registrado / pagado" value={fmtPct(logged / paid)} sub="horas no productivas incluidas" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section>
          <h2 className="font-display text-2xl font-semibold text-cocoa">Por trabajadora</h2>
          <ul className="mt-4 space-y-4">
            {rows.map(({ w, available: a, logged: l }) =>
            <li key={w.id}>
                <div className="flex justify-between text-sm">
                  <span className="text-cocoa">{w.name}</span>
                  <span className="tabular text-cocoa-muted">
                    {fmtH(l)} / {fmtH(a)}
                  </span>
                </div>
                <Meter className="mt-1.5" value={a > 0 ? l / a : 0} tone={a > 0 && l / a < 0.6 ? 'risk' : 'ok'} label={`Horas de ${w.name}`} />
              </li>
            )}
          </ul>
        </section>
        <section>
          <h2 className="font-display text-2xl font-semibold text-cocoa">Registros recientes</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-cocoa-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Fecha</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Trabajadora</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Vestido · proceso</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Horas</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((l) =>
                <tr key={l.id} className="border-b border-line/70 last:border-0">
                    <td className="tabular px-4 py-2.5 text-cocoa-muted">
                      {fmtShort(l.date)} · {l.start}
                    </td>
                    <td className="px-3 py-2.5 text-cocoa">{nameOf(l.workerId)}</td>
                    <td className="px-3 py-2.5 text-cocoa">
                      <span className="tabular font-medium">{l.dressId}</span> · {processName(l.process)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-medium text-cocoa">{fmtH(l.hours)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>);

}