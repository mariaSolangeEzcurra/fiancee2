import { useEffect, useRef, useState } from 'react';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { useNotifications } from '../../contexts/NotificationsContext';
import type { AppNotification } from '../../services/notificationsApi';
import type { Role } from '../../types';
import { cn } from '../../utils/format';
import { NotificationItem } from './NotificationItem';

export const NOTIFICATIONS_PATH: Record<Role, string> = {
  fio: '/fio/notificaciones',
  jefa: '/taller/notificaciones',
  trabajador: '/trabajador/notificaciones',
  gerencia: '/gerencia/notificaciones',
};

/** A dónde lleva una notificación al hacerle clic. */
export function notificationTarget(role: Role, n: AppNotification): string | null {
  if (role === 'jefa' && n.dressId) return `/taller/vestidos?abrir=${n.dressId}`;
  if (role === 'gerencia') {
    if ((n.type === 'PAGO' || n.type === 'CONTRATO' || n.type === 'COBRO') && n.contractId) return `/gerencia/contratos?abrir=${n.contractId}`;
    if (n.dressId) return `/gerencia/produccion?abrir=${n.dressId}`;
  }
  if (role === 'fio') {
    const deContrato = n.type === 'PAGO' || n.type === 'CONTRATO' || n.type === 'COBRO';
    if (deContrato && n.contractId) return `/fio/contratos?abrir=${n.contractId}`;
    if (n.dressId) return `/fio/vestidos?abrir=${n.dressId}`;
    if (n.contractId) return `/fio/contratos?abrir=${n.contractId}`;
  }
  if (role === 'trabajador') return '/trabajador';
  return null;
}

export function NotificationBell({ role }: { role: Role }) {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (n: AppNotification) => {
    if (!n.read) void markRead(n.id);
    const target = notificationTarget(role, n);
    setOpen(false);
    if (target) navigate(target);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notificaciones, ${unread} nuevas` : 'Notificaciones'}
        aria-expanded={open}
        className="relative rounded-full border border-line bg-paper p-2 text-cocoa transition-colors duration-150 hover:bg-cream"
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="tabular absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-5 text-ivory">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-paper shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-display text-lg font-semibold text-cocoa">Notificaciones</p>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-cocoa-muted hover:text-cocoa"
                >
                  <CheckCheckIcon className="h-3.5 w-3.5" /> Marcar todas como leídas
                </button>
              )}
            </div>
            <div className="max-h-[26rem] overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-cocoa-faint">No tienes notificaciones por ahora.</p>
              ) : (
                items.slice(0, 8).map((n) => <NotificationItem key={n.id} n={n} compact onClick={() => go(n)} />)
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(NOTIFICATIONS_PATH[role]);
              }}
              className={cn('block w-full border-t border-line px-4 py-2.5 text-center text-sm font-medium text-cocoa hover:bg-cream')}
            >
              Ver todas
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
