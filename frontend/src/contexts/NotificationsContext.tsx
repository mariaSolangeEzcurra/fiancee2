import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { notificationsApi } from '../services/notificationsApi';
import type { AppNotification } from '../services/notificationsApi';

interface NotificationsValue {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  reload: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

const POLL_MS = 60_000;

/** Carga las notificaciones del usuario y las refresca cada minuto. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await notificationsApi.list();
      if (!alive.current) return;
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // Sin conexión: se intenta de nuevo en el siguiente ciclo.
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const t = window.setInterval(() => void reload(), POLL_MS);
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  const markRead = useCallback(async (id: number) => {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await notificationsApi.read(id);
    } catch {
      void reload();
    }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await notificationsApi.readAll();
    } catch {
      void reload();
    }
  }, [reload]);

  const value = useMemo(
    () => ({ items, unread, loading, reload, markRead, markAllRead }),
    [items, unread, loading, reload, markRead, markAllRead]
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

const EMPTY: NotificationsValue = {
  items: [],
  unread: 0,
  loading: false,
  reload: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
};

export function useNotifications(): NotificationsValue {
  return useContext(NotificationsContext) ?? EMPTY;
}
