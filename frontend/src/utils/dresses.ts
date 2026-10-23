import { ContractInput, Dress, DressSeed, ProcessHours, ProcessStep, TimeTemplate, Tone, Worker } from '../types';
import { parseDate, workingDaysBetween } from './dates';
import { estimateHours, routeFromHours } from './estimate';
import { roundHalf } from './format';
import { areaOf } from './processes';

function buildSteps(hours: ProcessHours, currentIndex: number, progress: number, workers: Worker[], seedIndex: number, overrun = false): ProcessStep[] {
  const route = routeFromHours(hours);
  return route.map((process, i) => {
    const est = hours[process] ?? 0;
    const area = areaOf(process);
    const pool = area ? workers.filter((w) => (w.areas[area] ?? 0) > 0) : [];
    const worker = pool.length ? pool[(seedIndex + i) % pool.length] : undefined;
    const done = i < currentIndex;
    let worked = 0;
    if (done) worked = est;else
    if (i === currentIndex) worked = overrun ? roundHalf(est * 1.3) : roundHalf(est * progress);
    return { process, estHours: est, workedHours: worked, done, workerIds: worker && (done || i === currentIndex || i === currentIndex + 1) ? [worker.id] : [] };
  });
}

export function buildDress(seed: DressSeed, templates: TimeTemplate[], workers: Worker[], index: number): Dress {
  const hours = estimateHours(
    {
      corteId: seed.corteId,
      workshop: seed.workshop,
      type: seed.type,
      complexity: seed.complexity,
      collection: seed.collection,
      bordado: seed.bordado ?? 'Medio',
      encaje: seed.encaje ?? 'Medio',
      volume: seed.volume ?? 'Estándar',
      features: seed.features ?? [],
      excluded: []
    },
    templates
  );
  const route = routeFromHours(hours);
  const currentIndex = Math.max(0, route.indexOf(seed.current));
  return {
    id: seed.code,
    code: seed.code,
    client: seed.client,
    city: seed.city,
    type: seed.type,
    corteId: seed.corteId,
    collection: seed.collection,
    complexity: seed.complexity,
    workshop: seed.workshop,
    eventDate: seed.eventDate,
    deadline: seed.deadline,
    status: currentIndex === 0 && seed.progress === 0 ? 'En cola' : 'En producción',
    steps: buildSteps(hours, currentIndex, seed.progress, workers, index, seed.overrun),
    currentIndex,
    price: seed.price,
    paid: seed.paid,
    priority: seed.priority,
    notes: (seed.notes ?? []).map((n, i) => ({ ...n, id: `${seed.code}-n${i}` })),
    receivedFromC: seed.receivedFromC
  };
}

export function createDressFromContract(input: ContractInput, hours: ProcessHours, workers: Worker[], existing: Dress[], priority: Dress['priority']): Dress {
  const prefix = input.workshop === 'Taller C' ? 'VC' : input.type === 'Quinceañera' ? 'VQ' : 'VB';
  const max = existing.
  filter((d) => d.code.startsWith(prefix)).
  reduce((m, d) => Math.max(m, Number(d.code.split('-')[1]) || 0), 0);
  const code = `${prefix}-${String(max + 1).padStart(4, '0')}`;
  return {
    id: code,
    code,
    client: input.client || 'Nueva clienta',
    city: input.city,
    type: input.type,
    corteId: input.corteId,
    collection: input.collection,
    complexity: input.complexity,
    workshop: input.workshop,
    eventDate: input.eventDate,
    deadline: input.deliveryDate,
    status: 'En cola',
    steps: buildSteps(hours, 0, 0, workers, existing.length).map((s) => ({ ...s, workerIds: [] })),
    currentIndex: 0,
    price: input.price,
    paid: Math.round(input.price * 0.5),
    priority,
    notes: [],
    receivedFromC: input.workshop === 'Taller C' ? ['Falda confeccionada', 'Base confeccionada'] : undefined,
    isNew: true
  };
}

export function dressTotals(d: Dress) {
  const productive = d.steps.filter((s) => s.process !== 'entrega');
  const est = productive.reduce((s, x) => s + x.estHours, 0);
  const worked = productive.reduce((s, x) => s + x.workedHours, 0);
  const remaining = productive.reduce((s, x) => s + (x.done ? 0 : Math.max(0, x.estHours - x.workedHours)), 0);
  const progress = est > 0 ? Math.min(1, (est - remaining) / est) : 0;
  return { est, worked, remaining, progress };
}

export function currentStep(d: Dress): ProcessStep | undefined {
  return d.steps[d.currentIndex];
}

export function dressRisk(d: Dress, today: Date): {tone: Tone;slack: number;label: string;} {
  if (d.status === 'Terminado') return { tone: 'ok', slack: 99, label: 'Terminado' };
  const days = workingDaysBetween(today, parseDate(d.deadline));
  const pending = d.steps.filter((s) => !s.done && s.process !== 'entrega');
  const needed =
  pending.reduce((s, x) => {
    const rem = Math.max(0, x.estHours - x.workedHours);
    return s + (rem > 0 ? Math.ceil(rem / 8) : 0);
  }, 0) + Math.max(0, pending.filter((s) => areaOf(s.process) === 'pruebas').length - 1) * 3;
  const slack = days - needed;
  if (days < 0) return { tone: 'bad', slack, label: 'Atrasado' };
  if (slack < 0) return { tone: 'bad', slack, label: 'Retraso probable' };
  if (slack < 4) return { tone: 'risk', slack, label: 'Ajustado' };
  return { tone: 'ok', slack, label: 'En tiempo' };
}