

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  AreaId,
  AreaNeed,
  ContractInput,
  ProcessHours,
  ProcessId,
  SimulationOperation,
  SimulationResult,
  TimeTemplate,
  Tone,
} from '../../types';

import {
  getCapacidadProduccion,
  getCatalogoSimulador,
} from '../../services/core';

import type {
  CapacidadProduccion,
  CatalogoSimulador,
  OperacionCatalogo,
  RutaCatalogo,
} from '../../services/core';

import { catalogToTemplates } from '../../services/catalogAdapter';
import { addCalendarDays, TODAY, toISO } from '../../utils/dates';

interface CatalogState {
  templates: TimeTemplate[];
  catalog: CatalogoSimulador | null;
  loading: boolean;
  error: string | null;
}

interface CapacityState {
  data: CapacidadProduccion | null;
  loading: boolean;
  error: string | null;
}

interface ResolvedItem {
  input: ContractInput;
  template: TimeTemplate;
}

interface ScheduledOperation extends SimulationOperation {
  process: ProcessId | null;
  areaId: AreaId | null;
}

interface ScheduleResult {
  feasible: boolean;
  complete: boolean;
  finishDates: string[];
  startDates: string[];
  totalHours: number;
  reasons: string[];
  operations: ScheduledOperation[];
  assignedByArea: Map<AreaId, number>;
  workersByArea: Map<AreaId, Set<string>>;
  capacityByArea: Map<AreaId, number>;
  reservedByArea: Map<AreaId, number>;
  remainingByArea: Map<AreaId, number>;
  currentLoad: number;
}

interface CapacityRange {
  desde: string;
  hasta: string;
  complete: boolean;
}

const MAX_CAPACITY_DAYS = 365;
const API_MAX_DAYS = 90;
const NEAR_TERM_DAYS = 14;
const HOURS_EPSILON = 0.0001;

const AREA_IDS: AreaId[] = [
  'patronaje',
  'corte',
  'confeccion',
  'bordado',
  'encaje',
  'pruebas',
  'acabados',
  'lavanderia',
];

function todayISO(): string {
  return toISO(TODAY);
}

function dateFromISO(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dayDifference(from: string, to: string): number {
  return Math.round(
    (dateFromISO(to).getTime() - dateFromISO(from).getTime()) /
      86400000,
  );
}

function createInitialInput(): ContractInput {
  const today = todayISO();
  const eventDate = addCalendarDays(today, 180);

  return {
    client: '',
    city: '',
    eventDate,
    deliveryDate: addCalendarDays(eventDate, -7),
    price: 0,
    corteId: '',
    workshop: 'Taller A',
    type: 'Quinceañera',
    complexity: 'Media',
    collection: 'Maison Luxe',
    bordado: 'Ninguno',
    encaje: 'Ninguno',
    volume: 'Estándar',
    features: [],
    excluded: [],
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseHours(value: string | number | undefined): number {
  const hours = Number(value);
  return Number.isFinite(hours) ? Math.max(0, hours) : 0;
}

function addToMap<K>(
  map: Map<K, number>,
  key: K,
  value: number,
): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function resolveTemplate(
  templates: TimeTemplate[],
  input?: ContractInput | null,
): TimeTemplate | null {
  if (!input?.corteId || !input.workshop) return null;

  const target = normalize(String(input.corteId));

  return (
    templates.find(
      (template) =>
        String(template.id) === String(input.corteId) &&
        template.workshop === input.workshop,
    ) ??
    templates.find(
      (template) =>
        template.backendDressId !== undefined &&
        String(template.backendDressId) === String(input.corteId) &&
        template.workshop === input.workshop,
    ) ??
    templates.find(
      (template) =>
        normalize(template.name) === target &&
        template.workshop === input.workshop,
    ) ??
    null
  );
}

function areaFromBackend(value: string): AreaId | null {
  const area = normalize(value);

  const mapping: Record<string, AreaId> = {
    patronaje: 'patronaje',
    corte: 'corte',
    confeccion: 'confeccion',
    entalle: 'confeccion',
    corse: 'confeccion',
    corset: 'confeccion',
    bordado: 'bordado',
    encaje: 'encaje',
    pruebas: 'pruebas',
    prueba: 'pruebas',
    acabados: 'acabados',
    acabado: 'acabados',
    basta: 'acabados',
    lavanderia: 'lavanderia',
  };

  return mapping[area] ?? null;
}

/**
 * Compatibilidad con componentes antiguos que usan ProcessId.
 * La planificación y la visualización de operaciones utilizan
 * los nombres originales recibidos de Django.
 */
function processFromOperation(
  operation: OperacionCatalogo,
): ProcessId | null {
  const name = normalize(operation.nombre);

  if (name.includes('patronaje')) return 'patronaje';
  if (name.includes('corte')) return 'corte';
  if (name.includes('confeccion')) return 'confeccion';
  if (name.includes('entalle')) return 'entalle';

  if (name.includes('corse') || name.includes('corset')) {
    return 'corse';
  }

  if (name.includes('prueba 1')) return 'prueba1';
  if (name.includes('prueba 2')) return 'prueba2';

  if (name.includes('prueba final') || name.includes('prueba 3')) {
    return 'pruebaFinal';
  }

  if (name.includes('ajuste')) return 'ajustes';
  if (name.includes('bordado')) return 'bordado';
  if (name.includes('encaje')) return 'encaje';

  if (name.includes('acabado') || name.includes('basta')) {
    return 'acabados';
  }

  if (name.includes('lavanderia')) return 'lavanderia';
  if (name.includes('entrega')) return 'entrega';

  return null;
}

function operationIsExcluded(
  operation: OperacionCatalogo,
  input: ContractInput,
): boolean {
  const process = processFromOperation(operation);

  return process !== null &&
    (input.excluded ?? []).includes(process);
}

function routeForTemplate(
  catalog: CatalogoSimulador,
  template: TimeTemplate,
): RutaCatalogo | null {
  if (
    template.backendDressId === undefined ||
    template.backendRouteId === undefined
  ) {
    return null;
  }

  const dress = catalog.vestidos.find(
    (item) => item.id === template.backendDressId,
  );

  if (!dress) return null;

  const workshop = template.workshop === 'Taller C' ? 'C' : 'A';

  return (
    dress.rutas.find(
      (route) =>
        route.id === template.backendRouteId &&
        route.taller === workshop,
    ) ?? null
  );
}

/**
 * Desglose de horas para los componentes antiguos de la interfaz.
 * Las horas proceden siempre de las operaciones del catálogo Django.
 * Este desglose no es la fuente de verdad del planificador.
 */
function getHoursFromCatalog(
  catalog: CatalogoSimulador | null,
  template: TimeTemplate | null,
  input: ContractInput,
): ProcessHours {
  if (!catalog || !template) return {};

  const route = routeForTemplate(catalog, template);
  if (!route) return {};

  const result: ProcessHours = {};

  for (const operation of route.operaciones) {
    if (
      !operation.obligatoria ||
      operation.tipo_tiempo === 'ESPERA' ||
      operationIsExcluded(operation, input)
    ) {
      continue;
    }

    const process = processFromOperation(operation);
    if (!process) continue;

    result[process] =
      (result[process] ?? 0) +
      parseHours(operation.horas_estimadas);
  }

  return result;
}

function validateInput(input?: ContractInput | null): string | null {
  if (!input) return 'Completa los datos antes de simular.';
  if (!input.corteId) return 'Selecciona un vestido del catálogo de Django.';
  if (!input.client.trim()) return 'Ingresa el nombre de la clienta.';

  if (!input.eventDate || !input.deliveryDate) {
    return 'Completa la fecha del evento y la fecha de entrega.';
  }

  if (input.deliveryDate < todayISO()) {
    return 'La fecha de entrega no puede estar en el pasado.';
  }

  if (input.deliveryDate > input.eventDate) {
    return 'La fecha de entrega no puede ser posterior al evento.';
  }

  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'El precio debe ser un número igual o mayor que cero.';
  }

  return null;
}

function getCapacityRange(items: ContractInput[]): CapacityRange {
  const desde = todayISO();
  const maxDate = addCalendarDays(desde, MAX_CAPACITY_DAYS - 1);

  const requestedDates = items
    .map((item) => item.deliveryDate)
    .filter(Boolean)
    .sort();

  const latestDate = requestedDates.at(-1) ?? maxDate;
  const hasta = latestDate < maxDate ? latestDate : maxDate;

  return {
    desde,
    hasta,
    complete: latestDate <= maxDate,
  };
}

function createEmptySchedule(
  complete: boolean,
  reasons: string[] = [],
): ScheduleResult {
  return {
    feasible: false,
    complete,
    finishDates: [],
    startDates: [],
    totalHours: 0,
    reasons,
    operations: [],
    assignedByArea: new Map(),
    workersByArea: new Map(),
    capacityByArea: new Map(),
    reservedByArea: new Map(),
    remainingByArea: new Map(),
    currentLoad: 0,
  };
}

/**
 * Planificación provisional basada exclusivamente en catálogo
 * y capacidad diaria de Django.
 */
function scheduleFromBackend(
  items: ResolvedItem[],
  catalog: CatalogoSimulador,
  capacity: CapacidadProduccion,
  rangeComplete: boolean,
): ScheduleResult {
  const reasons: string[] = [];
  const finishDates: string[] = [];
  const startDates: string[] = [];
  const operationsLog: ScheduledOperation[] = [];

  const assignedByArea = new Map<AreaId, number>();
  const workersByArea = new Map<AreaId, Set<string>>();
  const capacityByArea = new Map<AreaId, number>();
  const reservedByArea = new Map<AreaId, number>();
  const remainingByArea = new Map<AreaId, number>();

  let feasible = true;
  let complete = rangeComplete;
  let totalHours = 0;

  const dailyRemaining = new Map<string, Map<number, number>>();

  const days = [...capacity.dias].sort(
    (a, b) => a.fecha.localeCompare(b.fecha),
  );

  for (const day of days) {
    const workerHours = new Map<number, number>();

    for (const worker of day.trabajadoras) {
      const free = parseHours(worker.horas_restantes);
      const reserved = parseHours(worker.horas_reservadas);
      const area = areaFromBackend(worker.area);

      workerHours.set(worker.trabajadora_id, free);

      if (area) {
        addToMap(remainingByArea, area, free);
        addToMap(capacityByArea, area, free + reserved);
        addToMap(reservedByArea, area, reserved);
      }
    }

    dailyRemaining.set(day.fecha, workerHours);
  }

  const dates = days.map((day) => day.fecha);
  const capacityEnd = dates.at(-1);

  if (!capacityEnd) {
    return createEmptySchedule(false, [
      'Django no devolvió días de capacidad para planificar.',
    ]);
  }

  const nearTermEnd = addCalendarDays(
    todayISO(),
    NEAR_TERM_DAYS - 1,
  );

  let nearTermCapacity = 0;
  let nearTermReserved = 0;

  for (const day of days) {
    if (day.fecha < todayISO() || day.fecha > nearTermEnd) continue;

    for (const worker of day.trabajadoras) {
      nearTermCapacity +=
        parseHours(worker.horas_restantes) +
        parseHours(worker.horas_reservadas);

      nearTermReserved += parseHours(worker.horas_reservadas);
    }
  }

  const currentLoad = nearTermCapacity > 0
    ? nearTermReserved / nearTermCapacity
    : 0;

  const orderedItems = [...items].sort(
    (a, b) => a.input.deliveryDate.localeCompare(b.input.deliveryDate),
  );

  for (const item of orderedItems) {
    const route = routeForTemplate(catalog, item.template);

    if (!route) {
      feasible = false;
      reasons.push(
        `No se encontró la ruta de "${item.template.name}" ` +
        `para ${item.input.workshop}.`,
      );
      continue;
    }

    const routeOperations = [...route.operaciones]
      .filter(
        (operation) =>
          operation.obligatoria &&
          !operationIsExcluded(operation, item.input),
      )
      .sort((a, b) => a.orden - b.orden);

    totalHours += routeOperations.reduce(
      (sum, operation) =>
        sum + (
          operation.tipo_tiempo === 'ESPERA'
            ? 0
            : parseHours(operation.horas_estimadas)
        ),
      0,
    );

    let cursorDate = todayISO();
    let firstWorkDate: string | null = null;
    let itemFailed = false;

    const deadline = item.input.deliveryDate;

    // Las dependencias se refieren a PlantillaOperacion.id.
    const completedTemplateOperationIds = new Set<number>();

    for (const operation of routeOperations) {
      const requiredHours = parseHours(operation.horas_estimadas);
      const process = processFromOperation(operation);
      const area = areaFromBackend(operation.area);
      const waiting = operation.tipo_tiempo === 'ESPERA';

      const logEntry: ScheduledOperation = {
        itemName: item.template.name,
        operationName: operation.nombre,
        operationId: operation.id,
        area: operation.area || null,
        requiredHours,
        assignedHours: 0,
        startDate: null,
        finishDate: null,
        workerIds: [],
        waiting,
        process,
        areaId: area,
      };

      const dependencies = Array.isArray(operation.dependencias)
        ? operation.dependencias.map(Number)
        : [];

      const unmetDependencies = dependencies.filter(
        (dependencyId) =>
          !completedTemplateOperationIds.has(dependencyId),
      );

      if (unmetDependencies.length > 0) {
        feasible = false;
        itemFailed = true;

        reasons.push(
          `"${item.template.name}": las dependencias de ` +
          `"${operation.nombre}" no se completaron en el orden requerido.`,
        );

        operationsLog.push(logEntry);
        break;
      }

      if (requiredHours <= HOURS_EPSILON) {
        operationsLog.push(logEntry);
        completedTemplateOperationIds.add(operation.id);
        continue;
      }

      if (waiting) {
        const waitingDays = Math.ceil(requiredHours / 24);

        logEntry.startDate = cursorDate;
        cursorDate = addCalendarDays(cursorDate, waitingDays);
        logEntry.finishDate = cursorDate;

        operationsLog.push(logEntry);
        completedTemplateOperationIds.add(operation.id);

        if (cursorDate > deadline) {
          feasible = false;
          itemFailed = true;

          reasons.push(
            `"${item.template.name}": la espera de ` +
            `"${operation.nombre}" supera la fecha de entrega.`,
          );
          break;
        }

        if (cursorDate > capacityEnd) {
          complete = false;
          itemFailed = true;

          reasons.push(
            `"${item.template.name}": la espera de ` +
            `"${operation.nombre}" supera el periodo consultado.`,
          );
          break;
        }

        continue;
      }

      if (cursorDate > deadline || cursorDate > capacityEnd) {
        itemFailed = true;

        if (deadline > capacityEnd) {
          complete = false;
        } else {
          feasible = false;
        }

        reasons.push(
          `"${item.template.name}": no hay un periodo consultado ` +
          `válido para "${operation.nombre}".`,
        );

        operationsLog.push(logEntry);
        break;
      }

      // Las habilidades se comparan con el ID global de Operacion.
      const qualifiedWorkers = catalog.trabajadoras.filter(
        (worker) => worker.habilidades.includes(operation.operacion_id),
      );

      if (qualifiedWorkers.length === 0) {
        feasible = false;
        itemFailed = true;

        reasons.push(
          `"${item.template.name}": ninguna trabajadora tiene ` +
          `la habilidad requerida para "${operation.nombre}".`,
        );

        operationsLog.push(logEntry);
        break;
      }

      let hoursLeft = requiredHours;
      let firstScheduledDate: string | null = null;
      let lastScheduledDate: string | null = null;

      const usedWorkers = new Set<string>();

      // La operación se prueba sobre una copia; si falla, no consume capacidad.
      const tentative = new Map<string, Map<number, number>>();

      for (const [date, workerHours] of dailyRemaining.entries()) {
        tentative.set(date, new Map(workerHours));
      }

      for (
        let date = cursorDate;
        date <= capacityEnd &&
        date <= deadline &&
        hoursLeft > HOURS_EPSILON;
        date = addCalendarDays(date, 1)
      ) {
        const dailyCapacity = tentative.get(date);
        if (!dailyCapacity) continue;

        const candidates = [...qualifiedWorkers].sort(
          (a, b) =>
            (dailyCapacity.get(b.id) ?? 0) -
            (dailyCapacity.get(a.id) ?? 0),
        );

        for (const worker of candidates) {
          const freeHours = dailyCapacity.get(worker.id) ?? 0;
          if (freeHours <= HOURS_EPSILON) continue;

          const assigned = Math.min(hoursLeft, freeHours);

          dailyCapacity.set(worker.id, freeHours - assigned);
          hoursLeft -= assigned;

          firstScheduledDate ??= date;
          lastScheduledDate = date;
          usedWorkers.add(String(worker.id));

          if (hoursLeft <= HOURS_EPSILON) break;
        }
      }

      if (hoursLeft > HOURS_EPSILON) {
        itemFailed = true;

        if (deadline > capacityEnd) {
          complete = false;
        } else {
          feasible = false;
        }

        reasons.push(
          `"${item.template.name}": faltan ${hoursLeft.toFixed(2)} ` +
          `horas para completar "${operation.nombre}" antes de ${deadline}.`,
        );

        operationsLog.push(logEntry);
        break;
      }

      // Confirmar el consumo solamente si se completó la operación.
      dailyRemaining.clear();

      for (const [date, workerHours] of tentative.entries()) {
        dailyRemaining.set(date, workerHours);
      }

      logEntry.assignedHours = requiredHours;
      logEntry.startDate = firstScheduledDate;
      logEntry.finishDate = lastScheduledDate;
      logEntry.workerIds = [...usedWorkers];

      operationsLog.push(logEntry);
      completedTemplateOperationIds.add(operation.id);

      if (area) {
        addToMap(assignedByArea, area, requiredHours);

        const staff = workersByArea.get(area) ?? new Set<string>();

        for (const workerId of usedWorkers) {
          staff.add(workerId);
        }

        workersByArea.set(area, staff);
      }

      if (!firstWorkDate && firstScheduledDate) {
        firstWorkDate = firstScheduledDate;
      }

      if (lastScheduledDate) {
        cursorDate = lastScheduledDate;
      }
    }

    if (firstWorkDate) startDates.push(firstWorkDate);

    if (!itemFailed) {
      finishDates.push(cursorDate);

      if (cursorDate > deadline) {
        feasible = false;
        reasons.push(
          `"${item.template.name}": la finalización calculada ` +
          `(${cursorDate}) supera la fecha de entrega (${deadline}).`,
        );
      }
    }
  }

  if (!rangeComplete) {
    complete = false;
    reasons.push(
      'La fecha solicitada supera los 365 días consultados. ' +
      'No se puede confirmar la capacidad fuera de ese periodo.',
    );
  }

  reasons.push(
    'La planificación es provisional y no crea contratos ni reservas.',
  );
  reasons.push(
    'La cola real de vestidos pendientes no está disponible en estas API.',
  );

  return {
    feasible,
    complete,
    finishDates,
    startDates,
    totalHours,
    reasons,
    operations: operationsLog,
    assignedByArea,
    workersByArea,
    capacityByArea,
    reservedByArea,
    remainingByArea,
    currentLoad,
  };
}

function buildAreaNeeds(
  schedule: ScheduleResult,
  catalog: CatalogoSimulador,
): AreaNeed[] {
  return AREA_IDS
    .map((area): AreaNeed => {
      const areaOperations = schedule.operations.filter(
        (operation) => operation.areaId === area && !operation.waiting,
      );

      const needed = areaOperations.reduce(
        (sum, operation) => sum + operation.requiredHours,
        0,
      );

      const available = schedule.remainingByArea.get(area) ?? 0;
      const reserved = schedule.reservedByArea.get(area) ?? 0;
      const capacity = schedule.capacityByArea.get(area) ?? available;
      const assigned = schedule.assignedByArea.get(area) ?? 0;
      const margin = available - needed;

      const utilAfter = capacity > 0
        ? (reserved + assigned) / capacity
        : needed > 0 ? 1 : 0;

      const staffSet = schedule.workersByArea.get(area) ?? new Set<string>();

      const staff = catalog.trabajadoras
        .filter((worker) => staffSet.has(String(worker.id)))
        .map((worker) => worker.nombre);

      let tone: Tone = 'ok';

      if (needed > available + HOURS_EPSILON) {
        tone = 'bad';
      } else if (utilAfter >= 0.9 || margin < 8) {
        tone = 'risk';
      }

      return {
        area,
        capacity,
        committed: reserved + assigned,
        available,
        utilization: capacity > 0 ? reserved / capacity : 0,
        needed,
        margin,
        utilAfter,
        readyDay: 0,
        tone,
        staff,
        staffNeeded: staff.length,
      };
    })
    .filter((area) => area.needed > 0 || area.available > 0);
}

function buildSimulationResult(
  items: ResolvedItem[],
  schedule: ScheduleResult,
  catalog: CatalogoSimulador,
): SimulationResult {
  const target = items[0].input;

  const requestedDelivery = items
    .map((item) => item.input.deliveryDate)
    .sort()
    .at(-1) ?? target.deliveryDate;

  const allFinished = schedule.finishDates.length === items.length;
  const lastFinish = allFinished
    ? [...schedule.finishDates].sort().at(-1) ?? null
    : null;

  const firstStart = [...schedule.startDates].sort()[0] ?? todayISO();

  const start = dateFromISO(firstStart);
  const finish = lastFinish ? dateFromISO(lastFinish) : null;
  const delivery = dateFromISO(requestedDelivery);
  const event = dateFromISO(target.eventDate);

  const marginDays = lastFinish
    ? dayDifference(lastFinish, requestedDelivery)
    : -1;

  const areas = buildAreaNeeds(schedule, catalog);

  const critical = [...areas].sort(
    (a, b) => a.margin - b.margin,
  )[0] ?? null;

  const availableHours = areas.reduce(
    (sum, area) => sum + area.available,
    0,
  );

  const marginHours = lastFinish
    ? availableHours - schedule.totalHours
    : 0;

  let status: SimulationResult['status'] = 'risk';

  if (!schedule.feasible && schedule.complete) {
    status = 'bad';
  } else if (
    schedule.feasible &&
    schedule.complete &&
    allFinished &&
    marginDays >= 7
  ) {
    status = 'ok';
  } else if (
    schedule.feasible &&
    schedule.complete &&
    allFinished &&
    marginDays < 0
  ) {
    status = 'bad';
  }

  const reasons = [...schedule.reasons];

  if (!schedule.complete) {
    reasons.push(
      'La simulación es parcial: no se ha confirmado todo el periodo solicitado.',
    );
  }

  if (!lastFinish) {
    reasons.push(
      'No hay una fecha final confirmada porque no se completó ' +
      'la planificación de todos los vestidos.',
    );
  }

  const processTotals = new Map<ProcessId, number>();
  const processAreas = new Map<ProcessId, AreaId>();

  for (const operation of schedule.operations) {
    if (!operation.process || operation.waiting) continue;

    processTotals.set(
      operation.process,
      (processTotals.get(operation.process) ?? 0) +
        operation.requiredHours,
    );

    if (operation.areaId) {
      processAreas.set(operation.process, operation.areaId);
    }
  }

  const byProcess = [...processTotals.entries()].map(
    ([process, hours]) => ({
      process,
      hours,
      area: processAreas.get(process) ?? null,
    }),
  );

  return {
    status,
    totalHours: schedule.totalHours,
    byProcess,
    operations: schedule.operations.map((operation) => ({
      itemName: operation.itemName,
      operationName: operation.operationName,
      operationId: operation.operationId,
      area: operation.area,
      requiredHours: operation.requiredHours,
      assignedHours: operation.assignedHours,
      startDate: operation.startDate,
      finishDate: operation.finishDate,
      workerIds: operation.workerIds,
      waiting: operation.waiting,
    })),
    areas,
    start,
    finish,
    delivery,
    event,
    deliveryDays: dayDifference(firstStart, requestedDelivery),
    marginDays,
    availableHours,
    marginHours,
    critical,
    queue: {
      dressesAhead: null,
      hoursAhead: null,
      delayDays: null,
    },
    currentLoad: schedule.currentLoad,
    staffNeeded: Math.max(
      0,
      ...areas.map((area) => area.staffNeeded),
    ),
    minLead: lastFinish ? dayDifference(firstStart, lastFinish) : 0,
    reasons,
    alternativeDate:
      lastFinish && status === 'bad' && lastFinish > requestedDelivery
        ? dateFromISO(lastFinish)
        : null,
  };
}

export function useSimulator(initial?: ContractInput) {
  const [input, setInput] = useState<ContractInput>(
    () => initial ?? createInitialInput(),
  );

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simulatedInputKey, setSimulatedInputKey] =
    useState<string | null>(null);

  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogState>({
    templates: [],
    catalog: null,
    loading: true,
    error: null,
  });

  const [capacity, setCapacity] = useState<CapacityState>({
    data: null,
    loading: false,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);

  const cancelPendingRun = useCallback(() => {
    runIdRef.current += 1;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setSimulating(false);
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalog((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const response = await getCatalogoSimulador();

      const templates = catalogToTemplates(response).filter(
        (template) =>
          template.source === 'backend' &&
          template.backendDressId !== undefined &&
          template.backendRouteId !== undefined,
      );

      if (templates.length === 0) {
        throw new Error(
          'Django no devolvió rutas utilizables en el catálogo.',
        );
      }

      setCatalog({
        templates,
        catalog: response,
        loading: false,
        error: null,
      });
    } catch (error: unknown) {
      setCatalog({
        templates: [],
        catalog: null,
        loading: false,
        error: error instanceof Error
          ? error.message
          : 'No se pudo cargar el catálogo de Django.',
      });
    }
  }, []);

  const refreshCapacity = useCallback(
    async (desde?: string, hasta?: string) => {
      setCapacity((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const data = await getCapacidadProduccion(desde, hasta);

        setCapacity({ data, loading: false, error: null });
        return data;
      } catch (error: unknown) {
        const message = error instanceof Error
          ? error.message
          : 'No se pudo consultar la capacidad de Django.';

        setCapacity({ data: null, loading: false, error: message });
        throw new Error(message);
      }
    },
    [],
  );

  const fetchCapacityRange = useCallback(
    async (desde: string, hasta: string): Promise<CapacidadProduccion> => {
      const responses: CapacidadProduccion[] = [];
      let chunkStart = desde;

      while (chunkStart <= hasta) {
        const proposedEnd = addCalendarDays(
          chunkStart,
          API_MAX_DAYS - 1,
        );

        const chunkEnd = proposedEnd < hasta ? proposedEnd : hasta;

        responses.push(
          await getCapacidadProduccion(chunkStart, chunkEnd),
        );

        chunkStart = addCalendarDays(chunkEnd, 1);
      }

      const first = responses[0];

      if (!first) {
        throw new Error('No se recibió información de capacidad.');
      }

      const daysByDate = new Map<
        string,
        (typeof first.dias)[number]
      >();

      for (const response of responses) {
        for (const day of response.dias) {
          daysByDate.set(day.fecha, day);
        }
      }

      const merged = {
        ...first,
        desde,
        hasta,
        dias: [...daysByDate.values()].sort(
          (a, b) => a.fecha.localeCompare(b.fecha),
        ),
      } as CapacidadProduccion;

      setCapacity({ data: merged, loading: false, error: null });

      return merged;
    },
    [],
  );

  useEffect(() => {
    void refreshCatalog();

    return () => {
      runIdRef.current += 1;

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [refreshCatalog]);

  const templates = catalog.templates;

  const selectedTemplate = useMemo(
    () => resolveTemplate(templates, input),
    [templates, input],
  );

  const hours = useMemo(
    () => getHoursFromCatalog(catalog.catalog, selectedTemplate, input),
    [catalog.catalog, selectedTemplate, input],
  );

  const baseHours = useMemo(
    () => getHoursFromCatalog(
      catalog.catalog,
      selectedTemplate,
      { ...input, excluded: [] },
    ),
    [catalog.catalog, selectedTemplate, input],
  );

  const inputKey = JSON.stringify(input);

  const stale = result !== null && simulatedInputKey !== inputKey;

  const update = useCallback((patch: Partial<ContractInput>) => {
    setInput((current) => ({ ...current, ...patch }));
    setResult(null);
    setSimulatedInputKey(null);
    setSimulationError(null);
  }, []);

  const load = useCallback(
    (next: ContractInput) => {
      cancelPendingRun();
      setInput(next);
      setResult(null);
      setSimulatedInputKey(null);
      setSimulationError(null);
    },
    [cancelPendingRun],
  );

  const runMany = useCallback(
    (items: ContractInput[]) => {
      cancelPendingRun();

      setSimulationError(null);
      setResult(null);
      setSimulatedInputKey(null);

      if (catalog.loading) {
        setSimulationError('Espera a que termine de cargar el catálogo de Django.');
        return;
      }

      if (!catalog.catalog || catalog.error || templates.length === 0) {
        setSimulationError(
          catalog.error ?? 'No hay un catálogo válido disponible.',
        );
        return;
      }

      if (items.length === 0) {
        setSimulationError('Agrega al menos un vestido para simular.');
        return;
      }

      for (const item of items) {
        const error = validateInput(item);

        if (error) {
          setSimulationError(error);
          return;
        }
      }

      const resolved = items.map((item) => {
        const template = resolveTemplate(templates, item);

        return template ? { input: item, template } : null;
      });

      const missingIndex = resolved.findIndex((item) => item === null);

      if (missingIndex >= 0) {
        setSimulationError(
          `No se encontró la ruta de "${items[missingIndex].corteId}" ` +
          `para ${items[missingIndex].workshop}.`,
        );
        return;
      }

      const validItems = resolved.filter(
        (item): item is ResolvedItem => item !== null,
      );

      const keyAtStart = JSON.stringify(
        items.length === 1 ? items[0] : input,
      );

      const currentRunId = runIdRef.current;
      setSimulating(true);

      timerRef.current = setTimeout(async () => {
        try {
          const range = getCapacityRange(items);
          const capacityData = await fetchCapacityRange(
            range.desde,
            range.hasta,
          );

          if (runIdRef.current !== currentRunId) return;

          if (capacityData.dias.length === 0) {
            throw new Error(
              'Django no devolvió días de capacidad para el periodo.',
            );
          }

          const catalogData = catalog.catalog;

          if (!catalogData || catalogData.trabajadoras.length === 0) {
            throw new Error(
              'No hay trabajadoras registradas en el catálogo de Django.',
            );
          }

          const schedule = scheduleFromBackend(
            validItems,
            catalogData,
            capacityData,
            range.complete,
          );

          const simulation = buildSimulationResult(
            validItems,
            schedule,
            catalogData,
          );

          if (runIdRef.current !== currentRunId) return;

          setResult(simulation);
          setSimulatedInputKey(keyAtStart);
        } catch (error: unknown) {
          if (runIdRef.current !== currentRunId) return;

          console.error('Error al ejecutar la simulación:', error);

          setResult(null);
          setSimulatedInputKey(null);
          setSimulationError(
            error instanceof Error
              ? error.message
              : 'No se pudo consultar la capacidad de Django.',
          );
        } finally {
          if (runIdRef.current === currentRunId) {
            setSimulating(false);
            timerRef.current = null;
          }
        }
      }, 0);
    },
    [
      cancelPendingRun,
      catalog.loading,
      catalog.error,
      catalog.catalog,
      templates,
      fetchCapacityRange,
      input,
    ],
  );

  const run = useCallback(
    (override?: ContractInput) => {
      const target = override ?? input;

      if (override) setInput(override);

      runMany([target]);
    },
    [input, runMany],
  );

  return {
    input,
    update,
    setInput,
    hours,
    baseHours,
    result,
    simulating,
    stale,
    run,
    runMany,
    load,
    templates,

    catalogError: catalog.error,
    catalogLoaded: !catalog.loading && catalog.error === null,
    catalogLoading: catalog.loading,
    simulationError,
    refreshCatalog,
    selectedTemplate,

    catalogData: catalog.catalog,
    backendWorkers: catalog.catalog?.trabajadoras ?? [],
    backendDressTypes: catalog.catalog?.vestidos ?? [],

    capacityData: capacity.data,
    capacityLoading: capacity.loading,
    capacityError: capacity.error,
    refreshCapacity,

    // Las API actuales no proporcionan el número real de vestidos en cola.
    simulationIsDefinitive: false,
  };
}
