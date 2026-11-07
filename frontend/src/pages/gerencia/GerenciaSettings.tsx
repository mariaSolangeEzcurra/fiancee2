import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '../../components/ui/PageHeader';
import { fmtSoles } from '../../services/comercialApi';
import { gerenciaApi, mesActualISO, moverMes } from '../../services/gerenciaApi';
import type { BusinessConfig, Category } from '../../services/gerenciaApi';
import { cn, inputClass } from '../../utils/format';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const etiqueta = (m: string) => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

function msg(e: unknown) {
  return e instanceof Error ? e.message : 'No se pudo guardar.';
}

/** Configuración de gerencia: meta, margen y categorías de gasto. */
export function GerenciaSettings() {
  const [cfg, setCfg] = useState<BusinessConfig | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [meta, setMeta] = useState('');
  const [margen, setMargen] = useState('');
  const [nombre, setNombre] = useState('');
  const [saving, setSaving] = useState(false);
  const [mesMeta, setMesMeta] = useState(moverMes(mesActualISO(), 1));
  const [montoMes, setMontoMes] = useState('');
  const [nuevaCat, setNuevaCat] = useState('');

  const aplicar = (c: BusinessConfig) => {
    setCfg(c);
    setMeta(String(c.monthlyGoal || ''));
    setMargen(String(c.targetMargin));
    setNombre(c.businessName);
  };

  useEffect(() => {
    gerenciaApi.config().then(aplicar).catch((e) => toast.error(msg(e)));
    gerenciaApi.categories().then(setCats).catch(() => undefined);
  }, []);

  const guardar = async () => {
    setSaving(true);
    try {
      aplicar(await gerenciaApi.updateConfig({ monthlyGoal: Number(meta || 0).toFixed(2), targetMargin: Number(margen || 0).toFixed(2), businessName: nombre }));
      toast.success('Configuración guardada.');
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSaving(false);
    }
  };

  const guardarMes = async () => {
    if (!(Number(montoMes) > 0)) return toast.error('Ingresa la meta de ese mes.');
    try {
      aplicar(await gerenciaApi.setMonthGoal(mesMeta, Number(montoMes).toFixed(2)));
      setMontoMes('');
      toast.success(`Meta de ${etiqueta(mesMeta)} guardada.`);
    } catch (e) {
      toast.error(msg(e));
    }
  };

  const quitarMes = async (m: string) => {
    try {
      aplicar(await gerenciaApi.setMonthGoal(m, null));
    } catch (e) {
      toast.error(msg(e));
    }
  };

  const agregarCat = async () => {
    if (!nuevaCat.trim()) return;
    try {
      const c = await gerenciaApi.addCategory(nuevaCat.trim());
      setCats((x) => [...x.filter((y) => y.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name)));
      setNuevaCat('');
    } catch (e) {
      toast.error(msg(e));
    }
  };

  const toggleCat = async (c: Category) => {
    try {
      const n = await gerenciaApi.updateCategory(c.id, { active: !c.active });
      setCats((x) => x.map((y) => (y.id === n.id ? n : y)));
    } catch (e) {
      toast.error(msg(e));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Configuración" subtitle="Ajusta la meta del negocio, el margen que quieres ganar y las categorías de gastos." />

      <Bloque titulo="Metas del negocio" desc="Se usan en Inicio, Finanzas e Indicadores.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo label="Meta de ingresos al mes (S/)" hint="Cuánto quieres cobrar cada mes.">
            <input type="number" min={0} step={100} className={cn(inputClass, 'tabular')} value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="Ej.: 40000" />
          </Campo>
          <Campo label="Margen que quieres ganar (%)" hint="De cada S/ 100 que entran, cuánto debe quedar.">
            <input type="number" min={0} max={100} step={1} className={cn(inputClass, 'tabular')} value={margen} onChange={(e) => setMargen(e.target.value)} />
          </Campo>
          <Campo label="Nombre del negocio">
            <input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
        </div>
        {Number(meta) > 0 && Number(margen) > 0 && (
          <p className="mt-3 rounded-lg bg-cream/60 px-3 py-2 text-xs text-cocoa-muted">
            Con esa meta y ese margen, cada mes deberían quedar unos <b className="text-cocoa">{fmtSoles((Number(meta) * Number(margen)) / 100)}</b> después de gastos.
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" disabled={saving || !cfg} onClick={() => void guardar()} className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-5 py-2.5 text-sm font-semibold text-ivory disabled:opacity-50">
            <CheckIcon className="h-4 w-4" /> Guardar
          </button>
        </div>
      </Bloque>

      <Bloque titulo="Metas especiales por mes" desc="Para meses con más trabajo (temporada alta) o con menos. Si un mes no tiene meta especial, se usa la general.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="month" className={cn(inputClass, 'sm:w-48')} value={mesMeta} onChange={(e) => setMesMeta(e.target.value)} aria-label="Mes" />
          <input type="number" min={0} step={100} className={cn(inputClass, 'tabular sm:w-48')} value={montoMes} onChange={(e) => setMontoMes(e.target.value)} placeholder="Meta (S/)" aria-label="Meta del mes" />
          <button type="button" onClick={() => void guardarMes()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gold-soft bg-paper px-4 py-2.5 text-sm font-semibold text-cocoa hover:bg-champagne-soft">
            <PlusIcon className="h-4 w-4" /> Guardar meta del mes
          </button>
        </div>
        {cfg && cfg.customGoals.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {cfg.customGoals.map((g) => (
              <li key={g.month} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="capitalize text-cocoa">{g.label}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular font-semibold text-cocoa">{fmtSoles(g.goal)}</span>
                  <button type="button" onClick={() => void quitarMes(g.month)} aria-label="Quitar" className="rounded-lg p-1 text-cocoa-faint hover:bg-rose-50 hover:text-rose-700">
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Bloque>

      <Bloque titulo="Categorías de gastos" desc="Para ordenar los gastos y ver en qué se va el dinero. Las que desactives ya no salen al registrar.">
        <div className="flex gap-2">
          <input className={inputClass} value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} placeholder="Nueva categoría (ej.: Tintorería)" onKeyDown={(e) => e.key === 'Enter' && void agregarCat()} />
          <button type="button" onClick={() => void agregarCat()} className="inline-flex items-center gap-1.5 rounded-xl bg-cocoa px-4 text-sm font-semibold text-ivory">
            <PlusIcon className="h-4 w-4" /> Agregar
          </button>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          {cats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void toggleCat(c)}
                title={c.active ? 'Tocar para desactivar' : 'Tocar para activar'}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  c.active ? 'border-line bg-paper text-cocoa hover:border-rose-200' : 'border-dashed border-line bg-cream/40 text-cocoa-faint line-through'
                )}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </Bloque>
    </div>
  );
}

function Bloque({ titulo, desc, children }: { titulo: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <h2 className="font-display text-xl font-semibold text-cocoa">{titulo}</h2>
      <p className="mb-4 text-sm text-cocoa-muted">{desc}</p>
      {children}
    </section>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-cocoa-faint">{hint}</span>}
    </label>
  );
}
