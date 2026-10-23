import { FinanceSettings, IncomeItem, MonthRecord, PendingExpense } from '../types';

export const financeDefaults: FinanceSettings = {
  personal: 22000,
  servicios: 2000,
  alquiler: 2500,
  monthlyGoal: 40000,
  targetMargin: 0.35,
  materialsRate: 0.22
};

export const incomeItems: IncomeItem[] = [
{ id: 'i1', concept: 'Adelanto VB-0276 · Karen Delgado', date: '2026-09-03', amount: 2500 },
{ id: 'i2', concept: 'Saldo VB-0268 · Fiorella Gutiérrez', date: '2026-09-05', amount: 3200 },
{ id: 'i3', concept: 'Adelanto VQ-0148 · Luciana Cornejo', date: '2026-09-08', amount: 2000 },
{ id: 'i4', concept: 'Saldo VB-0271 · Ximena Paredes', date: '2026-09-10', amount: 2600 },
{ id: 'i5', concept: 'Adelanto VB-0282 · Pamela Ortiz', date: '2026-09-12', amount: 2200 },
{ id: 'i6', concept: 'Arreglos y ajustes externos', date: '2026-09-15', amount: 1300 },
{ id: 'i7', concept: 'Adelanto VB-0278 · Lorena Bustamante', date: '2026-09-17', amount: 4000 },
{ id: 'i8', concept: 'Saldo VQ-0147 · Mariana Linares', date: '2026-09-19', amount: 2700 },
{ id: 'i9', concept: 'Saldo VB-0266 · Andrea Salas', date: '2026-09-22', amount: 2400 },
{ id: 'i10', concept: 'Adelanto VB-0284 · Diana Loayza', date: '2026-09-23', amount: 2500 },
{ id: 'i11', concept: 'Cuota VB-0270 · Daniela Rivera', date: '2026-09-25', amount: 3100 }];


export const pendingExpenses: PendingExpense[] = [
{ id: 'p1', concept: 'Planilla 2.ª quincena', due: '2026-09-30', amount: 11000 },
{ id: 'p2', concept: 'Alquiler de octubre', due: '2026-10-01', amount: 2500 },
{ id: 'p3', concept: 'Proveedor de encajes · Lima', due: '2026-10-03', amount: 1850 }];


export const monthlyHistory: MonthRecord[] = [
{ month: 'Abr', income: 36800, costs: 33900, finished: 8 },
{ month: 'May', income: 41200, costs: 35600, finished: 9 },
{ month: 'Jun', income: 38900, costs: 34800, finished: 8 },
{ month: 'Jul', income: 44500, costs: 37100, finished: 10 },
{ month: 'Ago', income: 39600, costs: 34900, finished: 8 },
{ month: 'Sep', income: 28500, costs: 32770, finished: 5 }];