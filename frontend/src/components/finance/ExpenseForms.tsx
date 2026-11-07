import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { PlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import { fmtSoles } from '../../services/comercialApi';
import { FRECUENCIAS, gerenciaApi, hoyISO, METODOS_PAGO } from '../../services/gerenciaApi';
import type { Category, Expense, FixedCost, Frecuencia, MetodoPago } from '../../services/gerenciaApi';
import { cn, inputClass } from '../../utils/format';
import { Modal } from '../ui/Modal';

function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-cocoa-faint">{hint}</span>}
    </label>
  );
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'No se pudo guardar.';
}

/** Selector de categoría con opción de crear una nueva al vuelo. */
function CategorySelect({
  categories,
  value,
  onChange,
  onCreated,
}: {
  categories: Category[];
  value: number | '';
  onChange: (id: number) => void;
  onCreated: (c: Category) => void;
}) {
  const [nueva, setNueva] = useState<string | null>(null);
  const crear = async () => {
    if (!nueva?.trim()) return;
    try {
      const c = await gerenciaApi.addCategory(nueva.trim());
      onCreated(c);
      onChange(c.id);
      setNueva(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  if (nueva !== null) {
    return (
      <div className="flex gap-2">
        <input autoFocus className={inputClass} placeholder="Nombre de la categoría" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        <button type="button" onClick={() => void crear()} className="rounded-xl bg-cocoa px-3 text-sm font-medium text-ivory">
          Crear
        </button>
        <button type="button" onClick={() => setNueva(null)} className="rounded-xl border border-line px-3 text-sm text-cocoa">
          ✕
        </button>
      </div>
    );
  }
  return (
    <select
      className={inputClass}
      value={value}
      onChange={(e) => (e.target.value === 'nueva' ? setNueva('') : onChange(Number(e.target.value)))}
    >
      <option value="">Elegir…</option>
      {categories.filter((c) => c.active || c.id === value).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="nueva">+ Nueva categoría…</option>
    </select>
  );
}

// ─── Gasto ─────────────────────────────────────────────

export function ExpenseModal({
  open,
  expense,
  categories,
  onCategoriesChange,
  onClose,
  onSaved,
}: {
  open: boolean;
  expense: Expense | null;
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [date, setDate] = useState(hoyISO());
  const [pagado, setPagado] = useState(true);
  const [due, setDue] = useState('');
  const [method, setMethod] = useState<MetodoPago>('EFECTIVO');
  const [supplier, setSupplier] = useState('');
  const [receipt, setReceipt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConcept(expense?.concept ?? '');
    setAmount(expense ? String(expense.amount) : '');
    setCategoryId(expense?.categoryId ?? '');
    setDate(expense?.date ?? hoyISO());
    setPagado(expense ? expense.status === 'PAGADO' : true);
    setDue(expense?.due ?? '');
    setMethod(expense?.method ?? 'EFECTIVO');
    setSupplier(expense?.supplier ?? '');
    setReceipt(expense?.receipt ?? '');
    setNotes(expense?.notes ?? '');
  }, [open, expense]);

  const guardar = async () => {
    if (!concept.trim()) return toast.error('Escribe en qué se gastó.');
    if (!(Number(amount) > 0)) return toast.error('Ingresa el monto.');
    if (!categoryId) return toast.error('Elige una categoría.');
    setSaving(true);
    const data = {
      concept: concept.trim(),
      amount: Number(amount).toFixed(2),
      categoryId: Number(categoryId),
      date,
      status: pagado ? ('PAGADO' as const) : ('PENDIENTE' as const),
      due: pagado ? null : due || null,
      method,
      supplier,
      receipt,
      notes,
    };
    try {
      if (expense) await gerenciaApi.updateExpense(expense.id, data);
      else await gerenciaApi.addExpense(data);
      toast.success(expense ? 'Gasto actualizado.' : 'Gasto registrado.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={expense ? 'Editar gasto' : 'Nuevo gasto'} subtitle="Se suma a los gastos del mes según su fecha.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-cream/60 p-1">
          {[
            [true, 'Ya lo pagué'],
            [false, 'Está por pagar'],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setPagado(v as boolean)}
              className={cn('rounded-lg py-2 text-sm font-medium', pagado === v ? 'bg-paper text-cocoa shadow-sm ring-1 ring-line' : 'text-cocoa-muted')}
            >
              {l as string}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="¿En qué se gastó?" className="sm:col-span-2">
            <input className={inputClass} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej.: 10 m de tul francés" />
          </Field>
          <Field label="Monto (S/)">
            <input type="number" min={0} step="0.01" inputMode="decimal" className={cn(inputClass, 'tabular')} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Categoría">
            <CategorySelect
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              onCreated={(c) => onCategoriesChange([...categories, c])}
            />
          </Field>
          <Field label={pagado ? 'Fecha del pago' : 'Fecha del gasto'}>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {pagado ? (
            <Field label="¿Cómo se pagó?">
              <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as MetodoPago)}>
                {METODOS_PAGO.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="¿Hasta cuándo hay que pagarlo?">
              <input type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          )}
          <Field label="Proveedor (opcional)">
            <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ej.: Textiles Gamarra" />
          </Field>
          <Field label="N.º de boleta o factura (opcional)">
            <input className={inputClass} value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="B001-123" />
          </Field>
          <Field label="Observación (opcional)" className="sm:col-span-2">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-cocoa">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void guardar()}
            className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-5 py-2.5 text-sm font-semibold text-ivory disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" /> {expense ? 'Guardar cambios' : 'Registrar gasto'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Gasto fijo ────────────────────────────────────────

export function FixedModal({
  open,
  fixed,
  categories,
  onCategoriesChange,
  onClose,
  onSaved,
}: {
  open: boolean;
  fixed: FixedCost | null;
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [frequency, setFrequency] = useState<Frecuencia>('MENSUAL');
  const [payDay, setPayDay] = useState('');
  const [from, setFrom] = useState(hoyISO());
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(fixed?.name ?? '');
    setAmount(fixed ? String(fixed.amount) : '');
    setCategoryId(fixed?.categoryId ?? '');
    setFrequency(fixed?.frequency ?? 'MENSUAL');
    setPayDay(fixed?.payDay ? String(fixed.payDay) : '');
    setFrom(fixed?.from ?? `${hoyISO().slice(0, 7)}-01`);
    setTo(fixed?.to ?? '');
    setNotes(fixed?.notes ?? '');
  }, [open, fixed]);

  const guardar = async () => {
    if (!name.trim()) return toast.error('Escribe el nombre del gasto fijo.');
    if (!(Number(amount) > 0)) return toast.error('Ingresa el monto.');
    if (!categoryId) return toast.error('Elige una categoría.');
    setSaving(true);
    const data = {
      name: name.trim(),
      amount: Number(amount).toFixed(2),
      categoryId: Number(categoryId),
      frequency,
      payDay: payDay ? Number(payDay) : null,
      from,
      to: to || null,
      notes,
    };
    try {
      if (fixed) await gerenciaApi.updateFixed(fixed.id, data);
      else await gerenciaApi.addFixed(data);
      toast.success(fixed ? 'Gasto fijo actualizado.' : 'Gasto fijo agregado.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={fixed ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      subtitle="Lo que se paga siempre: alquiler, planilla, luz, internet… Se cuenta solo cada mes."
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre" className="sm:col-span-2">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Alquiler del local" />
          </Field>
          <Field label="Monto (S/)">
            <input type="number" min={0} step="0.01" inputMode="decimal" className={cn(inputClass, 'tabular')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="¿Cada cuánto?">
            <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as Frecuencia)}>
              {FRECUENCIAS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoría">
            <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} onCreated={(c) => onCategoriesChange([...categories, c])} />
          </Field>
          <Field label="Día de pago (opcional)" hint="Para avisarte cuándo vence.">
            <input type="number" min={1} max={31} className={cn(inputClass, 'tabular')} value={payDay} onChange={(e) => setPayDay(e.target.value)} placeholder="Ej.: 30" />
          </Field>
          <Field label="Desde">
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta (opcional)">
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Observación (opcional)" className="sm:col-span-2">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {frequency !== 'MENSUAL' && Number(amount) > 0 && (
          <p className="rounded-lg bg-cream/60 px-3 py-2 text-xs text-cocoa-muted">
            {frequency === 'SEMANAL' && `Al mes son unos ${fmtSoles((Number(amount) * 52) / 12)}.`}
            {frequency === 'ANUAL' && `Se reparte en ${fmtSoles(Number(amount) / 12)} por mes.`}
            {frequency === 'UNICO' && 'Solo se cuenta en el mes de la fecha "Desde".'}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-cocoa">
            Cancelar
          </button>
          <button type="button" disabled={saving} onClick={() => void guardar()} className="rounded-xl bg-cocoa px-5 py-2.5 text-sm font-semibold text-ivory disabled:opacity-50">
            {fixed ? 'Guardar cambios' : 'Agregar gasto fijo'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Pagar gasto fijo ──────────────────────────────────

export function PayFixedModal({
  fixed,
  month,
  monthLabel,
  onClose,
  onSaved,
}: {
  fixed: { id: number; name: string; monthly: number } | null;
  month: string;
  monthLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(hoyISO());
  const [method, setMethod] = useState<MetodoPago>('TRANSFERENCIA');
  const [receipt, setReceipt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fixed) {
      setAmount(String(fixed.monthly));
      setDate(hoyISO());
      setReceipt('');
    }
  }, [fixed]);

  const pagar = async () => {
    if (!fixed) return;
    setSaving(true);
    try {
      await gerenciaApi.payFixed(fixed.id, { month, amount: Number(amount).toFixed(2), date, method, receipt });
      toast.success(`${fixed.name}: pago de ${monthLabel} registrado.`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!fixed} onClose={onClose} title={`Pagar ${fixed?.name ?? ''}`} subtitle={`Corresponde a ${monthLabel}.`}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monto pagado (S/)" hint="Puedes cambiarlo si este mes fue distinto (ej.: la luz).">
            <input type="number" min={0} step="0.01" className={cn(inputClass, 'tabular')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Fecha del pago">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="¿Cómo se pagó?">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as MetodoPago)}>
              {METODOS_PAGO.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="N.º de operación o recibo (opcional)">
            <input className={inputClass} value={receipt} onChange={(e) => setReceipt(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-cocoa">
            Cancelar
          </button>
          <button type="button" disabled={saving || !(Number(amount) > 0)} onClick={() => void pagar()} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            Registrar pago
          </button>
        </div>
      </div>
    </Modal>
  );
}
