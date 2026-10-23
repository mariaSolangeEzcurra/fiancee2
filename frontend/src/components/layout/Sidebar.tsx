
import React, { useMemo } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeftRightIcon, LogOutIcon } from 'lucide-react';

import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { navigation } from '../../data/navigation';
import { roleProfiles } from '../../data/roles';
import type { Role } from '../../types';
import { buildAlerts } from '../../utils/alerts';
import { TODAY } from '../../utils/dates';
import { cn } from '../../utils/format';

interface SidebarProps {
  role: Role;
  onNavigate?: () => void;
}

export function Sidebar({ role, onNavigate }: SidebarProps) {
  const { dresses, workers } = useApp();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const profile = roleProfiles.find((r) => r.id === role);

  const criticalCount = useMemo(
    () =>
      buildAlerts(dresses, workers, TODAY).filter(
        (alert) => alert.severity === 'bad'
      ).length,
    [dresses, workers]
  );

  const handleLogout = () => {
    logout();
    onNavigate?.();
    navigate('/', { replace: true });
  };

  return (
    <div className="flex h-full flex-col px-4 py-6">
      {/* Marca */}
      <Link
        to="/"
        className="block px-3"
        onClick={onNavigate}
      >
        <span className="block font-display text-[2rem] font-semibold leading-none text-cocoa">
          Fiancée
        </span>
        <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.28em] text-gold">
          Alta Costura · Arequipa
        </span>
      </Link>

      {/* Navegación */}
      <nav
        aria-label="Menú principal"
        className="mt-9 flex-1 space-y-0.5"
      >
        {(navigation[role] ?? []).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                isActive
                  ? 'bg-paper font-medium text-cocoa shadow-sm ring-1 ring-line'
                  : 'text-cocoa-muted hover:bg-paper/70 hover:text-cocoa'
              )
            }
          >
            <item.icon
              className="h-4 w-4 shrink-0"
              aria-hidden="true"
            />

            <span className="flex-1 truncate">
              {item.label}
            </span>

            {item.label === 'Alertas' && criticalCount > 0 && (
              <span className="tabular rounded-full bg-bad px-1.5 py-0.5 text-[10px] font-semibold text-ivory">
                {criticalCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Perfil y acciones */}
      <div className="mt-6 border-t border-line pt-5">
        {profile && (
          <div className="flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-soft text-xs font-semibold text-blush-deep">
              {profile.initials}
            </span>

            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cocoa">
                {profile.person}
              </p>
              <p className="truncate text-xs text-cocoa-muted">
                {profile.label}
              </p>
            </div>
          </div>
        )}


        {/* Cerrar sesión */}
        <button
          type="button"
          onClick={handleLogout}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-cocoa-muted transition-colors duration-150 hover:bg-red-50 hover:text-red-700"
        >
          <LogOutIcon
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
