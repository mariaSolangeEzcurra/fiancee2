
const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

const TALLER_URL = `${API_URL}/api/taller`;

async function requestTaller<T>(
  endpoint: string,
  method: 'GET' | 'POST'
): Promise<T> {
  const token = localStorage.getItem('fio_access');

  if (!token) {
    throw new Error('Tu sesión ha vencido. Inicia sesión nuevamente.');
  }

  const response = await fetch(`${TALLER_URL}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.detail ||
        data?.error ||
        `Error ${response.status} al consultar la asistencia.`
    );
  }

  return data as T;
}

export interface AsistenciaTrabajadora {
  id: number;
  fecha: string;
  entrada: string;
  salida: string | null;
  jornada_activa: boolean;
  horas_trabajadas: number | string;
}

export interface PanelTaller {
  trabajadora: {
    id: number;
    nombre: string;
    area?: string;
  };
  fecha: string;
  asistencia: AsistenciaTrabajadora | null;
}

export function obtenerMiPanel(): Promise<PanelTaller> {
  return requestTaller<PanelTaller>('/mi-panel/', 'GET');
}

export function iniciarMiJornada(): Promise<unknown> {
  return requestTaller('/mi-jornada/iniciar/', 'POST');
}

export function finalizarMiJornada(): Promise<unknown> {
  return requestTaller('/mi-jornada/finalizar/', 'POST');
}
