/**
 * Dirección del backend, en un solo lugar.
 *
 * VITE_API_URL puede venir con o sin "/api" al final
 * (http://127.0.0.1:8000 o http://127.0.0.1:8000/api): ambos funcionan.
 */
const RAW = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').trim();

/** Raíz del servidor, sin "/api" ni barras finales. */
export const API_ROOT = RAW.replace(/\/+$/, '').replace(/\/api$/, '');

/** Raíz de la API: siempre termina en "/api". */
export const API_URL = `${API_ROOT}/api`;
