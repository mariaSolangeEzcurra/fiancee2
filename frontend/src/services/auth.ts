
const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'
).replace(/\/$/, '');

export type UserRole =
  | 'comercial'
  | 'jefa_taller'
  | 'taller'
  | 'gerencia';

export interface AuthUser {
  id: number;
  username: string;
  nombre: string;
  rol: UserRole;
}

interface LoginResponse {
  access: string;
  refresh: string;
  usuario: AuthUser;
}

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/auth/login/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.detail || 'Usuario o contraseña incorrectos.'
    );
  }

  if (
    !data?.access ||
    !data?.refresh ||
    !data?.usuario?.rol
  ) {
    throw new Error('La respuesta del servidor no es válida.');
  }

  return data as LoginResponse;
}

export function roleHome(rol: UserRole): string {
  const routes: Record<UserRole, string> = {
    comercial: '/fio',
    jefa_taller: '/taller',
    taller: '/trabajador',
    gerencia: '/gerencia',
  };

  return routes[rol];
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('fio_user');
    if (!raw) return null;

    const user = JSON.parse(raw) as AuthUser;

    const validRoles: UserRole[] = [
      'comercial',
      'jefa_taller',
      'taller',
      'gerencia',
    ];

    return validRoles.includes(user.rol) ? user : null;
  } catch {
    return null;
  }
}
