import { areas, processes } from '../data/processes';
import { AreaHours, AreaId, ProcessId } from '../types';

export const PROCESS_ORDER: ProcessId[] = processes.map((p) => p.id);
export const AREA_IDS: AreaId[] = areas.map((a) => a.id);

export function areaOf(p: ProcessId): AreaId | null {
  return processes.find((x) => x.id === p)?.area ?? null;
}

export function areaName(a: AreaId): string {
  return areas.find((x) => x.id === a)?.name ?? a;
}

export function processName(p: ProcessId): string {
  return processes.find((x) => x.id === p)?.name ?? p;
}

export function emptyAreas(): AreaHours {
  return { patronaje: 0, corte: 0, confeccion: 0, bordado: 0, encaje: 0, pruebas: 0, acabados: 0 };
}