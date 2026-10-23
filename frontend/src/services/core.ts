
const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'
).replace(/\/+$/, '');

// Esta ruta es relativa a VITE_API_URL.
// Ejemplo: API_URL=/api y REFRESH_PATH=/auth/token/refresh/
const REFRESH_PATH = (
  import.meta.env.VITE_TOKEN_REFRESH_PATH ||
  '/auth/token/refresh/'
).startsWith('/')
  ? (
      import.meta.env.VITE_TOKEN_REFRESH_PATH ||
      '/auth/token/refresh/'
    )
  : `/${import.meta.env.VITE_TOKEN_REFRESH_PATH}`;

const CATALOGO_PATH = '/core/catalogo/';
const CAPACIDAD_PATH = '/core/capacidad/';

export interface OperacionCatalogo {
  id: number;
  operacion_id: number;
  nombre: string;
  area: string;
  orden: number;
  tipo_tiempo: 'TRABAJO' | 'ESPERA';
  horas_estimadas: string;
  obligatoria: boolean;
  dependencias: number[];
  dependencias_nombres: string[];
}

export interface RutaCatalogo {
  id: number;
  taller: 'A' | 'C';
  descripcion: string;
  operaciones: OperacionCatalogo[];
}

export interface VestidoCatalogo {
  id: number;
  nombre: string;
  descripcion: string;
  rutas: RutaCatalogo[];
}

export interface HorarioTrabajadora {
  dia_semana: number;
  horas_disponibles: string;
}

export interface TrabajadoraCatalogo {
  id: number;
  nombre: string;
  area: string;
  habilidades: number[];
  horarios: HorarioTrabajadora[];
}

export interface CatalogoSimulador {
  vestidos: VestidoCatalogo[];
  trabajadoras: TrabajadoraCatalogo[];
}

export interface TrabajadoraCapacidad {
  trabajadora_id: number;
  nombre: string;
  area: string;
  horas_semanales_disponibles: string;
  horas_no_disponibles: string;
  horas_reservadas: string;
  horas_restantes: string;
}

export interface DiaCapacidad {
  fecha: string;
  dia_semana: number;
  trabajadoras: TrabajadoraCapacidad[];
}

export interface CapacidadProduccion {
  desde: string;
  hasta: string;
  dias: DiaCapacidad[];
}

interface ApiError {
  detail?: string;
  error?: string;
  message?: string;
}

interface RefreshResponse {
  access?: string;
  refresh?: string;
}

function getAccessToken(): string | null {
  return localStorage.getItem('fio_access');
}

function getRefreshToken(): string | null {
  return localStorage.getItem('fio_refresh');
}

function saveAccessToken(token: string): void {
  localStorage.setItem('fio_access', token);
}

function saveRefreshToken(token: string): void {
  localStorage.setItem('fio_refresh', token);
}

function clearSessionTokens(): void {
  localStorage.removeItem('fio_access');
  localStorage.removeItem('fio_refresh');
}

function getErrorMessage(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return null;
  }

  const error = data as ApiError;

  return error.detail || error.error || error.message || null;
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => '');
}

/**
 * Evita múltiples renovaciones simultáneas cuando varias peticiones
 * reciben un 401 al mismo tiempo.
 */
let refreshInProgress: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInProgress) {
    return refreshInProgress;
  }

  refreshInProgress = (async (): Promise<string | null> => {
    const refresh = getRefreshToken();

    if (!refresh) {
      clearSessionTokens();
      return null;
    }

    let response: Response;

    try {
      response = await fetch(`${API_URL}${REFRESH_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh }),
      });
    } catch {
      // Un fallo de red no demuestra que el refresh haya expirado.
      throw new Error(
        'No se pudo conectar con Django para renovar la sesión. ' +
          'Verifica que el backend esté activo.'
      );
    }

    const data = await readResponse(response);

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        clearSessionTokens();
        return null;
      }

      throw new Error(
        getErrorMessage(data) ||
          `No se pudo renovar la sesión (${response.status}).`
      );
    }

    const result = data as RefreshResponse | null;

    if (!result || typeof result.access !== 'string' || !result.access) {
      throw new Error(
        'La respuesta de renovación de Django no contiene un token de acceso válido.'
      );
    }

    saveAccessToken(result.access);

    // SimpleJWT puede rotar el refresh token.
    if (result.refresh) {
      saveRefreshToken(result.refresh);
    }

    return result.access;
  })();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

async function fetchApi(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<Response> {
  const headers = new Headers(options.headers);

  headers.set('Accept', 'application/json');

  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.delete('Authorization');
  }

  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      `No se pudo conectar con el backend en ${API_URL}. ` +
        'Verifica que Django esté ejecutándose y que la URL sea correcta.'
    );
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requiresAuth = true
): Promise<T> {
  let token = requiresAuth ? getAccessToken() : null;

  if (requiresAuth && !token) {
    token = await refreshAccessToken();

    if (!token) {
      throw new Error(
        'Tu sesión no tiene un token de acceso válido. Inicia sesión nuevamente.'
      );
    }
  }

  let response = await fetchApi(path, options, token);

  // Renovar y repetir una sola vez si el access token expiró.
  if (response.status === 401 && requiresAuth) {
    const newToken = await refreshAccessToken();

    if (!newToken) {
      throw new Error(
        'Tu sesión ha vencido o el token de renovación no es válido. Inicia sesión nuevamente.'
      );
    }

    response = await fetchApi(path, options, newToken);
  }

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(data) ||
        `Error del servidor (${response.status}) al consultar ${path}.`
    );
  }

  return data as T;
}

/**
 * GET /api/core/catalogo/
 * Obtiene vestidos, rutas, operaciones y trabajadoras activas.
 */
export function getCatalogoSimulador(): Promise<CatalogoSimulador> {
  return apiRequest<CatalogoSimulador>(
    CATALOGO_PATH,
    { method: 'GET' },
    true
  );
}

/**
 * GET /api/core/capacidad/?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 * Consulta la disponibilidad diaria que calcula Django.
 */
export function getCapacidadProduccion(
  desde?: string,
  hasta?: string
): Promise<CapacidadProduccion> {
  const params = new URLSearchParams();

  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);

  const query = params.toString();

  return apiRequest<CapacidadProduccion>(
    `${CAPACIDAD_PATH}${query ? `?${query}` : ''}`,
    { method: 'GET' },
    true
  );
}
