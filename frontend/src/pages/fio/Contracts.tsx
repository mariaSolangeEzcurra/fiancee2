import React, { useMemo, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { StatusPill } from '../../components/ui/StatusPill';
import { fmtShort, TODAY } from '../../utils/dates';
import { dressRisk, dressTotals } from '../../utils/dresses';
import { cn, fmtMoney, fmtPct, inputClass } from '../../utils/format';

export function Contracts() {
  const { dresses } = useApp();
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
    [...dresses].
    filter((d) => `${d.code} ${d.client} ${d.city}`.toLowerCase().includes(q.toLowerCase())).
    sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
    [dresses, q]
  );
  const total = dresses.reduce((s, d) => s + d.price, 0);
  const paid = dresses.reduce((s, d) => s + d.paid, 0);

  return (
    <div>
      <PageHeader title="Contratos" subtitle="Todos los vestidos contratados, su avance y el estado de cobro." />
      <div className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-4">
        <Stat label="Contratos activos" value={dresses.filter((d) => d.status !== 'Terminado').length} />
        <Stat label="Valor contratado" value={fmtMoney(total)} />
        <Stat label="Cobrado" value={fmtMoney(paid)} />
        <Stat label="Por cobrar" value={fmtMoney(total - paid)} tone="risk" />
      </div>

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cocoa-faint" aria-hidden="true" />
        <input aria-label="Buscar contrato" className={cn(inputClass, 'pl-9')} placeholder="Buscar por código, clienta o ciudad" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-cocoa-muted">
              <th scope="col" className="px-5 py-3 font-medium">Contrato</th>
              <th scope="col" className="px-3 py-3 font-medium">Cliente</th>
              <th scope="col" className="px-3 py-3 font-medium">Evento</th>
              <th scope="col" className="px-3 py-3 font-medium">Entrega</th>
              <th scope="col" className="px-3 py-3 font-medium">Estado</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Avance</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Precio</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Saldo</th>
              <th scope="col" className="px-5 py-3 font-medium">Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => {
              const risk = dressRisk(d, TODAY);
              return (
                <tr key={d.id} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-3">
                    <span className="tabular font-semibold text-cocoa">{d.code}</span>
                    {d.isNew && <span className="ml-2 rounded-full bg-blush-soft px-1.5 py-0.5 text-[10px] font-semibold text-blush-deep">Nuevo</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="block text-cocoa">{d.client}</span>
                    <span className="block text-[11px] text-cocoa-faint">
                      {d.type} · {d.collection}
                    </span>
                  </td>
                  <td className="tabular px-3 py-3 text-cocoa">{fmtShort(d.eventDate)}</td>
                  <td className="tabular px-3 py-3 text-cocoa">{fmtShort(d.deadline)}</td>
                  <td className="px-3 py-3 text-cocoa-muted">{d.status}</td>
                  <td className="tabular px-3 py-3 text-right text-cocoa">{fmtPct(dressTotals(d).progress)}</td>
                  <td className="tabular px-3 py-3 text-right text-cocoa">{fmtMoney(d.price)}</td>
                  <td className={cn('tabular px-3 py-3 text-right', d.price - d.paid > 0 ? 'text-cocoa' : 'text-cocoa-faint')}>{fmtMoney(d.price - d.paid)}</td>
                  <td className="px-5 py-3">
                    <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                  </td>
                </tr>);

            })}
          </tbody>
        </table>
      </div>
    </div>);

}