import React, { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { collections, complexityFactors, levelFactors, skirtVolumes } from '../../data/processes';
import { FixedCostsForm } from '../../components/finance/FixedCostsForm';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { ProcessId } from '../../types';
import { templateTotal } from '../../utils/estimate';
import { fmtNum } from '../../utils/format';
import { PROCESS_ORDER, processName } from '../../utils/processes';

type Tab = 'tiempos' | 'finanzas';
const columns: ProcessId[] = PROCESS_ORDER.filter((p) => p !== 'entrega');

export function Settings() {
  const { templates, updateTemplateHours } = useApp();
  const [tab, setTab] = useState<Tab>('tiempos');

  return (
    <div className="space-y-6">
      <PageHeader title="Configuración" subtitle="Los tiempos por proceso alimentan el simulador y la capacidad. Cualquier cambio se aplica al instante." />
      <div className="max-w-sm">
        <Segmented<Tab>
          ariaLabel="Sección de configuración"
          value={tab}
          onChange={setTab}
          options={[
          { value: 'tiempos', label: 'Tiempos por proceso' },
          { value: 'finanzas', label: 'Gastos fijos y metas' }]
          } />
        
      </div>

      {tab === 'tiempos' ?
      <>
          <section className="rounded-2xl border border-line bg-paper">
            <div className="border-b border-line px-6 py-4">
              <h2 className="font-display text-2xl font-semibold text-cocoa">Horas base por corte · complejidad media</h2>
              <p className="mt-1 text-xs text-cocoa-muted">
                Los vestidos minimalistas no tienen necesariamente menos horas: requieren mayor precisión en costuras y acabados. La fila de Taller C solo contiene las horas pendientes en Taller A.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-cocoa-muted">
                    <th scope="col" className="sticky left-0 bg-paper px-5 py-3 font-medium">Corte · taller</th>
                    {columns.map((p) =>
                  <th key={p} scope="col" className="px-1 py-3 text-center font-medium">
                        {processName(p)}
                      </th>
                  )}
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) =>
                <tr key={t.id} className="border-b border-line/70 last:border-0">
                      <th scope="row" className="sticky left-0 bg-paper px-5 py-2 text-left">
                        <span className="block font-medium text-cocoa">{t.name}</span>
                        <span className="block text-[11px] font-normal text-cocoa-muted">{t.workshop}</span>
                      </th>
                      {columns.map((p) =>
                  <td key={p} className="px-1 py-2">
                          <input
                      type="number"
                      min={0}
                      step={0.5}
                      aria-label={`${t.name} · ${processName(p)}`}
                      value={t.hours[p] ?? ''}
                      placeholder="—"
                      onChange={(e) => updateTemplateHours(t.id, p, Number(e.target.value) || 0)}
                      className="tabular w-14 rounded-md border border-transparent bg-cream/60 px-1.5 py-1.5 text-center text-sm text-cocoa placeholder:text-cocoa-faint focus:border-gold-soft focus:bg-paper focus:outline-none" />
                    
                        </td>
                  )}
                      <td className="tabular px-4 py-2 text-right font-semibold text-cocoa">{fmtNum(templateTotal(t))} h</td>
                    </tr>
                )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <FactorList title="Complejidad" rows={complexityFactors.map((c) => [c.id, `× ${fmtNum(c.factor)}`])} />
            <FactorList title="Colección" rows={collections.map((c) => [c.id, c.description])} />
            <FactorList title="Bordado y encaje" rows={levelFactors.map((l) => [l.id, `× ${fmtNum(l.factor)}`])} />
            <FactorList
            title="Volumen de falda"
            rows={skirtVolumes.map((v) => [v.id, v.confeccion === 1 ? 'Base' : `Confección × ${fmtNum(v.confeccion)} · +${v.acabados} h acabados`])} />
          
          </section>
        </> :

      <section className="max-w-3xl rounded-2xl border border-line bg-paper p-6">
          <h2 className="mb-5 font-display text-2xl font-semibold text-cocoa">Gastos fijos mensuales y metas</h2>
          <FixedCostsForm />
        </section>
      }
    </div>);

}

function FactorList({ title, rows }: {title: string;rows: [string, string][];}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-cocoa">{title}</h3>
      <dl className="mt-2 divide-y divide-line text-sm">
        {rows.map(([k, v]) =>
        <div key={k} className="flex justify-between gap-3 py-2">
            <dt className="text-cocoa">{k}</dt>
            <dd className="tabular text-right text-cocoa-muted">{v}</dd>
          </div>
        )}
      </dl>
    </div>);

}