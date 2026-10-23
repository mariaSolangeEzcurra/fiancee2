import React, { useState } from 'react';
import { toast } from 'sonner';
import { useApp } from '../../contexts/AppContext';
import { FinanceSettings } from '../../types';
import { cn, fmtMoney, inputClass } from '../../utils/format';
import { Field } from '../ui/Field';

export function FixedCostsForm({ onSaved }: {onSaved?: () => void;}) {
  const { finance, updateFinance } = useApp();
  const [draft, setDraft] = useState<FinanceSettings>(finance);
  const total = draft.personal + draft.servicios + draft.alquiler;
  const set = (k: keyof FinanceSettings, v: string) => setDraft((d) => ({ ...d, [k]: Number(v) || 0 }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        updateFinance(draft);
        toast.success('Configuración financiera guardada');
        onSaved?.();
      }}
      className="space-y-5">
      
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Personal operativo del taller (S/)" htmlFor="fc-personal">
          <input id="fc-personal" type="number" className={cn(inputClass, 'tabular')} value={draft.personal} onChange={(e) => set('personal', e.target.value)} />
        </Field>
        <Field label="Servicios y otros (S/)" htmlFor="fc-servicios">
          <input id="fc-servicios" type="number" className={cn(inputClass, 'tabular')} value={draft.servicios} onChange={(e) => set('servicios', e.target.value)} />
        </Field>
        <Field label="Alquiler (S/)" htmlFor="fc-alquiler">
          <input id="fc-alquiler" type="number" className={cn(inputClass, 'tabular')} value={draft.alquiler} onChange={(e) => set('alquiler', e.target.value)} />
        </Field>
      </div>
      <p className="tabular text-sm text-cocoa">
        Total gastos fijos: <span className="font-semibold">{fmtMoney(total)}</span>
      </p>
      <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
        <Field label="Meta mensual (S/)" htmlFor="fc-goal">
          <input id="fc-goal" type="number" className={cn(inputClass, 'tabular')} value={draft.monthlyGoal} onChange={(e) => set('monthlyGoal', e.target.value)} />
        </Field>
        <Field label="Margen objetivo (%)" htmlFor="fc-margin">
          <input id="fc-margin" type="number" className={cn(inputClass, 'tabular')} value={Math.round(draft.targetMargin * 100)} onChange={(e) => setDraft((d) => ({ ...d, targetMargin: (Number(e.target.value) || 0) / 100 }))} />
        </Field>
        <Field label="Materiales (% del ingreso)" htmlFor="fc-materials">
          <input id="fc-materials" type="number" className={cn(inputClass, 'tabular')} value={Math.round(draft.materialsRate * 100)} onChange={(e) => setDraft((d) => ({ ...d, materialsRate: (Number(e.target.value) || 0) / 100 }))} />
        </Field>
      </div>
      <button type="submit" className="rounded-lg bg-cocoa px-5 py-2.5 text-sm font-medium text-ivory transition-colors duration-150 hover:bg-[#3a281f]">
        Guardar cambios
      </button>
    </form>);

}