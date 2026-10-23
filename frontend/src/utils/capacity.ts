
import type {
  AreaHours,
  AreaId,
  AreaLoad,
  AreaNeed,
  ContractInput,
  Dress,
  ProcessHours,
  ProcessId,
  SimulationResult,
  Tone,
  Worker,
} from '../types';

import {
  addWorkingDays,
  fmtDate,
  parseDate,
  workingDaysBetween,
} from './dates';

import { routeFromHours } from './estimate';
import { fmtH, fmtPct, round1 } from './format';

import {
  AREA_IDS,
  areaName,
  areaOf,
  emptyAreas,
  processName,
} from './processes';

interface Prepared {
  rem: AreaHours;
  due: number;
  deadline: Date;
  total: number;
}

const MAX_SEARCH_DAYS = 260;
const WORKING_DAYS_PER_WEEK = 6;
const DEFAULT_HOURS_PER_DAY = 8;
const HOURS_EPSILON = 0.0001;

function safeHours(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function safeDate(date: Date): Date {
  return Number.isNaN(date.getTime())
    ? new Date()
    : new Date(date.getTime());
}

function safeWorkingDaysBetween(from: Date, to: Date): number {
  const result = workingDaysBetween(from, to);

  return Number.isFinite(result) ? result : 0;
}

function sumAreas(areas: AreaHours): number {
  return AREA_IDS.reduce(
    (sum, area) => sum + safeHours(areas[area]),
    0
  );
}

/** Capacidad semanal calculada a partir de las horas de cada trabajadora. */
export function weeklyCapacity(workers: Worker[]): AreaHours {
  const result = emptyAreas();

  for (const worker of workers) {
    for (const area of AREA_IDS) {
      result[area] += safeHours(worker.areas[area]);
    }
  }

  return result;
}

/** Horas pendientes por área para un vestido que no está terminado. */
export function remainingByArea(dress: Dress): AreaHours {
  const result = emptyAreas();

  if (dress.status === 'Terminado') {
    return result;
  }

  for (const step of dress.steps) {
    if (step.done) continue;

    const area = areaOf(step.process);

    if (!area) continue;

    const estimated = safeHours(step.estHours);
    const worked = safeHours(step.workedHours);

    result[area] += Math.max(0, estimated - worked);
  }

  return result;
}

/** Prepara la carga pendiente de los vestidos existentes. */
function prepare(dresses: Dress[], today: Date): Prepared[] {
  return dresses
    .filter((dress) => dress.status !== 'Terminado')
    .map((dress) => {
      const rem = remainingByArea(dress);
      const deadline = safeDate(parseDate(dress.deadline));
      const due = Math.max(
        1,
        safeWorkingDaysBetween(today, deadline)
      );

      return {
        rem,
        deadline,
        due,
        total: sumAreas(rem),
      };
    });
}

/**
 * Distribución estimada de la carga pendiente a lo largo del plazo.
 * Es una aproximación y no representa reservas diarias reales.
 */
function committed(
  prep: Prepared[],
  area: AreaId,
  day: number
): number {
  if (day <= 0) return 0;

  return prep.reduce((total, item) => {
    const remaining = safeHours(item.rem[area]);

    if (remaining <= 0) return total;

    const progress = Math.min(
      1,
      Math.max(0, day / item.due)
    );

    return total + remaining * progress;
  }, 0);
}

/** Carga y disponibilidad estimada por área durante un periodo hábil. */
export function periodLoad(
  dresses: Dress[],
  workers: Worker[],
  today: Date,
  fromDay: number,
  toDay: number
): AreaLoad[] {
  const capacityByWeek = weeklyCapacity(workers);
  const prep = prepare(dresses, today);

  const startDay = Math.max(0, fromDay);
  const endDay = Math.max(startDay, toDay);
  const periodDays = endDay - startDay;

  return AREA_IDS.map((area) => {
    const capacity = Math.max(
      0,
      (capacityByWeek[area] / WORKING_DAYS_PER_WEEK) *
        periodDays
    );

    const committedHours = Math.max(
      0,
      committed(prep, area, endDay) -
        committed(prep, area, startDay)
    );

    const available = Math.max(
      0,
      capacity - committedHours
    );

    return {
      area,
      capacity: round1(capacity),
      committed: round1(committedHours),
      available: round1(available),
      utilization:
        capacity > HOURS_EPSILON
          ? Math.min(1, committedHours / capacity)
          : committedHours > 0
            ? 1
            : 0,
    };
  });
}

/** Identifica el área con mayor utilización de capacidad. */
export function bottleneck(loads: AreaLoad[]): AreaLoad {
  if (loads.length === 0) {
    throw new Error(
      'No hay áreas disponibles para calcular el cuello de botella.'
    );
  }

  return [...loads].sort(
    (a, b) => b.utilization - a.utilization
  )[0];
}

/**
 * Simulación auxiliar basada en estimaciones.
 *
 * Para la planificación real del simulador, usa los datos de Django
 * desde useSimulator.ts. Esta función no consulta las API y no debe
 * interpretarse como una reserva real de capacidad.
 *
 * Las esperas de materiales y procesos se expresan en horas calendario
 * y no consumen horas de trabajadoras.
 */
export function simulate(
  input: ContractInput,
  hours: ProcessHours,
  dresses: Dress[],
  workers: Worker[],
  today: Date,
  waitingHours = 0,
  processOrder?: ProcessId[],
  waitingByProcess?: Partial<Record<ProcessId, number>>
): SimulationResult {
  const safeToday = safeDate(today);
  const prep = prepare(dresses, safeToday);
  const capacityByWeek = weeklyCapacity(workers);

  const daily = (area: AreaId) =>
    Math.max(
      0,
      capacityByWeek[area] / WORKING_DAYS_PER_WEEK
    );

  const delivery = safeDate(parseDate(input.deliveryDate));
  const event = safeDate(parseDate(input.eventDate));

  const deliveryDays = Math.max(
    0,
    safeWorkingDaysBetween(safeToday, delivery)
  );

  const materialWait = safeHours(waitingHours);

  const processWait = Object.values(
    waitingByProcess ?? {}
  ).reduce(
    (total, value) => total + safeHours(value),
    0
  );

  const byProcess = routeFromHours(hours, processOrder)
    .filter((process) => process !== 'entrega')
    .map((process) => ({
      process,
      hours: safeHours(hours[process]),
      area: areaOf(process),
    }));

  const needArea = emptyAreas();

  for (const process of byProcess) {
    if (process.area) {
      needArea[process.area] += process.hours;
    }
  }

  const used = AREA_IDS.filter(
    (area) => needArea[area] > 0
  );

  const feasibleDay = (
    area: AreaId,
    neededHours: number,
    fromDay = 0
  ): number => {
    const startDay = Math.max(0, fromDay);

    if (neededHours <= HOURS_EPSILON) {
      return startDay;
    }

    const dailyCapacity = daily(area);

    if (dailyCapacity <= HOURS_EPSILON) {
      return MAX_SEARCH_DAYS;
    }

    for (
      let day = startDay + 1;
      day <= MAX_SEARCH_DAYS;
      day++
    ) {
      const capacity =
        dailyCapacity * (day - startDay);

      const existingLoad = Math.max(
        0,
        committed(prep, area, day) -
          committed(prep, area, startDay)
      );

      if (
        capacity - existingLoad + HOURS_EPSILON >=
        neededHours
      ) {
        return day;
      }
    }

    return MAX_SEARCH_DAYS;
  };

  const first = byProcess[0];
  const firstArea: AreaId = first?.area ?? 'patronaje';

  const firstReady = first
    ? feasibleDay(firstArea, first.hours)
    : 0;

  const queueStartDay = first
    ? Math.max(
        0,
        firstReady -
          Math.ceil(first.hours / DEFAULT_HOURS_PER_DAY)
      )
    : 0;

  const queueStartDate = addWorkingDays(
    safeToday,
    queueStartDay
  );

  /*
   * La espera de materiales se convierte a tiempo calendario.
   * No se convierte directamente a horas de capacidad laboral.
   */
  const materialsReadyDate = new Date(
    queueStartDate.getTime() +
      materialWait * 60 * 60 * 1000
  );

  const materialReadyDay = Math.max(
    queueStartDay,
    safeWorkingDaysBetween(safeToday, materialsReadyDate)
  );

  const productionStartDay = Math.max(
    queueStartDay,
    materialReadyDay
  );

  const areas: AreaNeed[] = used.map((area) => {
    const periodDays = Math.max(
      0,
      deliveryDays - productionStartDay
    );

    const capacity = daily(area) * periodDays;

    const committedHours = Math.max(
      0,
      committed(prep, area, deliveryDays) -
        committed(prep, area, productionStartDay)
    );

    const available = Math.max(
      0,
      capacity - committedHours
    );

    const needed = needArea[area];
    const margin = available - needed;

    const utilizationAfter =
      capacity > HOURS_EPSILON
        ? (committedHours + needed) / capacity
        : needed > 0
          ? Number.POSITIVE_INFINITY
          : 0;

    const tone: Tone =
      available + HOURS_EPSILON < needed
        ? 'bad'
        : margin < Math.max(4, needed * 0.25) ||
            utilizationAfter >= 0.9
          ? 'risk'
          : 'ok';

    const pool = workers.filter(
      (worker) => safeHours(worker.areas[area]) > 0
    );

    const staffNeeded =
      needed > 0
        ? Math.min(
            pool.length,
            Math.max(
              1,
              Math.ceil(
                needed / (3 * DEFAULT_HOURS_PER_DAY)
              )
            )
          )
        : 0;

    return {
      area,
      capacity: round1(capacity),
      committed: round1(committedHours),
      available: round1(available),
      utilization:
        capacity > HOURS_EPSILON
          ? Math.min(1, committedHours / capacity)
          : committedHours > 0
            ? 1
            : 0,
      needed: round1(needed),
      margin: round1(margin),
      utilAfter: utilizationAfter,
      readyDay: feasibleDay(
        area,
        needed,
        productionStartDay
      ),
      tone,
      staff: pool.map((worker) => worker.name),
      staffNeeded,
    };
  });

  const total = byProcess.reduce(
    (sum, process) => sum + process.hours,
    0
  );

  const fittings = byProcess.filter(
    (process) => process.area === 'pruebas'
  ).length;

  const minLead =
    byProcess.reduce(
      (sum, process) =>
        sum +
        Math.max(
          1,
          Math.ceil(
            process.hours / DEFAULT_HOURS_PER_DAY
          )
        ),
      0
    ) +
    Math.max(0, fittings - 1) * 3;

  const capacityReadyDay = areas.length
    ? Math.max(...areas.map((area) => area.readyDay))
    : productionStartDay;

  const finishDay =
    Math.max(
      capacityReadyDay,
      productionStartDay + minLead
    ) + 1;

  const baseFinishDate = addWorkingDays(
    safeToday,
    finishDay
  );

  const finishDate = new Date(
    baseFinishDate.getTime() +
      processWait * 60 * 60 * 1000
  );

  const actualFinishDay = Math.max(
    0,
    safeWorkingDaysBetween(safeToday, finishDate)
  );

  const marginDays = deliveryDays - actualFinishDay;

  const availableHours = areas.reduce(
    (sum, area) => sum + area.available,
    0
  );

  const critical = areas.length
    ? [...areas].sort(
        (a, b) =>
          a.margin - b.margin
      )[0]
    : null;

  const ahead = prep.filter(
    (item) =>
      item.deadline <= delivery &&
      item.total > 0
  );

  const queue = {
    dressesAhead: ahead.length,
    hoursAhead: round1(
      ahead.reduce((sum, item) => sum + item.total, 0)
    ),
    delayDays: queueStartDay,
  };

  const twoWeeks = periodLoad(
    dresses,
    workers,
    safeToday,
    0,
    12
  );

  const totalTwoWeekCapacity = twoWeeks.reduce(
    (sum, load) => sum + load.capacity,
    0
  );

  const currentLoad =
    totalTwoWeekCapacity > HOURS_EPSILON
      ? twoWeeks.reduce(
          (sum, load) => sum + load.committed,
          0
        ) / totalTwoWeekCapacity
      : 0;

  const noCapacity = areas.some(
    (area) =>
      area.capacity <= HOURS_EPSILON &&
      area.needed > 0
  );

  const anyBad =
    noCapacity ||
    areas.some((area) => area.tone === 'bad') ||
    finishDate > delivery;

  const anyRisk =
    areas.some((area) => area.tone === 'risk') ||
    marginDays < 5;

  const status: SimulationResult['status'] =
    anyBad
      ? 'bad'
      : anyRisk
        ? 'risk'
        : 'ok';

  const reasons: string[] = [];

  if (status === 'bad') {
    for (const area of areas) {
      if (area.tone === 'bad') {
        reasons.push(
          `${areaName(area.area)} requiere ${fmtH(
            area.needed
          )} y solo tiene ${fmtH(
            area.available
          )} disponibles hasta el ${fmtDate(delivery)}.`
        );
      }

      if (
        area.capacity <= HOURS_EPSILON &&
        area.needed > 0
      ) {
        reasons.push(
          `${areaName(area.area)} no tiene capacidad disponible ` +
          'configurada en el periodo solicitado.'
        );
      }
    }

    const loaded = [...areas].sort(
      (a, b) => b.utilization - a.utilization
    )[0];

    if (loaded) {
      reasons.push(
        `${areaName(loaded.area)} tiene ${fmtH(
          loaded.committed
        )} horas comprometidas en el periodo (${fmtPct(
          loaded.utilization
        )} de su capacidad).`
      );
    }

    if (queueStartDay >= 2) {
      reasons.push(
        `La cola actual genera aproximadamente ${queueStartDay} ` +
        `días hábiles de espera antes de iniciar ${
          first
            ? processName(first.process).toLowerCase()
            : 'la producción'
        }.`
      );
    }

    if (materialWait > 0) {
      reasons.push(
        `La compra de materiales añade ${round1(
          materialWait / 24
        )} días calendario de espera.`
      );
    }

    if (processWait > 0) {
      reasons.push(
        `Las esperas posteriores añaden ${round1(
          processWait / 24
        )} días calendario al plazo estimado.`
      );
    }

    if (finishDate > delivery) {
      reasons.push(
        `La fecha estimada de finalización (${fmtDate(
          finishDate
        )}) supera la entrega solicitada (${fmtDate(
          delivery
        )}).`
      );
    }

    if (needArea.pruebas > 0 && deliveryDays > 0) {
      const daysToCheck = Math.min(6, deliveryDays);

      const lastPeriod = Math.max(
        0,
        committed(prep, 'pruebas', deliveryDays) -
          committed(
            prep,
            'pruebas',
            deliveryDays - daysToCheck
          )
      );

      const fittingCapacity =
        daily('pruebas') * daysToCheck;

      if (
        fittingCapacity > 0 &&
        lastPeriod >= fittingCapacity * 0.9
      ) {
        reasons.push(
          'Pruebas tiene una carga pendiente elevada durante la semana requerida.'
        );
      }
    }
  } else if (status === 'risk') {
    for (const area of areas) {
      if (
        area.margin <
        Math.max(4, area.needed * 0.25)
      ) {
        reasons.push(
          `${areaName(area.area)} tiene ${fmtH(
            area.available
          )} disponibles y el vestido necesita ${fmtH(
            area.needed
          )}.`
        );
      } else if (area.utilAfter >= 0.9) {
        reasons.push(
          `La capacidad de ${areaName(
            area.area
          )} quedará al ${fmtPct(
            area.utilAfter
          )}, próxima al límite.`
        );
      }
    }

    if (marginDays < 5) {
      reasons.push(
        `El margen de seguridad es de ${marginDays} ` +
        `${marginDays === 1 ? 'día hábil' : 'días hábiles'}.`
      );
    }

    if (processWait > 0) {
      reasons.push(
        `El plazo contempla ${round1(
          processWait / 24
        )} días calendario de espera en etapas posteriores.`
      );
    }
  }

  return {
    status,
    totalHours: round1(total),
    byProcess: byProcess.map((process) => ({
      ...process,
      hours: round1(process.hours),
    })),
    areas,
    start: addWorkingDays(
      safeToday,
      Math.max(1, productionStartDay)
    ),
    finish: finishDate,
    delivery,
    event,
    deliveryDays,
    marginDays,
    availableHours: round1(availableHours),
    marginHours: round1(availableHours - total),
    critical,
    queue,
    currentLoad,
    staffNeeded: areas.reduce(
      (sum, area) => sum + area.staffNeeded,
      0
    ),
    minLead,
    reasons,
    alternativeDate:
      status === 'bad'
        ? addWorkingDays(safeToday, actualFinishDay + 3)
        : null,
  };
}
