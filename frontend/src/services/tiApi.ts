/**
 * Área de TI: plantillas Excel, importación de datos e historial.
 * Backend: /api/core/ti/
 */
import { apiRequest } from './contractsApi';
import { authorizedFetch } from './core';

const BASE = '/api/core/ti/';

export interface ColumnaPlantilla {
  titulo: string;
  obligatorio: boolean;
  tipo: 'texto' | 'numero' | 'fecha' | 'opcion' | 'sino' | 'lista';
  ayuda: string;
  ejemplo: string;
  opciones: string[];
}

export interface HojaPlantilla {
  clave: string;
  titulo: string;
  descripcion: string;
  icono: string;
  columnas: ColumnaPlantilla[];
}

export interface ResumenHoja {
  clave: string;
  titulo: string;
  filas: number;
  nuevos: number;
  actualizados: number;
  omitidos: number;
  errores: number;
}

export interface ErrorFila {
  hoja: string;
  fila: number;
  columna: string;
  mensaje: string;
}

export interface AvisoFila {
  hoja: string;
  fila: number;
  mensaje: string;
}

export interface ResultadoImportacion {
  ok: boolean;
  guardado: boolean;
  hojas: ResumenHoja[];
  errores: ErrorFila[];
  total_errores: number;
  avisos: AvisoFila[];
  total_avisos: number;
}

export interface Importacion {
  id: number;
  archivo: string;
  estado: 'IMPORTADO' | 'CON_ERRORES';
  usuario: string;
  fecha: string;
  hojas: ResumenHoja[];
  total_errores: number;
  errores: ErrorFila[];
}

export interface ResumenTI {
  datos: { clave: string; titulo: string; total: number; detalle?: string }[];
  ultima_importacion: string | null;
  importaciones: number;
  recientes: Importacion[];
}

export const tiApi = {
  resumen: () => apiRequest<ResumenTI>(`${BASE}resumen/`),
  esquema: () => apiRequest<{ hojas: HojaPlantilla[] }>(`${BASE}esquema/`),
  historial: () => apiRequest<{ importaciones: Importacion[] }>(`${BASE}historial/`),

  importar(archivo: File, guardar: boolean) {
    const body = new FormData();
    body.append('archivo', archivo);
    body.append('guardar', guardar ? '1' : '0');
    return apiRequest<ResultadoImportacion>(`${BASE}importar/`, { method: 'POST', body });
  },

  /** Descarga la plantilla (todas las hojas o solo las indicadas). */
  async descargarPlantilla(hojas?: string[]) {
    const q = hojas?.length ? `?hojas=${hojas.join(',')}` : '';
    const resp = await authorizedFetch(`/core/ti/plantilla/${q}`);
    if (!resp.ok) throw new Error('No se pudo descargar la plantilla.');
    const blob = await resp.blob();
    const disp = resp.headers.get('Content-Disposition') ?? '';
    const nombre = /filename="([^"]+)"/.exec(disp)?.[1] ?? 'plantilla_fiancee.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export function fechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
