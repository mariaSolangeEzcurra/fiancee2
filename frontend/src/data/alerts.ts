import { SystemAlert } from '../types';

export const staticAlerts: SystemAlert[] = [
{
  id: 'mat-0270',
  severity: 'risk',
  category: 'Materiales',
  title: 'Material pendiente de confirmación · VB-0270',
  why: 'El proveedor de Lima no confirma el despacho del encaje chantilly importado.',
  impact: 'El encaje de VB-0270 (≈18 h) no puede iniciar; si no llega antes del 20/10 se desplaza a noviembre.',
  dressCode: 'VB-0270'
},
{
  id: 'carp-0279',
  severity: 'risk',
  category: 'Producción',
  title: 'Carpeta pendiente de designación · VB-0279',
  why: 'No se asignó modista responsable ni ficha de medidas final.',
  impact: 'El corte no puede comenzar y la prueba 1 programada para el 20/10 queda en riesgo.',
  dressCode: 'VB-0279'
}];