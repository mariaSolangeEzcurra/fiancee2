import React from 'react';
import { useApp } from '../../contexts/AppContext';
import { ProductionLine } from '../../components/dress/ProductionLine';
import { fmtShort } from '../../utils/dates';
import { currentStep } from '../../utils/dresses';
import { processName } from '../../utils/processes';

export function MyDresses() {
  const { dresses, currentWorkerId, logs } = useApp();
  const workedIds = new Set(logs.filter((l) => l.workerId === currentWorkerId).map((l) => l.dressId));
  const mine = dresses.filter((d) => d.status !== 'Terminado' && (d.steps.some((s) => s.workerIds.includes(currentWorkerId)) || workedIds.has(d.id)));

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="font-display text-5xl font-semibold text-cocoa">Mis vestidos</h1>
        <p className="mt-1 text-sm text-cocoa-muted">Vestidos en los que estás asignada o has trabajado esta semana.</p>
      </header>
      <ul className="space-y-4">
        {mine.map((d) => {
          const step = currentStep(d);
          const myProcesses = d.steps.filter((s) => s.workerIds.includes(currentWorkerId)).map((s) => processName(s.process));
          return (
            <li key={d.id} className="rounded-2xl border border-line bg-paper p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-lg text-cocoa">
                  <span className="tabular font-semibold">{d.code}</span> · {d.client}
                </p>
                <p className="tabular text-sm text-cocoa-muted">Entrega {fmtShort(d.deadline)}</p>
              </div>
              <p className="mt-1 text-sm text-cocoa-muted">
                Ahora en <span className="font-medium text-cocoa">{step ? processName(step.process) : '—'}</span>
                {myProcesses.length > 0 && <> · Tu parte: {myProcesses.join(', ')}</>}
              </p>
              <div className="mt-4">
                <ProductionLine dress={d} />
              </div>
            </li>);

        })}
      </ul>
    </div>);

}