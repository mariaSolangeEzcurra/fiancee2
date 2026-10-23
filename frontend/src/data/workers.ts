import { Worker } from '../types';

export const workers: Worker[] = [
{ id: 'w1', name: 'Rosa Quispe', initials: 'RQ', role: 'Patronista y cortadora', areas: { patronaje: 20, corte: 20 }, paidHours: 48, loggedBase: 38, lastLog: '2026-09-25' },
{ id: 'w2', name: 'Carmen Mamani', initials: 'CM', role: 'Modista de confección', areas: { confeccion: 40 }, paidHours: 48, loggedBase: 41, lastLog: '2026-09-25' },
{ id: 'w3', name: 'Lucía Condori', initials: 'LC', role: 'Modista de confección', areas: { confeccion: 40 }, paidHours: 48, loggedBase: 36, lastLog: '2026-09-25' },
{ id: 'w4', name: 'Julia Huamán', initials: 'JH', role: 'Modista de confección', areas: { confeccion: 40 }, paidHours: 48, loggedBase: 17, lastLog: '2026-09-23' },
{ id: 'w5', name: 'Elena Ccama', initials: 'EC', role: 'Bordadora', areas: { bordado: 40 }, paidHours: 48, loggedBase: 32, lastLog: '2026-09-25' },
{ id: 'w6', name: 'Gladys Apaza', initials: 'GA', role: 'Bordadora', areas: { bordado: 40 }, paidHours: 48, loggedBase: 39, lastLog: '2026-09-25' },
{ id: 'w7', name: 'Norma Turpo', initials: 'NT', role: 'Encajera', areas: { encaje: 40 }, paidHours: 48, loggedBase: 35, lastLog: '2026-09-25' },
{ id: 'w8', name: 'Silvia Chambi', initials: 'SC', role: 'Acabados', areas: { acabados: 40 }, paidHours: 48, loggedBase: 40, lastLog: '2026-09-25' },
{ id: 'w9', name: 'Marisol Vargas', initials: 'MV', role: 'Pruebas y acabados', areas: { pruebas: 24, acabados: 16 }, paidHours: 48, loggedBase: 39, lastLog: '2026-09-25' }];