import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon, DownloadIcon, FileSpreadsheetIcon, ShieldCheckIcon, UploadCloudIcon } from 'lucide-react';

import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import { fechaHora, tiApi } from '../../services/tiApi';
import type { ResumenTI } from '../../services/tiApi';
import { FilaImportacion } from './ImportHistory';
import { sheetIcon } from './sheetIcons';

/** Inicio de TI: cuánta información hay en el sistema y accesos rápidos. */
export function TiHome() {
  const { user } = useAuth();
  const [data, setData] = useState<ResumenTI | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    tiApi
      .resumen()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar.'));
  }, []);

  const nombre = user?.nombre?.split(' ')[0] || user?.username || '';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hola${nombre ? `, ${nombre}` : ''}`}
        subtitle="Desde aquí cargas la información del negocio al sistema usando plantillas de Excel."
      />

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {/* Acción principal */}
      <section className="overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-champagne-soft via-paper to-blush-soft p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex-1">
            <h2 className="font-display text-2xl font-semibold text-cocoa md:text-3xl">¿Tienes datos en Excel?</h2>
            <ol className="mt-3 space-y-1.5 text-sm text-cocoa-muted">
              <li><b className="text-cocoa">1.</b> Descarga la plantilla y copia ahí tus datos.</li>
              <li><b className="text-cocoa">2.</b> Súbela: el sistema la revisa y te dice qué corregir.</li>
              <li><b className="text-cocoa">3.</b> Confirma y listo: todos los roles lo ven al instante.</li>
            </ol>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
            <Link to="/ti/importar" className="inline-flex items-center justify-center gap-2 rounded-xl bg-cocoa px-5 py-3 text-sm font-semibold text-ivory hover:bg-cocoa/90">
              <UploadCloudIcon className="h-4 w-4" /> Importar datos
            </Link>
            <button
              type="button"
              onClick={() => void tiApi.descargarPlantilla()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-medium text-cocoa hover:bg-cream"
            >
              <DownloadIcon className="h-4 w-4" /> Descargar plantilla
            </button>
          </div>
        </div>
      </section>

      {/* Lo que hay en el sistema */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-cocoa">Lo que hay hoy en el sistema</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {(data?.datos ?? Array.from({ length: 6 }, (_, i) => ({ clave: String(i), titulo: '', total: 0, detalle: '' }))).map((d, i) => {
            const Icon = sheetIcon(d.clave);
            return (
              <motion.div
                key={d.clave}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-2xl border border-line bg-paper p-4"
              >
                {data ? (
                  <>
                    <Icon className="h-4 w-4 text-gold" />
                    <p className="mt-2 font-display text-3xl font-semibold tabular text-cocoa">{d.total}</p>
                    <p className="text-xs font-medium text-cocoa">{d.titulo}</p>
                    {d.detalle && <p className="mt-0.5 text-[11px] text-cocoa-muted">{d.detalle}</p>}
                  </>
                ) : (
                  <div className="h-[86px] animate-pulse rounded-lg bg-cream/70" />
                )}
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Últimas cargas */}
      <section className="rounded-2xl border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-cocoa">Últimas cargas</h2>
            <p className="text-xs text-cocoa-muted">
              {data?.ultima_importacion ? `Última carga: ${fechaHora(data.ultima_importacion)}` : 'Aún no se ha cargado ningún archivo.'}
            </p>
          </div>
          <Link to="/ti/historial" className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
            Ver todo <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
        {data && data.recientes.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <FileSpreadsheetIcon className="h-9 w-9 text-nude" />
            <p className="mt-2 text-sm text-cocoa-muted">Cuando subas tu primer archivo aparecerá aquí.</p>
          </div>
        ) : (
          <ul className="space-y-2 p-3">
            {(data?.recientes ?? []).map((i) => (
              <FilaImportacion key={i.id} i={i} />
            ))}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs text-cocoa-faint">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
        Si un archivo tiene errores, no se guarda nada. Si vuelves a subir el mismo archivo, lo que ya está en el sistema se omite y no se duplica.
      </p>
    </div>
  );
}
