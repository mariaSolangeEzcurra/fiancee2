
import type {
  CatalogoSimulador,
  OperacionCatalogo,
  RutaCatalogo,
  VestidoCatalogo,
} from './core';

import type {
  ProcessHours,
  ProcessId,
  TimeTemplate,
  Workshop,
} from '../types';

/**
 * Normaliza nombres sin modificar los datos originales de Django.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Relaciona las operaciones de Django con los procesos que reconoce
 * actualmente el simulador de React.
 *
 * Las operaciones sin equivalencia se omiten del cálculo por proceso,
 * pero permanecen en el catálogo original del backend.
 */
const PROCESS_MAP: Record<string, ProcessId> = {
  patronaje: 'patronaje',
  corte: 'corte',
  'corte de tela': 'corte',
  confeccion: 'confeccion',
  entalle: 'entalle',
  corse: 'corse',
  corset: 'corse',
  'prueba 1': 'prueba1',
  'prueba 2': 'prueba2',
  'prueba 3': 'pruebaFinal',
  'prueba final': 'pruebaFinal',
  ajustes: 'ajustes',
  bordado: 'bordado',
  encaje: 'encaje',
  acabados: 'acabados',
  basta: 'acabados',
  lavanderia: 'lavanderia',
};

export function mapProcessName(nombre: string): ProcessId | null {
  return PROCESS_MAP[normalize(nombre)] ?? null;
}

/**
 * Convierte las horas de trabajo de una ruta en el formato de React.
 * Las operaciones de espera no se suman como horas de trabajo.
 */
export function routeToHours(ruta: RutaCatalogo): ProcessHours {
  const hours: ProcessHours = {};

  const orderedOperations = [...ruta.operaciones].sort(
    (a, b) => a.orden - b.orden
  );

  for (const operacion of orderedOperations) {
    if (operacion.tipo_tiempo !== 'TRABAJO') continue;

    const process = mapProcessName(operacion.nombre);
    if (!process) continue;

    const value = Number(operacion.horas_estimadas);

    if (!Number.isFinite(value) || value < 0) continue;

    hours[process] = (hours[process] ?? 0) + value;
  }

  return hours;
}

/**
 * Genera un identificador legible para mantener compatibilidad con
 * el selector de vestidos existente en el frontend.
 */
export function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Construye plantillas desde el catálogo REAL de Django.
 *
 * Cada plantilla conserva:
 * - El ID real del vestido.
 * - El ID real de la ruta.
 * - El taller correspondiente.
 * - Las horas de trabajo por proceso reconocido.
 * - Las horas de espera.
 * - El orden de las operaciones.
 *
 * Nota: backendDressId y backendRouteId deben estar declarados
 * como opcionales en la interfaz TimeTemplate de types/index.ts.
 */
export function catalogToTemplates(
  catalog: CatalogoSimulador
): TimeTemplate[] {
  const templates: TimeTemplate[] = [];

  for (const vestido of catalog.vestidos) {
    for (const ruta of vestido.rutas) {
      const workshop: Workshop =
        ruta.taller === 'C' ? 'Taller C' : 'Taller A';

      const waitingByProcess: Partial<Record<ProcessId, number>> = {};
      let waitingHours = 0;

      const orderedOperations = [...ruta.operaciones].sort(
        (a, b) => a.orden - b.orden
      );

      for (const operation of orderedOperations) {
        if (operation.tipo_tiempo !== 'ESPERA') continue;

        const value = Number(operation.horas_estimadas);

        if (!Number.isFinite(value) || value <= 0) continue;

        const operationName = normalize(operation.nombre);

        // La espera de compra de materiales se considera previa
        // al inicio de la producción.
        if (
          operationName === 'compra materiales' ||
          operationName === 'compra de materiales'
        ) {
          waitingHours += value;
          continue;
        }

        const process = mapProcessName(operation.nombre);

        if (process) {
          waitingByProcess[process] =
            (waitingByProcess[process] ?? 0) + value;
        }
      }

      const processOrder: ProcessId[] = [];

      for (const operation of orderedOperations) {
        const process = mapProcessName(operation.nombre);

        if (process && !processOrder.includes(process)) {
          processOrder.push(process);
        }
      }

      /*
       * Se conserva el slug del vestido para compatibilidad con
       * ContractInput.corteId, que actualmente usa un string.
       *
       * Los IDs numéricos de Django se guardan por separado para
       * futuras solicitudes de persistencia al backend.
       */
      templates.push({
        id: slugify(vestido.nombre),
        name: vestido.nombre,
        workshop,
        description: ruta.descripcion || vestido.descripcion || '',
        hours: routeToHours(ruta),
        waitingHours,
        waitingByProcess,
        source: 'backend',
        processOrder,
        backendDressId: vestido.id,
        backendRouteId: ruta.id,
      });
    }
  }

  return templates;
}

/**
 * Busca un vestido por nombre, slug o ID numérico.
 */
export function findCatalogDress(
  catalog: CatalogoSimulador,
  idOrName: string
): VestidoCatalogo | undefined {
  const target = normalize(idOrName);

  return catalog.vestidos.find((vestido) => {
    return (
      normalize(vestido.nombre) === target ||
      slugify(vestido.nombre) === target ||
      String(vestido.id) === idOrName
    );
  });
}

/**
 * Busca una operación por nombre dentro de una ruta.
 */
export function findCatalogOperation(
  ruta: RutaCatalogo,
  nombre: string
): OperacionCatalogo | undefined {
  const target = normalize(nombre);

  return ruta.operaciones.find(
    (operacion) => normalize(operacion.nombre) === target
  );
}
