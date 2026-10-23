import { AreaId, CollectionId, Complexity, Level, ProcessId, SkirtVolume, TimeTemplate } from '../types';

export const areas: {id: AreaId;name: string;}[] = [
{ id: 'patronaje', name: 'Patronaje' },
{ id: 'corte', name: 'Corte' },
{ id: 'confeccion', name: 'Confección' },
{ id: 'bordado', name: 'Bordado' },
{ id: 'encaje', name: 'Encaje' },
{ id: 'pruebas', name: 'Pruebas' },
{ id: 'acabados', name: 'Acabados' }];


export const processes: {id: ProcessId;name: string;area: AreaId | null;}[] = [
{ id: 'patronaje', name: 'Patronaje', area: 'patronaje' },
{ id: 'corte', name: 'Corte', area: 'corte' },
{ id: 'confeccion', name: 'Confección', area: 'confeccion' },
{ id: 'entalle', name: 'Entalle', area: 'confeccion' },
{ id: 'corse', name: 'Corsé', area: 'confeccion' },
{ id: 'prueba1', name: 'Prueba 1', area: 'pruebas' },
{ id: 'ajustes', name: 'Ajustes', area: 'confeccion' },
{ id: 'bordado', name: 'Bordado', area: 'bordado' },
{ id: 'encaje', name: 'Encaje', area: 'encaje' },
{ id: 'prueba2', name: 'Prueba 2', area: 'pruebas' },
{ id: 'acabados', name: 'Acabados', area: 'acabados' },
{ id: 'pruebaFinal', name: 'Prueba final', area: 'pruebas' },
{ id: 'entrega', name: 'Entrega', area: null }];


export const timeTemplates: TimeTemplate[] = [
{
  id: 'princesa',
  name: 'Princesa básico',
  workshop: 'Taller A',
  description: 'Corpiño entallado y falda con volumen moderado.',
  hours: { patronaje: 4, corte: 3, confeccion: 13, prueba1: 2, ajustes: 4, bordado: 6, encaje: 4, prueba2: 3, acabados: 5, pruebaFinal: 2 }
},
{
  id: 'princesa-volumen',
  name: 'Princesa gran volumen',
  workshop: 'Taller A',
  description: 'Falda con capas de tul y crinolina; más confección y corte.',
  hours: { patronaje: 5, corte: 5, confeccion: 19, prueba1: 2, ajustes: 5, bordado: 8, encaje: 6, prueba2: 3, acabados: 6, pruebaFinal: 2 }
},
{
  id: 'linea-a',
  name: 'Línea A',
  workshop: 'Taller A',
  description: 'Silueta fluida que abre desde la cintura.',
  hours: { patronaje: 4, corte: 3, confeccion: 11, prueba1: 2, ajustes: 3, bordado: 5, encaje: 4, prueba2: 3, acabados: 4, pruebaFinal: 2 }
},
{
  id: 'sirena',
  name: 'Sirena',
  workshop: 'Taller A',
  description: 'Entalle hasta la rodilla; ajustes más exigentes.',
  hours: { patronaje: 5, corte: 4, confeccion: 15, prueba1: 2, ajustes: 6, bordado: 6, encaje: 5, prueba2: 3, acabados: 5, pruebaFinal: 2 }
},
{
  id: 'imperio',
  name: 'Imperio',
  workshop: 'Taller A',
  description: 'Corte bajo el busto, falda recta y ligera.',
  hours: { patronaje: 3, corte: 3, confeccion: 9, prueba1: 2, ajustes: 3, bordado: 4, encaje: 3, prueba2: 2, acabados: 4, pruebaFinal: 2 }
},
{
  id: 'minimalista',
  name: 'Minimalista',
  workshop: 'Taller A',
  description: 'Sin adornos, pero con costuras y acabados de alta precisión.',
  hours: { patronaje: 5, corte: 4, confeccion: 14, prueba1: 2, ajustes: 5, prueba2: 3, acabados: 8, pruebaFinal: 2 }
},
{
  id: 'luxury',
  name: 'Luxury',
  workshop: 'Taller A',
  description: 'Alta costura con bordado y encaje extensos.',
  hours: { patronaje: 6, corte: 5, confeccion: 21, prueba1: 3, ajustes: 6, bordado: 14, encaje: 10, prueba2: 3, acabados: 8, pruebaFinal: 3 }
},
{
  id: 'taller-c',
  name: 'Terminación de Taller C',
  workshop: 'Taller C',
  description: 'Taller C entrega falda y base confeccionadas; solo se cuentan las horas pendientes en Taller A.',
  hours: { entalle: 4, corse: 6, prueba1: 2, bordado: 8, encaje: 5, prueba2: 2, acabados: 3, pruebaFinal: 2 }
}];


export const collections: {id: CollectionId;description: string;bordado: number;encaje: number;acabados: number;}[] = [
{ id: 'Essenza', description: 'Línea clásica de la casa', bordado: 1, encaje: 1, acabados: 1 },
{ id: 'Aurora', description: 'Bordado y encaje +15%', bordado: 1.15, encaje: 1.15, acabados: 1 },
{ id: 'Maison Luxe', description: 'Bordado, encaje y acabados +30%', bordado: 1.3, encaje: 1.3, acabados: 1.3 }];


export const complexityFactors: {id: Complexity;factor: number;}[] = [
{ id: 'Baja', factor: 0.85 },
{ id: 'Media', factor: 1 },
{ id: 'Alta', factor: 1.2 },
{ id: 'Muy alta', factor: 1.4 }];


export const levelFactors: {id: Level;factor: number;}[] = [
{ id: 'Ninguno', factor: 0 },
{ id: 'Ligero', factor: 0.6 },
{ id: 'Medio', factor: 1 },
{ id: 'Intenso', factor: 1.7 }];


export const skirtVolumes: {id: SkirtVolume;confeccion: number;acabados: number;corte: number;}[] = [
{ id: 'Estándar', confeccion: 1, acabados: 0, corte: 0 },
{ id: 'Amplio', confeccion: 1.2, acabados: 1, corte: 0 },
{ id: 'Gran volumen', confeccion: 1.4, acabados: 2, corte: 1 }];


export const specialFeatures: {id: string;label: string;hint: string;}[] = [
{ id: 'pedreria', label: 'Pedrería a mano', hint: '+6 h bordado' },
{ id: 'corse', label: 'Corsé estructurado', hint: '+5 h confección' },
{ id: 'cola', label: 'Cola desmontable', hint: '+5 h confección · +2 h acabados' },
{ id: 'mangas', label: 'Mangas o capa', hint: '+4 h confección' },
{ id: 'provincia', label: 'Clienta de provincia', hint: 'Pruebas agrupadas: +1 h por prueba' }];