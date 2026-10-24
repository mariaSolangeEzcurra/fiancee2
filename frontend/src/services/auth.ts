
const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

const AUTH_URL = `${API_URL}/api/auth`;

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

interface RefreshResponse {
  access: string;
  refresh?: string;
}

async function readResponse(response: Response) {
  return response.json().catch(() => null);
}

function getErrorMessage(data: any, fallback: string): string {
  if (typeof data?.detail === 'string') {
    return data.detail;
  }

  if (Array.isArray(data?.non_field_errors)) {
    return data.non_field_errors.join(' ');
  }

  if (typeof data?.username?.[0] === 'string') {
    return data.username[0];
  }

  if (typeof data?.password?.[0] === 'string') {
    return data.password[0];
  }

  return fallback;
}

/**
 * Iniciar sesión.
 * URL: POST /api/auth/login/
 */
export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${AUTH_URL}/login/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  });

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(data, 'No se pudo iniciar sesión.')
    );
  }

  if (!data?.access || !data?.refresh) {
    throw new Error(
      'El servidor no devolvió los tokens de autenticación esperados.'
    );
  }

  if (!data?.usuario || !data.usuario.rol) {
    throw new Error(
      'Los tokens se recibieron, pero falta la información del usuario o su rol. Revisa InicioSesionSerializer en Django.'
    );
  }

  return data as LoginResponse;
}

/**
 * Consultar el perfil del usuario autenticado.
 * URL: GET /api/auth/me/
 */
export async function getProfile(
  accessToken: string
): Promise<AuthUser> {
  const response = await fetch(`${AUTH_URL}/me/`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(data, 'No se pudo obtener el perfil del usuario.')
    );
  }

  return data as AuthUser;
}

/**
 * Renovar el token de acceso.
 * URL: POST /api/auth/refresh/
 */
export async function refreshAccessToken(): Promise<RefreshResponse> {
  const refresh = localStorage.getItem('fio_refresh');

  if (!refresh) {
    throw new Error('No existe un token de renovación guardado.');
  }

  const response = await fetch(`${AUTH_URL}/refresh/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh }),
  });

  const data = await readResponse(response);

  if (!response.ok || !data?.access) {
    localStorage.removeItem('fio_access');
    localStorage.removeItem('fio_refresh');
    localStorage.removeItem('fio_user');

    throw new Error(
      getErrorMessage(data, 'La sesión venció. Inicia sesión nuevamente.')
    );
  }

  localStorage.setItem('fio_access', data.access);

  if (data.refresh) {
    localStorage.setItem('fio_refresh', data.refresh);
  }

  return data as RefreshResponse;
}

/**
 * Cerrar sesión.
 * URL: POST /api/auth/logout/
 */
export async function logoutRequest(): Promise<void> {
  const access = localStorage.getItem('fio_access');
  const refresh = localStorage.getItem('fio_refresh');

  if (!refresh) {
    return;
  }

  const response = await fetch(`${AUTH_URL}/logout/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(access
        ? { Authorization: `Bearer ${access}` }
        : {}),
    },
    body: JSON.stringify({ refresh }),
  });

  if (!response.ok && response.status !== 205) {
    const data = await readResponse(response);

    throw new Error(
      getErrorMessage(data, 'No se pudo cerrar la sesión en el servidor.')
    );
  }
}

/**
 * Rutas de inicio según el rol.
 */
export function roleHome(rol: UserRole): string {
  const routes: Record<UserRole, string> = {
    comercial: '/fio',
    jefa_taller: '/taller',
    taller: '/trabajador',
    gerencia: '/gerencia',
  };

  return routes[rol];
}

/**
 * Recuperar el usuario guardado en el navegador.
 */
export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('fio_user');

    if (!raw) {
      return null;
    }

    const user = JSON.parse(raw) as AuthUser;

    const validRoles: UserRole[] = [
      'comercial',
      'jefa_taller',
      'taller',
      'gerencia',
    ];

    if (
      !user ||
      typeof user.id !== 'number' ||
      typeof user.username !== 'string' ||
      !validRoles.includes(user.rol)
    ) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
