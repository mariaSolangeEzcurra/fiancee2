
import {
  collections,
  complexityFactors,
  levelFactors,
  skirtVolumes,
} from '../data/processes';

import type {
  ContractSpec,
  ProcessHours,
  ProcessId,
  TimeTemplate,
} from '../types';

import { roundHalf } from './format';
import { PROCESS_ORDER } from './processes';

const REFERENCE_TOTAL = 46;

export function templateTotal(t: TimeTemplate): number {
  return Object.values(t.hours ?? {}).reduce<number>(
    (sum, hours) => sum + (hours ?? 0),
    0
  );
}

export function totalHours(hours: ProcessHours): number {
  return Object.values(hours ?? {}).reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0
  );
}

export function routeFromHours(
  hours: ProcessHours,
  processOrder?: ProcessId[]
): ProcessId[] {
  const order = processOrder?.length
    ? processOrder
    : PROCESS_ORDER;

  return order.filter(
    (process) =>
      process === 'entrega' || (hours?.[process] ?? 0) > 0
  );
}

/**
 * Estima las horas de trabajo por proceso.
 *
 * Las plantillas de Django conservan sus horas originales.
 * Las plantillas locales mantienen los multiplicadores del simulador.
 */
export function estimateHours(
  spec: ContractSpec,
  templates: TimeTemplate[]
): ProcessHours {
  if (!Array.isArray(templates) || templates.length === 0) {
    return {};
  }

  const selectedId = String(spec.corteId ?? '');

  const tallerA = templates.filter(
    (template) => template.workshop === 'Taller A'
  );

  const tallerC = templates.filter(
    (template) => template.workshop === 'Taller C'
  );

  const corte =
    tallerA.find(
      (template) =>
        template.id === selectedId ||
        String(template.backendDressId ?? '') === selectedId
    ) ?? tallerA[0];

  const tallerCSeleccionado = tallerC.find(
    (template) =>
      template.id === selectedId ||
      String(template.backendDressId ?? '') === selectedId
  );

  const isC = spec.workshop === 'Taller C';

  const selectedTemplate = isC
    ? tallerCSeleccionado
    : corte;

  // Evita el error "Cannot read properties of undefined (reading 'hours')".
  if (!selectedTemplate) {
    return {};
  }

  const base: ProcessHours = {
    ...(selectedTemplate.hours ?? {}),
  };

  const h: ProcessHours = { ...base };

  /*
   * Para plantillas de Django, las horas recibidas del backend son
   * la referencia. No aplicamos multiplicadores locales adicionales.
   */
  if (selectedTemplate.source === 'backend') {
    for (const process of spec.excluded ?? []) {
      delete h[process];
    }

    const result: ProcessHours = {};

    PROCESS_ORDER.forEach((process) => {
      const value = h[process];

      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
      ) {
        result[process] = roundHalf(value);
      }
    });

    return result;
  }

  /*
   * A partir de aquí se conserva la lógica de estimación
   * de las plantillas locales.
   */
  const cx =
    complexityFactors.find(
      (complexity) => complexity.id === spec.complexity
    )?.factor ?? 1;

  const collection =
    collections.find((item) => item.id === spec.collection) ??
    collections[0];

  const mult = (process: ProcessId, factor: number) => {
    if (h[process] !== undefined) {
      h[process] = (h[process] ?? 0) * factor;
    }
  };

  const add = (process: ProcessId, value: number) => {
    h[process] = (h[process] ?? 0) + value;
  };

  if (isC) {
    const shape = Math.min(
      1.3,
      Math.max(0.85, templateTotal(corte ?? selectedTemplate) / REFERENCE_TOTAL)
    );

    mult('entalle', shape);
    mult('corse', shape);
  }

  PROCESS_ORDER.forEach((process) => mult(process, cx));

  const bordadoLevel =
    levelFactors.find((level) => level.id === spec.bordado)?.factor ?? 1;

  const encajeLevel =
    levelFactors.find((level) => level.id === spec.encaje)?.factor ?? 1;

  const bordadoBase =
    (base.bordado ?? 0) > 0 ? base.bordado ?? 0 : 6;

  const encajeBase =
    (base.encaje ?? 0) > 0 ? base.encaje ?? 0 : 5;

  h.bordado =
    bordadoBase * cx * bordadoLevel * collection.bordado;

  h.encaje =
    encajeBase * cx * encajeLevel * collection.encaje;

  mult('acabados', collection.acabados);

  const bodyProcess: ProcessId = isC ? 'entalle' : 'confeccion';

  if (spec.type === 'Quinceañera') {
    mult(isC ? 'corse' : 'confeccion', 1.1);
    mult('acabados', 1.1);
  }

  const volume =
    skirtVolumes.find((item) => item.id === spec.volume) ??
    skirtVolumes[0];

  if (volume) {
    mult(bodyProcess, volume.confeccion);

    if (volume.acabados) {
      add('acabados', volume.acabados);
    }

    if (!isC && volume.corte) {
      add('corte', volume.corte);
    }
  }

  const features = spec.features ?? [];

  if (features.includes('pedreria')) {
    add('bordado', 6 * cx);
  }

  if (features.includes('corse')) {
    add(isC ? 'corse' : 'confeccion', 5);
  }

  if (features.includes('cola')) {
    add(bodyProcess, 5);
    add('acabados', 2);
  }

  if (features.includes('mangas')) {
    add(bodyProcess, 4);
  }

  if (features.includes('provincia')) {
    (
      ['prueba1', 'prueba2', 'pruebaFinal'] as ProcessId[]
    ).forEach((process) => {
      if ((h[process] ?? 0) > 0) {
        add(process, 1);
      }
    });
  }

  for (const process of spec.excluded ?? []) {
    delete h[process];
  }

  const result: ProcessHours = {};

  PROCESS_ORDER.forEach((process) => {
    const value = h[process];

    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0
    ) {
      result[process] = roundHalf(value);
    }
  });

  return result;
}
