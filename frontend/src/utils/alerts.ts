import { staticAlerts } from '../data/alerts';
import { Dress, SystemAlert, Worker } from '../types';
import { periodLoad } from './capacity';
import { fmtShort, parseDate, workingDaysBetween } from './dates';
import { currentStep, dressRisk, dressTotals } from './dresses';
import { fmtH, fmtPct } from './format';
import { areaName, processName } from './processes';

export function buildAlerts(dresses: Dress[], workers: Worker[], today: Date): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  const week = periodLoad(dresses, workers, today, 0, 6);

  week.forEach((l) => {
    if (l.utilization >= 1) {
      alerts.push({
        id: `cap-${l.area}`,
        severity: 'bad',
        category: 'Capacidad',
        title: `Capacidad insuficiente en ${areaName(l.area).toLowerCase()}`,
        why: `Esta semana hay ${fmtH(l.committed)} comprometidas y solo ${fmtH(l.capacity)} de capacidad (${fmtPct(l.utilization)}).`,
        impact: `${areaName(l.area)} es el cuello de botella: los vestidos que dependen de este proceso se desplazan y no conviene aceptar contratos que lo necesiten en los próximos días.`
      });
    } else if (l.utilization >= 0.85) {
      alerts.push({
        id: `cap-${l.area}`,
        severity: 'risk',
        category: 'Capacidad',
        title: `${areaName(l.area)} está al ${fmtPct(l.utilization)} de utilización`,
        why: `Quedan ${fmtH(l.available)} libres esta semana.`,
        impact: 'Cualquier incidencia o contrato nuevo en este proceso genera retraso.'
      });
    }
  });

  dresses.forEach((d) => {
    if (d.status === 'Terminado') return;
    const risk = dressRisk(d, today);
    const totals = dressTotals(d);
    const days = workingDaysBetween(today, parseDate(d.deadline));
    if (risk.tone === 'bad') {
      alerts.push({
        id: `late-${d.id}`,
        severity: 'bad',
        category: 'Producción',
        title: `Fecha de entrega de ${d.code} no es compatible con la capacidad actual`,
        why: `Faltan ${fmtH(totals.remaining)} en ${d.steps.filter((s) => !s.done && s.process !== 'entrega').length} procesos y quedan ${Math.max(0, days)} días hábiles hasta el ${fmtShort(d.deadline)}.`,
        impact: `Riesgo de retraso para ${d.client}. Reasignar personal o renegociar la fecha.`,
        dressCode: d.code
      });
    } else if (risk.tone === 'risk' && days <= 10) {
      alerts.push({
        id: `risk-${d.id}`,
        severity: 'risk',
        category: 'Producción',
        title: `${d.code} tiene riesgo de retraso`,
        why: `Margen de ${risk.slack} ${risk.slack === 1 ? 'día' : 'días'} hábiles entre lo que falta y la fecha límite (${fmtShort(d.deadline)}).`,
        impact: 'Una prueba reprogramada o un ajuste adicional consumiría todo el margen.',
        dressCode: d.code
      });
    }
    const step = currentStep(d);
    if (step && step.workedHours > step.estHours && step.estHours > 0) {
      alerts.push({
        id: `over-${d.id}`,
        severity: 'risk',
        category: 'Producción',
        title: `${processName(step.process)} de ${d.code} lleva más horas de las estimadas`,
        why: `Se registraron ${fmtH(step.workedHours)} frente a ${fmtH(step.estHours)} estimadas.`,
        impact: `Se consumen ${fmtH(step.workedHours - step.estHours)} extra de ${areaName('confeccion').toLowerCase()} que no estaban planificadas.`,
        dressCode: d.code
      });
    }
  });

  workers.forEach((w) => {
    const gap = workingDaysBetween(parseDate(w.lastLog), today);
    if (gap >= 2) {
      alerts.push({
        id: `log-${w.id}`,
        severity: 'risk',
        category: 'Personal',
        title: `${w.name} no ha registrado horas`,
        why: `Su último registro es del ${fmtShort(w.lastLog)} (${gap} días hábiles sin registros).`,
        impact: 'Las horas reales y el avance de sus vestidos no se actualizan; la capacidad mostrada puede ser optimista.'
      });
    }
  });

  return [...alerts, ...staticAlerts].sort((a, b) => a.severity === b.severity ? 0 : a.severity === 'bad' ? -1 : 1);
}