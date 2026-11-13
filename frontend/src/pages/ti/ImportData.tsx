import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DownloadIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  Loader2Icon,
  RotateCcwIcon,
  UploadCloudIcon,
  XCircleIcon,
} from 'lucide-react';

import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { tiApi } from '../../services/tiApi';
import type { HojaPlantilla, ResultadoImportacion } from '../../services/tiApi';
import { cn } from '../../utils/format';
import { sheetIcon } from './sheetIcons';

type Fase = 'elegir' | 'revisando' | 'revisado' | 'guardando' | 'guardado';

const TIPO_LABEL: Record<string, string> = {
  texto: 'Texto',
  numero: 'Número',
  fecha: 'Fecha dd/mm/aaaa',
  opcion: 'Elegir de lista',
  sino: 'Sí / No',
  lista: 'Varios, separados por coma',
};

/** TI: descarga plantillas, sube el Excel, revisa y guarda. */
export function ImportData() {
  const [hojas, setHojas] = useState<HojaPlantilla[]>([]);
  const [verHoja, setVerHoja] = useState<HojaPlantilla | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [fase, setFase] = useState<Fase>('elegir');
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tiApi
      .esquema()
      .then((r) => setHojas(r.hojas))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar las plantillas.'));
  }, []);

  const descargar = async (claves?: string[]) => {
    const id = claves?.join(',') ?? 'todo';
    setDescargando(id);
    try {
      await tiApi.descargarPlantilla(claves);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo descargar.');
    } finally {
      setDescargando(null);
    }
  };

  const revisar = useCallback(async (f: File) => {
    setArchivo(f);
    setResultado(null);
    setError('');
    setFase('revisando');
    try {
      setResultado(await tiApi.importar(f, false));
      setFase('revisado');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo revisar el archivo.');
      setFase('elegir');
    }
  }, []);

  const guardar = async () => {
    if (!archivo) return;
    setFase('guardando');
    setError('');
    try {
      const r = await tiApi.importar(archivo, true);
      setResultado(r);
      if (r.guardado) {
        setFase('guardado');
        toast.success('Datos guardados en el sistema.');
      } else {
        setFase('revisado');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setFase('revisado');
    }
  };

  const reiniciar = () => {
    setArchivo(null);
    setResultado(null);
    setError('');
    setFase('elegir');
    if (input.current) input.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void revisar(f);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Importar datos"
        subtitle="Carga la información que el negocio ya tiene (clientas, personal, contratos, pagos y gastos) usando las plantillas de Excel."
      />

      {/* PASO 1 */}
      <section className="rounded-2xl border border-line bg-paper p-5 md:p-6">
        <Paso n={1} titulo="Descarga la plantilla" texto="Llena solo las hojas que necesites. Cada columna explica qué poner." />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void descargar()}
            disabled={descargando !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-cocoa/90 disabled:opacity-50"
          >
            {descargando === 'todo' ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
            Plantilla completa
          </button>
          <span className="text-xs text-cocoa-muted">Trae todas las hojas, instrucciones y listas desplegables.</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {hojas.map((h) => {
            const Icon = sheetIcon(h.clave);
            const obl = h.columnas.filter((c) => c.obligatorio).length;
            return (
              <article key={h.clave} className="flex flex-col rounded-xl border border-line bg-ivory/60 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blush-soft text-blush-deep">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-cocoa">{h.titulo}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-cocoa-muted">{h.descripcion}</p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-cocoa-faint">
                  {h.columnas.length} columnas · <span className="font-semibold text-gold">{obl} obligatorias</span>
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVerHoja(h)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-cocoa hover:bg-cream"
                  >
                    <EyeIcon className="h-3.5 w-3.5" /> Ver campos
                  </button>
                  <button
                    type="button"
                    onClick={() => void descargar([h.clave])}
                    disabled={descargando !== null}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-cocoa hover:bg-cream disabled:opacity-50"
                  >
                    {descargando === h.clave ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                    Solo esta
                  </button>
                </div>
              </article>
            );
          })}
          {hojas.length === 0 && !error && (
            <p className="col-span-full py-6 text-center text-sm text-cocoa-faint">Cargando plantillas…</p>
          )}
        </div>
      </section>

      {/* PASO 2 */}
      <section className="rounded-2xl border border-line bg-paper p-5 md:p-6">
        <Paso n={2} titulo="Sube tu Excel" texto="Primero lo revisamos. No se guarda nada hasta que tú confirmes." />

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {fase === 'elegir' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            className={cn(
              'mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              arrastrando ? 'border-gold bg-champagne-soft' : 'border-line bg-ivory/60 hover:border-nude hover:bg-cream/50'
            )}
          >
            <UploadCloudIcon className="h-10 w-10 text-gold" />
            <p className="mt-3 text-sm font-semibold text-cocoa">Arrastra aquí tu archivo o haz clic para elegirlo</p>
            <p className="mt-1 text-xs text-cocoa-muted">Excel .xlsx · máximo 10 MB</p>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void revisar(f);
              }}
            />
          </div>
        )}

        {fase !== 'elegir' && archivo && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ivory/60 px-4 py-3">
            <FileSpreadsheetIcon className="h-5 w-5 shrink-0 text-ok" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-cocoa">{archivo.name}</p>
              <p className="text-xs text-cocoa-muted">{(archivo.size / 1024).toFixed(0)} KB</p>
            </div>
            {fase !== 'guardando' && fase !== 'revisando' && (
              <button type="button" onClick={reiniciar} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-cocoa hover:bg-cream">
                <RotateCcwIcon className="h-3.5 w-3.5" /> {fase === 'guardado' ? 'Subir otro' : 'Cambiar archivo'}
              </button>
            )}
          </div>
        )}

        {(fase === 'revisando' || fase === 'guardando') && (
          <div className="mt-6 flex flex-col items-center gap-2 py-6 text-sm text-cocoa-muted">
            <Loader2Icon className="h-7 w-7 animate-spin text-gold" />
            {fase === 'revisando' ? 'Revisando tu archivo fila por fila…' : 'Guardando en el sistema…'}
            <span className="text-xs text-cocoa-faint">Si tiene muchos contratos puede tardar un poco (se programa el taller).</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {resultado && (fase === 'revisado' || fase === 'guardado') && (
            <motion.div key={fase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 space-y-4">
              <Resultado r={resultado} fase={fase} onGuardar={() => void guardar()} onOtro={reiniciar} />
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <ModalCampos hoja={verHoja} onClose={() => setVerHoja(null)} onDescargar={(c) => void descargar([c])} />
    </div>
  );
}

function Paso({ n, titulo, texto }: { n: number; titulo: string; texto: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cocoa font-display text-base font-semibold text-ivory">{n}</span>
      <div>
        <h2 className="text-base font-semibold text-cocoa">{titulo}</h2>
        <p className="text-sm text-cocoa-muted">{texto}</p>
      </div>
    </div>
  );
}

function Resultado({ r, fase, onGuardar, onOtro }: { r: ResultadoImportacion; fase: Fase; onGuardar: () => void; onOtro: () => void }) {
  const [filtro, setFiltro] = useState('todas');
  const [verAvisos, setVerAvisos] = useState(false);
  const hojasConError = useMemo(() => Array.from(new Set(r.errores.map((e) => e.hoja))), [r.errores]);
  const errores = filtro === 'todas' ? r.errores : r.errores.filter((e) => e.hoja === filtro);
  const nuevos = r.hojas.reduce((s, h) => s + h.nuevos, 0);
  const actualizados = r.hojas.reduce((s, h) => s + h.actualizados, 0);

  const descargarErrores = () => {
    const filas = [['Hoja', 'Fila', 'Columna', 'Qué corregir'], ...r.errores.map((e) => [e.hoja, String(e.fila), e.columna, e.mensaje])];
    const csv = filas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'errores-importacion.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {fase === 'guardado' ? (
        <Banner tono="ok" icon={<CheckCircle2Icon className="h-5 w-5" />} titulo="¡Listo! Los datos ya están en el sistema">
          Se agregaron {nuevos} registro(s){actualizados ? ` y se actualizaron ${actualizados}` : ''}. Comercial, taller y gerencia ya pueden verlos.
        </Banner>
      ) : r.ok ? (
        <Banner tono="ok" icon={<CheckCircle2Icon className="h-5 w-5" />} titulo="Todo está correcto">
          Revisa el resumen y, si está bien, guarda. {nuevos === 0 && actualizados === 0 && 'No hay nada nuevo: todo ya estaba en el sistema.'}
        </Banner>
      ) : (
        <Banner tono="bad" icon={<AlertTriangleIcon className="h-5 w-5" />} titulo={`Encontramos ${r.total_errores} error(es)`}>
          Corrígelos en tu Excel y vuelve a subirlo. <b>No se guardó nada.</b>
        </Banner>
      )}

      {/* Resumen por hoja */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {r.hojas.map((h) => {
          const Icon = sheetIcon(h.clave);
          return (
            <div key={h.clave} className={cn('rounded-xl border p-3', h.errores ? 'border-red-200 bg-red-50/60' : 'border-line bg-ivory/60')}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-cocoa">
                <Icon className="h-3.5 w-3.5 text-cocoa-muted" /> {h.titulo}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular text-cocoa">{h.nuevos}</p>
              <p className="text-[11px] text-cocoa-muted">{fase === 'guardado' ? 'nuevos' : r.ok ? 'se agregarán' : 'nuevos sin error'}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-cocoa-faint">
                {h.actualizados > 0 && <span>{h.actualizados} actualizados</span>}
                {h.omitidos > 0 && <span>{h.omitidos} ya estaban</span>}
                {h.errores > 0 && <span className="font-semibold text-red-700">{h.errores} con error</span>}
                {h.filas === 0 && <span>hoja vacía</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Errores */}
      {r.errores.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-paper">
          <div className="flex flex-wrap items-center gap-2 border-b border-red-100 px-4 py-3">
            <h3 className="mr-auto text-sm font-semibold text-cocoa">Qué corregir</h3>
            {hojasConError.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {['todas', ...hojasConError].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setFiltro(h)}
                    className={cn('whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium', filtro === h ? 'border-cocoa bg-cocoa text-ivory' : 'border-line bg-paper text-cocoa-muted')}
                  >
                    {h === 'todas' ? 'Todas' : h}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={descargarErrores} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-cocoa hover:bg-cream">
              <DownloadIcon className="h-3.5 w-3.5" /> Descargar lista
            </button>
          </div>
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {errores.map((e, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-cocoa-muted">
                  <span className="block font-semibold text-cocoa">{e.hoja}</span>
                  fila {e.fila}
                </span>
                <span className="min-w-0">
                  {e.columna && <span className="mr-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">{e.columna}</span>}
                  <span className="text-cocoa">{e.mensaje}</span>
                </span>
              </li>
            ))}
          </ul>
          {r.total_errores > r.errores.length && (
            <p className="border-t border-line px-4 py-2 text-xs text-cocoa-muted">Se muestran los primeros {r.errores.length} de {r.total_errores}.</p>
          )}
        </div>
      )}

      {/* Avisos */}
      {r.avisos.length > 0 && (
        <div className="rounded-xl border border-line bg-ivory/60">
          <button type="button" onClick={() => setVerAvisos((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm">
            <InfoIcon className="h-4 w-4 text-gold" />
            <span className="flex-1 font-medium text-cocoa">{r.total_avisos} aviso(s) para que tengas en cuenta</span>
            <ChevronDownIcon className={cn('h-4 w-4 text-cocoa-muted transition-transform', verAvisos && 'rotate-180')} />
          </button>
          {verAvisos && (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto border-t border-line">
              {r.avisos.map((a, i) => (
                <li key={i} className="flex gap-3 px-4 py-2 text-xs">
                  <span className="w-24 shrink-0 text-cocoa-muted">
                    {a.hoja} · fila {a.fila}
                  </span>
                  <span className="text-cocoa">{a.mensaje}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {fase === 'guardado' ? (
          <>
            <Link to="/ti/historial" className="rounded-xl border border-line bg-paper px-4 py-2.5 text-sm font-medium text-cocoa hover:bg-cream">
              Ver historial
            </Link>
            <button type="button" onClick={onOtro} className="rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-cocoa/90">
              Subir otro archivo
            </button>
          </>
        ) : r.ok ? (
          <button
            type="button"
            onClick={onGuardar}
            disabled={nuevos === 0 && actualizados === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-ok px-5 py-2.5 text-sm font-semibold text-ivory hover:bg-ok/90 disabled:opacity-40"
          >
            <CheckCircle2Icon className="h-4 w-4" /> Guardar en el sistema
          </button>
        ) : (
          <button type="button" onClick={onOtro} className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-cocoa/90">
            <UploadCloudIcon className="h-4 w-4" /> Subir el archivo corregido
          </button>
        )}
      </div>
    </>
  );
}

function Banner({ tono, icon, titulo, children }: { tono: 'ok' | 'bad'; icon: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4', tono === 'ok' ? 'border-ok/30 bg-ok-soft text-ok' : 'border-red-200 bg-red-50 text-red-800')}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="mt-0.5 text-sm opacity-90">{children}</p>
      </div>
    </div>
  );
}

function ModalCampos({ hoja, onClose, onDescargar }: { hoja: HojaPlantilla | null; onClose: () => void; onDescargar: (clave: string) => void }) {
  const Icon = hoja ? sheetIcon(hoja.clave) : FileSpreadsheetIcon;
  return (
    <Modal
      open={hoja !== null}
      onClose={onClose}
      title={hoja ? `Hoja «${hoja.titulo}»` : ''}
      subtitle={hoja?.descripcion}
      icon={<Icon className="h-5 w-5" />}
    >
      {hoja && (
        <div className="space-y-3">
          <p className="text-xs text-cocoa-muted">
            Las columnas en <span className="font-semibold text-gold">dorado</span> son obligatorias. Escribe tus datos desde la fila 3.
          </p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {hoja.columnas.map((c) => (
              <li key={c.titulo} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('text-sm font-semibold', c.obligatorio ? 'text-gold' : 'text-cocoa')}>{c.titulo}</span>
                  {c.obligatorio && <span className="rounded-full bg-champagne-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">Obligatorio</span>}
                  <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] text-cocoa-muted">{TIPO_LABEL[c.tipo] ?? c.tipo}</span>
                </div>
                {c.ayuda && <p className="mt-1 text-xs text-cocoa-muted">{c.ayuda}</p>}
                {c.ejemplo && (
                  <p className="mt-1 text-xs text-cocoa-faint">
                    Ejemplo: <span className="font-medium text-cocoa">{c.ejemplo}</span>
                  </p>
                )}
                {c.opciones.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.opciones.map((o) => (
                      <span key={o} className="rounded-md border border-line bg-ivory px-1.5 py-0.5 text-[11px] text-cocoa">{o}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onDescargar(hoja.clave)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-cocoa/90"
          >
            <DownloadIcon className="h-4 w-4" /> Descargar plantilla de {hoja.titulo}
          </button>
        </div>
      )}
    </Modal>
  );
}
