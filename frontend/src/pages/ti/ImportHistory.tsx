import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2Icon, ChevronDownIcon, FileSpreadsheetIcon, RefreshCwIcon, UploadCloudIcon, XCircleIcon } from 'lucide-react';

import { PageHeader } from '../../components/ui/PageHeader';
import { fechaHora, tiApi } from '../../services/tiApi';
import type { Importacion } from '../../services/tiApi';
import { cn } from '../../utils/format';

/** Historial de archivos importados por TI. */
export function ImportHistory() {
  const [items, setItems] = useState<Importacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await tiApi.historial()).importaciones);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Historial"
        subtitle="Cada archivo que se guardó en el sistema: quién lo subió, cuándo y qué se cargó."
        actions={
          <button type="button" onClick={() => void load()} aria-label="Actualizar" className="rounded-xl border border-line bg-paper p-2 text-cocoa hover:bg-cream">
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        }
      />

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {!loading && items.length === 0 && !error ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-paper px-6 py-14 text-center">
          <FileSpreadsheetIcon className="h-10 w-10 text-nude" />
          <p className="mt-3 text-sm font-medium text-cocoa">Todavía no se ha importado ningún archivo</p>
          <Link to="/ti/importar" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-2.5 text-sm font-semibold text-ivory">
            <UploadCloudIcon className="h-4 w-4" /> Importar datos
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <FilaImportacion key={i.id} i={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function FilaImportacion({ i }: { i: Importacion }) {
  const [abierto, setAbierto] = useState(false);
  const ok = i.estado === 'IMPORTADO';
  const nuevos = i.hojas.reduce((s, h) => s + h.nuevos, 0);
  const actualizados = i.hojas.reduce((s, h) => s + h.actualizados, 0);
  const conDatos = i.hojas.filter((h) => h.nuevos || h.actualizados || h.omitidos || h.errores);

  return (
    <li className="rounded-2xl border border-line bg-paper">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {ok ? <CheckCircle2Icon className="h-5 w-5 shrink-0 text-ok" /> : <XCircleIcon className="h-5 w-5 shrink-0 text-bad" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-cocoa">{i.archivo}</span>
          <span className="block text-xs text-cocoa-muted">
            {fechaHora(i.fecha)}
            {i.usuario && ` · ${i.usuario}`}
          </span>
        </span>
        <span className="hidden text-right text-xs sm:block">
          {ok ? (
            <span className="text-cocoa">
              <b className="tabular">{nuevos}</b> nuevos{actualizados > 0 && <> · <b className="tabular">{actualizados}</b> actualizados</>}
            </span>
          ) : (
            <span className="font-semibold text-bad">{i.total_errores} error(es), no se guardó</span>
          )}
        </span>
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-cocoa-muted transition-transform', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 text-xs sm:hidden">
            {ok ? `${nuevos} nuevos · ${actualizados} actualizados` : `${i.total_errores} error(es), no se guardó`}
          </p>
          <div className="flex flex-wrap gap-2">
            {conDatos.map((h) => (
              <span key={h.clave} className="rounded-lg border border-line bg-ivory px-2.5 py-1 text-xs text-cocoa">
                <b>{h.titulo}:</b> {h.nuevos} nuevos
                {h.actualizados > 0 && `, ${h.actualizados} act.`}
                {h.omitidos > 0 && `, ${h.omitidos} ya estaban`}
                {h.errores > 0 && <span className="text-bad">, {h.errores} con error</span>}
              </span>
            ))}
          </div>
          {i.errores.length > 0 && (
            <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-xs">
              {i.errores.map((e, k) => (
                <li key={k} className="text-cocoa">
                  <span className="text-cocoa-muted">
                    {e.hoja} · fila {e.fila}
                    {e.columna && ` · ${e.columna}`}:
                  </span>{' '}
                  {e.mensaje}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
