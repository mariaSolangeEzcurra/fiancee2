import { useMemo, useState } from 'react';
import { CheckCheckIcon, RefreshCwIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { notificationTarget } from '../../components/notifications/NotificationBell';
import { NotificationItem } from '../../components/notifications/NotificationItem';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { useNotifications } from '../../contexts/NotificationsContext';
import type { AppNotification } from '../../services/notificationsApi';
import type { Role } from '../../types';
import { cn } from '../../utils/format';

type Filter = 'todas' | 'nuevas' | 'urgentes';

/** Todas las notificaciones del usuario (reemplaza la antigua página de Alertas). */
export function Notifications({ role }: { role: Role }) {
  const { items, unread, loading, reload, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState<Filter>('todas');
  const navigate = useNavigate();

  const list = useMemo(
    () =>
      items.filter((n) => {
        if (filter === 'nuevas') return !n.read;
        if (filter === 'urgentes') return n.type === 'ATRASO' || n.type === 'RECORDATORIO';
        return true;
      }),
    [items, filter]
  );

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86_400_000).toDateString();
    const out: { label: string; items: AppNotification[] }[] = [];
    for (const n of list) {
      const d = new Date(n.createdAt).toDateString();
      const label = d === today ? 'Hoy' : d === yesterday ? 'Ayer' : 'Antes';
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [list]);

  const open = (n: AppNotification) => {
    if (!n.read) void markRead(n.id);
    const target = notificationTarget(role, n);
    if (target) navigate(target);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notificaciones"
        subtitle={unread ? `Tienes ${unread} sin leer.` : 'Estás al día.'}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Segmented<Filter>
            ariaLabel="Filtrar notificaciones"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todas', label: 'Todas' },
              { value: 'nuevas', label: 'Sin leer' },
              { value: 'urgentes', label: 'Urgentes' },
            ]}
          />
        </div>
        <div className="ml-auto flex gap-2">
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-cocoa hover:bg-cream"
            >
              <CheckCheckIcon className="h-4 w-4" /> Marcar todas como leídas
            </button>
          )}
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-lg border border-line p-2 text-cocoa hover:bg-cream"
            aria-label="Actualizar"
          >
            <RefreshCwIcon className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-line bg-paper p-10 text-center text-sm text-cocoa-faint">
          {filter === 'todas' ? 'Todavía no tienes notificaciones.' : 'No hay notificaciones con este filtro.'}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cocoa-muted">{g.label}</h2>
              <div className="divide-y divide-line rounded-2xl border border-line bg-paper p-1.5">
                {g.items.map((n) => (
                  <NotificationItem key={n.id} n={n} onClick={() => open(n)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
