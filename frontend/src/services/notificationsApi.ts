/**
 * Notificaciones de cada usuario (todos los roles).
 * Backend: /api/core/notificaciones/
 */
import { apiRequest } from './contractsApi';

const BASE = '/api/core/notificaciones/';

export type NotificationType =
  | 'ASIGNACION'
  | 'PROCESO'
  | 'CONTRATO'
  | 'PAGO'
  | 'COBRO'
  | 'RECORDATORIO'
  | 'ATRASO'
  | 'JORNADA';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  dressId: string | null;
  contractId: number | null;
}

export const notificationsApi = {
  list: () => apiRequest<{ unread: number; items: AppNotification[] }>(BASE),
  read: (id: number) => apiRequest<AppNotification>(`${BASE}${id}/leer/`, { method: 'POST' }),
  readAll: () => apiRequest<{ detail: string }>(`${BASE}leer-todas/`, { method: 'POST' }),
};

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  ASIGNACION: 'Asignación',
  PROCESO: 'Proceso',
  CONTRATO: 'Contrato',
  PAGO: 'Pago',
  COBRO: 'Cobro extra',
  RECORDATORIO: 'Recordatorio',
  ATRASO: 'Atraso',
  JORNADA: 'Jornada',
};

/** "hace 5 min", "ayer"… */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'ahorita';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}
