import {
  BellIcon,
  CalendarClockIcon,
  ClockIcon,
  FileTextIcon,
  ReceiptIcon,
  SirenIcon,
  UserRoundCheckIcon,
  WalletIcon,
  WorkflowIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { NOTIFICATION_LABELS, timeAgo } from '../../services/notificationsApi';
import type { AppNotification, NotificationType } from '../../services/notificationsApi';
import { cn } from '../../utils/format';

const ICONS: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  ASIGNACION: { icon: UserRoundCheckIcon, tone: 'bg-emerald-50 text-emerald-700' },
  PROCESO: { icon: WorkflowIcon, tone: 'bg-emerald-50 text-emerald-700' },
  CONTRATO: { icon: FileTextIcon, tone: 'bg-sky-50 text-sky-700' },
  PAGO: { icon: WalletIcon, tone: 'bg-sky-50 text-sky-700' },
  COBRO: { icon: ReceiptIcon, tone: 'bg-champagne-soft text-cocoa' },
  RECORDATORIO: { icon: CalendarClockIcon, tone: 'bg-amber-50 text-amber-800' },
  ATRASO: { icon: SirenIcon, tone: 'bg-rose-50 text-rose-700' },
  JORNADA: { icon: ClockIcon, tone: 'bg-slate-100 text-slate-700' },
};

export function NotificationItem({
  n,
  onClick,
  compact = false,
}: {
  n: AppNotification;
  onClick?: () => void;
  compact?: boolean;
}) {
  const { icon: Icon, tone } = ICONS[n.type] ?? { icon: BellIcon, tone: 'bg-cream text-cocoa' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-cream/70',
        !n.read && 'bg-champagne-soft/40'
      )}
    >
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm text-cocoa', !n.read && 'font-semibold')}>{n.title}</span>
          <span className="shrink-0 text-[11px] text-cocoa-faint">{timeAgo(n.createdAt)}</span>
        </span>
        {n.message && (
          <span className={cn('mt-0.5 block text-xs text-cocoa-muted', compact && 'line-clamp-2')}>{n.message}</span>
        )}
        {!compact && (
          <span className="mt-1 inline-block rounded-full bg-cream px-1.5 py-0.5 text-[10px] font-medium text-cocoa-muted">
            {NOTIFICATION_LABELS[n.type] ?? n.type}
          </span>
        )}
      </span>
      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gold" aria-label="Nueva" />}
    </button>
  );
}
