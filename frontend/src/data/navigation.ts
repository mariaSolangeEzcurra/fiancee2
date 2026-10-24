import {
  CalendarRangeIcon,
  ChartColumnIcon,
  ClockIcon,
  FileTextIcon,
  GaugeIcon,
  HomeIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  LucideIcon,
  NotebookPenIcon,
  SettingsIcon,
  ShirtIcon,
  SparklesIcon,
  TimerIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
  WalletIcon } from
'lucide-react';
import { Role } from '../types';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  end?: boolean;
}

export const navigation: Record<Role, NavItem[]> = {
  fio: [
  { label: 'Inicio', path: '/fio', icon: HomeIcon, end: true },
  { label: 'Simulador de capacidad', path: '/fio/simulador', icon: SparklesIcon },
  { label: 'Contratos', path: '/fio/contratos', icon: FileTextIcon },
  { label: 'Finanzas', path: '/fio/finanzas', icon: WalletIcon },
  { label: 'Resumen', path: '/fio/resumen', icon: ChartColumnIcon },
  { label: 'Configuración', path: '/fio/configuracion', icon: SettingsIcon }],

  jefa: [
  { label: 'Inicio', path: '/taller', icon: HomeIcon, end: true },
  { label: 'Vestidos', path: '/taller/vestidos', icon: ShirtIcon },
  { label: 'Cola de producción', path: '/taller/cola', icon: ListOrderedIcon },
  { label: 'Capacidad', path: '/taller/capacidad', icon: CalendarRangeIcon },
  { label: 'Personal', path: '/taller/personal', icon: UsersIcon },
  { label: 'Alertas', path: '/taller/alertas', icon: TriangleAlertIcon },
  { label: 'Configuración', path: '/taller/configuracion', icon: SettingsIcon }],

  trabajador: [
  { label: 'Mi jornada', path: '/trabajador', icon: HomeIcon, end: true },
  { label: 'Mi horario', path: '/trabajador/horario', icon: CalendarRangeIcon, end: true },
  { label: 'Mis asistencias', path: '/trabajador/asistencias', icon: ClockIcon, end: true },
],

  gerencia: [
  { label: 'Dashboard', path: '/gerencia', icon: LayoutDashboardIcon, end: true },
  { label: 'Personal', path: '/gerencia/personal', icon: UsersIcon },
  { label: 'Horas', path: '/gerencia/horas', icon: ClockIcon },
  { label: 'Producción', path: '/gerencia/produccion', icon: ShirtIcon },
  { label: 'Capacidad', path: '/gerencia/capacidad', icon: GaugeIcon },
  { label: 'Finanzas', path: '/gerencia/finanzas', icon: WalletIcon },
  { label: 'KPI', path: '/gerencia/kpi', icon: TrendingUpIcon },
  { label: 'Configuración', path: '/gerencia/configuracion', icon: SettingsIcon }]

};