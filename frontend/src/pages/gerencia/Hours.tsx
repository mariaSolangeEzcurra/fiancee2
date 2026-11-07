import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, DownloadIcon, RefreshCwIcon } from 'lucide-react';

import { WorkerModal } from '../../components/staff/WorkerModal';
import { PageHeader } from '../../components/ui/PageHeader';
import { gerenciaApi, hoyISO, pct } from '../../services/gerenciaApi';
import type { HoursReport, HoursRow } from '../../services/gerenciaApi';
import { horas } from '../../services/staffApi';
import { cn, inputClass } from '../../utils/format';

type Rango = 'semana' | 'mes' | 'mes_pasado' | 'otro';

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rango(r: Rango): [string, string] {
  const hoy = new Date();
  if (r === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    return [iso(lunes), iso(hoy)];
  }
  if (r === 'mes_pasado') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return [iso(ini), iso(fin)];
  }
  return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)];
}

function tonoCumplimiento(v: number | null) {
  if (v === null) return 'bg-slate-300';
  if (v >= 0.9) return 'bg-emerald-500';
  if (v >= 0.7) return 'bg-amber-500';
  return 'bg-rose-500';
}

/** Horas del personal: lo que les tocaba, lo que trabajaron y en qué. */
export function Hours() {
  const [r, setR] = useState<Rango>('mes');
  const [desde, setDesde] = useState(rango('mes')[0]);
  const [hasta, setHasta] = useState(rango('mes')[1]);
  const [data, setData] = useState<HoursReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orden, setOrden] = useState<'nombre' | 'cumplimiento' | 'faltas'>('cumplimiento');
  const [openId, setOpenId] = useState<string | null>(null);

  const elegir = (x: Rango) => {
    setR(x);
    if (x !== 'otro') {
      const [a, b] = rango(x);
      setDesde(a);
      setHasta(b);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await gerenciaApi.hours(desde, hasta));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    void load();
  }, [load]);

  const filas = useMemo(() => {
    const rows = [...(data?.rows ?? [])];
    if (orden === 'nombre') rows.sort((a, b) => a.name.localeCompare(b.name));
    if (orden === 'cumplimiento') rows.sort((a, b) => (a.compliance ?? 9) - (b.compliance ?? 9));
    if (orden === 'faltas') rows.sort((a, b) => b.missed - a.missed);
    return rows;
  }, [data, orden]);

  const exportar = () => {
    if (!data) return;
    const head = ['Trabajadora', 'Área', 'Días trabajados', 'Horas que le tocaban', 'Horas trabajadas', 'Horas extra', 'Horas en vestidos', 'Faltas', 'Permisos', 'No marcó salida', 'Cumplimiento'];
    const lines = data.rows.map((x) => [x.name, x.area, x.daysWorked, x.scheduled, x.worked, x.extra, x.inDresses, x.missed, x.absences, x.autoClosed, pct(x.compliance)]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `horas-${desde}-al-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const t = data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader title="Horas del personal" subtitle="Cuántas horas le tocaban a cada una según su horario, cuántas trabajó y cuántas fueron en vestidos." />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          {(
            [
              ['semana', 'Esta semana'],
              ['mes', 'Este mes'],
              ['mes_pasado', 'Mes pasado'],
              ['otro', 'Otras fechas'],
            ] as [Rango, string][]
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => elegir(v)}
              className={cn('whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium', r === v ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted')}
            >
              {l}
            </button>
          ))}
        </div>
        {r === 'otro' && (
          <div className="flex items-center gap-2">
            <input type="date" className={cn(inputClass, 'w-40')} value={desde} max={hoyISO()} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
            <span className="text-xs text-cocoa-muted">al</span>
            <input type="date" className={cn(inputClass, 'w-40')} value={hasta} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
          </div>
        )}
        <div className="flex gap-2 lg:ml-auto">
          <button type="button" onClick={exportar} disabled={!data?.rows.length} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-xs font-semibold text-cocoa hover:bg-cream disabled:opacity-40">
            <DownloadIcon className="h-4 w-4" /> Descargar Excel (CSV)
          </button>
          <button type="button" onClick={() => void load()} aria-label="Actualizar" className="rounded-xl border border-line bg-paper p-2 text-cocoa hover:bg-cream">
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {t && (
        <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-5', loading && 'opacity-60')}>
          <Card label="Les tocaban" value={horas(t.scheduled)} foot="según su horario" />
          <Card label="Trabajaron" value={horas(t.worked)} foot={`Cumplimiento ${pct(t.compliance)}`} tone={t.compliance !== null && t.compliance < 0.7 ? 'bad' : undefined} />
          <Card label="En vestidos" value={horas(t.inDresses)} foot={`${pct(t.productive)} del tiempo trabajado`} />
          <Card label="Horas extra" value={horas(t.extra)} foot="declaradas al salir" />
          <Card label="Faltas" value={String(t.missed)} foot={`${t.autoClosed} día(s) sin marcar salida`} tone={t.missed ? 'bad' : 'ok'} />
        </div>
      )}

      <section className="rounded-2xl border border-line bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-cocoa">Por persona</h2>
          <label className="flex items-center gap-2 text-xs text-cocoa-muted">
            Ordenar por
            <select className="rounded-lg border border-line bg-paper px-2 py-1 text-xs text-cocoa" value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)}>
              <option value="cumplimiento">Menos cumplimiento</option>
              <option value="faltas">Más faltas</option>
              <option value="nombre">Nombre</option>
            </select>
          </label>
        </div>
        {filas.length === 0 ? (
          <p className="p-8 text-center text-sm text-cocoa-faint">{loading ? 'Cargando…' : 'Sin personal activo.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {filas.map((x) => (
              <Fila key={x.id} x={x} onOpen={() => setOpenId(x.id)} />
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-cocoa-faint">
        "Cumplimiento" = horas trabajadas ÷ horas que le tocaban. "En vestidos" = tiempo registrado trabajando en un vestido (sin pausas). Toca a una persona para ver su historial día por día.
      </p>

      <WorkerModal workerId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Fila({ x, onOpen }: { x: HoursRow; onOpen: () => void }) {
  const c = x.compliance;
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-cream/50 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-cocoa">{x.name}</span>
          <span className="block text-xs text-cocoa-muted">
            {x.area} · {x.daysWorked} día(s)
            {x.missed > 0 && <span className="font-semibold text-rose-700"> · {x.missed} falta(s)</span>}
            {x.absences > 0 && <span> · {x.absences} permiso(s)</span>}
          </span>
        </span>
        <span className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
          <span className="flex justify-between text-[11px] text-cocoa-muted">
            <span className="tabular">
              {horas(x.worked)} de {horas(x.scheduled)}
              {x.extra > 0 && <span className="text-gold"> · +{horas(x.extra)} extra</span>}
            </span>
            <span className="tabular font-semibold text-cocoa">{pct(c)}</span>
          </span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sand/60">
            <span className={cn('block h-full rounded-full', tonoCumplimiento(c))} style={{ width: `${Math.min(100, (c ?? 0) * 100)}%` }} />
          </span>
          <span className="mt-0.5 block text-[11px] text-cocoa-faint">
            En vestidos: {horas(x.inDresses)} ({pct(x.productive)})
            {x.autoClosed > 0 && ` · ${x.autoClosed} día(s) no marcó salida`}
          </span>
        </span>
        <ChevronRightIcon className="h-4 w-4 text-cocoa-faint" aria-hidden="true" />
      </button>
    </li>
  );
}

function Card({ label, value, foot, tone }: { label: string; value: string; foot: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <p className="text-xs font-medium text-cocoa-muted">{label}</p>
      <p className={cn('tabular mt-1 truncate text-2xl font-semibold', tone === 'bad' ? 'text-rose-700' : tone === 'ok' ? 'text-emerald-700' : 'text-cocoa')}>{value}</p>
      <p className="mt-0.5 text-xs text-cocoa-muted">{foot}</p>
    </div>
  );
}
