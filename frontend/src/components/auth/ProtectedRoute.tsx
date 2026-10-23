
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { roleHome, type UserRole } from '../../services/auth';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

export function ProtectedRoute({
  allowedRoles,
  children,
}: ProtectedRouteProps) {
  const { user, accessToken } = useAuth();

  if (!user || !accessToken) {
    return <Navigate to="/" replace />;
  }

  if (!allowedRoles.includes(user.rol)) {
    return <Navigate to={roleHome(user.rol)} replace />;
  }

  return <>{children}</>;
}
