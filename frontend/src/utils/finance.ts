import { AreaId, Dress, FinanceSettings, IncomeItem, TimeTemplate, Worker } from '../types';
import { periodLoad } from './capacity';
import { estimateHours, totalHours } from './estimate';
import { areaOf, AREA_IDS, emptyAreas } from './processes';

export function computeFinance(settings: FinanceSettings, income: IncomeItem[]) {
  const fixed = settings.personal + settings.servicios + settings.alquiler;
  const revenue = income.reduce((s, i) => s + i.amount, 0);
  const materials = revenue * settings.materialsRate;
  const costs = fixed + materials;
  const contribution = revenue - materials;
  const profit = revenue - costs;
  const margin = revenue > 0 ? profit / revenue : 0;
  const breakEven = fixed / (1 - settings.materialsRate);
  const gap = Math.max(0, settings.monthlyGoal - revenue);
  const goalProgress = settings.monthlyGoal > 0 ? revenue / settings.monthlyGoal : 0;
  const targetProfit = settings.monthlyGoal * settings.targetMargin;
  return { fixed, revenue, materials, costs, contribution, profit, margin, breakEven, gap, goalProgress, targetProfit };
}

/** Converts free productive capacity into how many reference dresses (and soles) the workshop can still absorb. */
export function revenueCapacity(dresses: Dress[], workers: Worker[], templates: TimeTemplate[], today: Date, gap: number, horizonDays = 26) {
  const refHours = estimateHours(
    { corteId: 'princesa', workshop: 'Taller A', type: 'Novia', complexity: 'Media', collection: 'Essenza', bordado: 'Medio', encaje: 'Medio', volume: 'Estándar', features: [], excluded: [] },
    templates
  );
  const refArea = emptyAreas();
  (Object.keys(refHours) as (keyof typeof refHours)[]).forEach((p) => {
    const a = areaOf(p);
    if (a) refArea[a] += refHours[p] ?? 0;
  });
  const loads = periodLoad(dresses, workers, today, 0, horizonDays);
  const active = dresses.filter((d) => d.status !== 'Terminado');
  const avgTicket = active.reduce((s, d) => s + d.price, 0) / Math.max(1, active.length);

  let possible = Infinity;
  let limiting: AreaId = 'pruebas';
  AREA_IDS.forEach((a) => {
    if (refArea[a] <= 0) return;
    const load = loads.find((l) => l.area === a);
    const n = (load?.available ?? 0) / refArea[a];
    if (n < possible) {
      possible = n;
      limiting = a;
    }
  });
  const refTotal = totalHours(refHours);
  const neededDresses = gap / avgTicket;
  return {
    avgTicket,
    refTotal,
    possible: Math.max(0, possible),
    limiting,
    neededDresses,
    neededHours: neededDresses * refTotal,
    potentialRevenue: Math.max(0, possible) * avgTicket,
    freeHours: loads.reduce((s, l) => s + l.available, 0),
    horizonDays
  };
}