import { Role } from '../types';

export const roleProfiles: {id: Role;label: string;person: string;initials: string;description: string;home: string;}[] = [
{ id: 'fio', label: 'Comercial', person: 'Fio Valdivia', initials: 'FV', description: 'Simula capacidad antes de aceptar un contrato y sigue la meta del mes.', home: '/fio/simulador' },
{ id: 'jefa', label: 'Jefa de taller', person: 'Patricia Linares', initials: 'PL', description: 'Controla la producción, la cola, la capacidad y asigna al personal.', home: '/taller' },
{ id: 'trabajador', label: 'Taller', person: 'Elena Ccama', initials: 'EC', description: 'Inicia la jornada y registra las horas reales de cada vestido.', home: '/trabajador' },
{ id: 'gerencia', label: 'Gerencia', person: 'Carla Montoya', initials: 'CM', description: 'Indicadores de personal, producción, capacidad y rentabilidad.', home: '/gerencia' }];