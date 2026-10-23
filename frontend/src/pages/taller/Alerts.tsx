import React, { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { AlertItem } from '../../components/alerts/AlertItem';
import { PageHeader } from '../../components/ui/PageHeader';
import { SystemAlert } from '../../types';
import { buildAlerts } from '../../utils/alerts';
import { TODAY } from '../../utils/dates';
import { cn } from '../../utils/format';

type Category = 'Todas' | SystemAlert['category'];
const categories: Category[] = ['Todas', 'Capacidad', 'Producción', 'Personal', 'Materiales'];

export function Alerts() {
  const { dresses, workers } = useApp();
  const [cat, setCat] = useState<Category>('Todas');
  const alerts = useMemo(() => buildAlerts(dresses, workers, TODAY), [dresses, workers]);
  const visible = alerts.filter((a) => cat === 'Todas' || a.category === cat);
  const critical = visible.filter((a) => a.severity === 'bad');
  const risks = visible.filter((a) => a.severity === 'risk');

  return (
    <div>
      <PageHeader title="Centro de alertas" subtitle="Cada alerta explica qué pasa, por qué pasa y qué impacto tiene. Se generan automáticamente a partir de la capacidad, la producción y los registros de horas." />
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Categoría de alerta">
        {categories.map((c) => {
          const count = c === 'Todas' ? alerts.length : alerts.filter((a) => a.category === c).length;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cat === c}
              onClick={() => setCat(c)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-150',
                cat === c ? 'border-cocoa bg-cocoa text-ivory' : 'border-line text-cocoa-muted hover:border-nude hover:text-cocoa'
              )}>
              
              {c} <span className="tabular opacity-70">{count}</span>
            </button>);

        })}
      </div>

      {visible.length === 0 && <p className="py-10 text-sm text-cocoa-muted">No hay alertas en esta categoría.</p>}
      {critical.length > 0 &&
      <section className="mb-8">
          <h2 className="text-xs font-semibold text-bad">Críticas · {critical.length}</h2>
          <div className="mt-1 divide-y divide-line border-y border-line">
            {critical.map((a) =>
          <AlertItem key={a.id} alert={a} />
          )}
          </div>
        </section>
      }
      {risks.length > 0 &&
      <section>
          <h2 className="text-xs font-semibold text-risk">En observación · {risks.length}</h2>
          <div className="mt-1 divide-y divide-line border-y border-line">
            {risks.map((a) =>
          <AlertItem key={a.id} alert={a} />
          )}
          </div>
        </section>
      }
    </div>);

}