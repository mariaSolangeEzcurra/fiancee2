import React, { useMemo, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { DressDrawer } from '../../components/dress/DressDrawer';
import { DressTable } from '../../components/dress/DressTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { Stat } from '../../components/ui/Stat';
import { TODAY } from '../../utils/dates';
import { dressRisk, dressTotals } from '../../utils/dresses';
import { cn, fmtH, inputClass } from '../../utils/format';

type WorkshopFilter = 'todos' | 'Taller A' | 'Taller C';
type StatusFilter = 'activos' | 'En cola' | 'En producción' | 'riesgo' | 'Terminado';

export function Dresses({ readOnly = false }: {readOnly?: boolean;}) {
  const { dresses } = useApp();
  const [q, setQ] = useState('');
  const [workshop, setWorkshop] = useState<WorkshopFilter>('todos');
  const [status, setStatus] = useState<StatusFilter>('activos');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useMemo(
    () =>
    dresses.
    filter((d) => `${d.code} ${d.client}`.toLowerCase().includes(q.toLowerCase())).
    filter((d) => workshop === 'todos' || d.workshop === workshop).
    filter((d) => {
      if (status === 'activos') return d.status !== 'Terminado';
      if (status === 'riesgo') return d.status !== 'Terminado' && dressRisk(d, TODAY).tone !== 'ok';
      return d.status === status;
    }).
    sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [dresses, q, workshop, status]
  );

  const active = dresses.filter((d) => d.status !== 'Terminado');
  const late = active.filter((d) => dressRisk(d, TODAY).tone === 'bad').length;

  return (
    <div>
      <PageHeader
        title={readOnly ? 'Producción' : 'Vestidos'}
        subtitle={readOnly ? 'Estado de cada vestido en producción. Solo lectura.' : 'Todos los vestidos del taller. Abre uno para cambiar su proceso, asignar personal o registrar incidencias.'} />
      
      <div className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-5 md:grid-cols-5">
        <Stat label="En producción" value={active.filter((d) => d.status === 'En producción').length} />
        <Stat label="En cola" value={active.filter((d) => d.status === 'En cola').length} />
        <Stat label="Terminados" value={dresses.filter((d) => d.status === 'Terminado').length} />
        <Stat label="Atrasados o en riesgo alto" value={late} tone={late ? 'bad' : 'ok'} />
        <Stat label="Horas pendientes" value={fmtH(active.reduce((s, d) => s + dressTotals(d).remaining, 0))} />
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cocoa-faint" aria-hidden="true" />
          <input aria-label="Buscar vestido" className={cn(inputClass, 'pl-9')} placeholder="Buscar código o clienta" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="lg:w-72">
          <Segmented<WorkshopFilter>
            ariaLabel="Filtrar por taller"
            value={workshop}
            onChange={setWorkshop}
            options={[
            { value: 'todos', label: 'Todos' },
            { value: 'Taller A', label: 'Taller A' },
            { value: 'Taller C', label: 'Taller C' }]
            } />
          
        </div>
        <div className="lg:w-[30rem]">
          <Segmented<StatusFilter>
            ariaLabel="Filtrar por estado"
            value={status}
            onChange={setStatus}
            options={[
            { value: 'activos', label: 'Activos' },
            { value: 'En producción', label: 'Producción' },
            { value: 'En cola', label: 'En cola' },
            { value: 'riesgo', label: 'Con riesgo' },
            { value: 'Terminado', label: 'Terminados' }]
            } />
          
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-paper">
        <DressTable dresses={list} onOpen={setOpenId} />
      </div>
      <DressDrawer dressId={openId} onClose={() => setOpenId(null)} readOnly={readOnly} />
    </div>);

}