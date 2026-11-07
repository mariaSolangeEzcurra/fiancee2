import {
  CalendarRangeIcon,
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
  BellIcon,
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
  { label: 'Vestidos', path: '/fio/vestidos', icon: ShirtIcon },
  { label: 'Ingresos', path: '/fio/finanzas', icon: WalletIcon },
  { label: 'Notificaciones', path: '/fio/notificaciones', icon: BellIcon }],

  jefa: [
  { label: 'Inicio', path: '/taller', icon: HomeIcon, end: true },
  { label: 'Vestidos', path: '/taller/vestidos', icon: ShirtIcon },
  { label: 'Capacidad', path: '/taller/capacidad', icon: CalendarRangeIcon },
  { label: 'Personal', path: '/taller/personal', icon: UsersIcon },
  { label: 'Notificaciones', path: '/taller/notificaciones', icon: BellIcon }],

  trabajador: [
  { label: 'Mi jornada', path: '/trabajador', icon: HomeIcon, end: true },
  { label: 'Mi horario', path: '/trabajador/horario', icon: CalendarRangeIcon, end: true },
  { label: 'Mis asistencias', path: '/trabajador/asistencias', icon: ClockIcon, end: true },
  { label: 'Notificaciones', path: '/trabajador/notificaciones', icon: BellIcon, end: true },
],

  gerencia: [
  { label: 'Inicio', path: '/gerencia', icon: LayoutDashboardIcon, end: true },
  { label: 'Finanzas', path: '/gerencia/finanzas', icon: WalletIcon },
  { label: 'Contratos', path: '/gerencia/contratos', icon: FileTextIcon },
  { label: 'Producción', path: '/gerencia/produccion', icon: ShirtIcon },
  { label: 'Capacidad', path: '/gerencia/capacidad', icon: GaugeIcon },
  { label: 'Personal', path: '/gerencia/personal', icon: UsersIcon },
  { label: 'Horas', path: '/gerencia/horas', icon: ClockIcon },
  { label: 'Indicadores', path: '/gerencia/kpi', icon: TrendingUpIcon },
  { label: 'Notificaciones', path: '/gerencia/notificaciones', icon: BellIcon },
  { label: 'Configuración', path: '/gerencia/configuracion', icon: SettingsIcon }]

};