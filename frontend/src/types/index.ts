
export type Role = 'fio' | 'jefa' | 'trabajador' | 'gerencia';

export type AreaId =
  | 'patronaje'
  | 'corte'
  | 'confeccion'
  | 'bordado'
  | 'encaje'
  | 'pruebas'
  | 'acabados'
  | 'lavanderia';

export type ProcessId =
  | 'patronaje'
  | 'corte'
  | 'confeccion'
  | 'entalle'
  | 'corse'
  | 'prueba1'
  | 'ajustes'
  | 'bordado'
  | 'encaje'
  | 'prueba2'
  | 'acabados'
  | 'pruebaFinal'
  | 'entrega';

export type ProcessHours = Partial<Record<ProcessId, number>>;
export type AreaHours = Record<AreaId, number>;

export type DressType = 'Novia' | 'Quinceañera';
export type Complexity = 'Baja' | 'Media' | 'Alta' | 'Muy alta';
export type Workshop = 'Taller A' | 'Taller C';
export type Level = 'Ninguno' | 'Ligero' | 'Medio' | 'Intenso';
export type SkirtVolume = 'Estándar' | 'Amplio' | 'Gran volumen';

export type CollectionId =
  | 'Essenza'
  | 'Aurora'
  | 'Maison Luxe';

export type DressStatus =
  | 'En cola'
  | 'En producción'
  | 'Terminado';

export type Priority = 'Alta' | 'Media' | 'Normal';
export type Tone = 'ok' | 'risk' | 'bad' | 'neutral';
export type NoteKind = 'observacion' | 'incidencia';

/**
 * Plantilla de producción para mantener compatibilidad
 * con los selectores y componentes existentes.
 *
 * Los datos de producción reales del simulador deben proceder
 * del catálogo del backend, no de horas locales estimadas.
 */
export interface TimeTemplate {
  id: string;
  name: string;
  workshop: Workshop;
  description: string;
  hours: ProcessHours;
  waitingHours?: number;
  source?: 'backend' | 'local';
  processOrder?: ProcessId[];
  waitingByProcess?: Partial<Record<ProcessId, number>>;
  backendDressId?: number;
  backendRouteId?: number;
}

/**
 * Operación dinámica recibida del catálogo y programada
 * por el simulador.
 *
 * operationId: ID de la operación de la ruta/plantilla.
 * Se utiliza para relacionar dependencias.
 * No confundirlo con el ID global de la operación,
 * utilizado para comprobar las habilidades de las trabajadoras.
 */
export interface SimulationOperation {
  itemName: string;
  operationName: string;
  operationId: number;
  area: string | null;
  requiredHours: number;
  assignedHours: number;
  startDate: string | null;
  finishDate: string | null;
  workerIds: string[];
  waiting: boolean;
}

export interface ContractSpec {
  corteId: string;
  workshop: Workshop;
  type: DressType;
  complexity: Complexity;
  collection: CollectionId;
  bordado: Level;
  encaje: Level;
  volume: SkirtVolume;
  features: string[];
  excluded: ProcessId[];
}

export interface ContractInput extends ContractSpec {
  client: string;
  city: string;
  eventDate: string;
  deliveryDate: string;
  price: number;
}

export interface ProcessStep {
  process: ProcessId;
  estHours: number;
  workedHours: number;
  done: boolean;
  workerIds: string[];
}

export interface DressNote {
  id: string;
  date: string;
  author: string;
  text: string;
  kind: NoteKind;
}

export interface Dress {
  id: string;
  code: string;
  client: string;
  city: string;
  type: DressType;
  corteId: string;
  collection: CollectionId;
  complexity: Complexity;
  workshop: Workshop;
  eventDate: string;
  deadline: string;
  status: DressStatus;
  steps: ProcessStep[];
  currentIndex: number;
  price: number;
  paid: number;
  priority: Priority;
  notes: DressNote[];
  receivedFromC?: string[];
  isNew?: boolean;
}

export interface DressSeed {
  code: string;
  client: string;
  city: string;
  type: DressType;
  corteId: string;
  collection: CollectionId;
  complexity: Complexity;
  workshop: Workshop;
  eventDate: string;
  deadline: string;
  current: ProcessId;
  progress: number;
  price: number;
  paid: number;
  priority: Priority;
  bordado?: Level;
  encaje?: Level;
  volume?: SkirtVolume;
  features?: string[];
  overrun?: boolean;
  receivedFromC?: string[];
  notes?: Omit<DressNote, 'id'>[];
}

/**
 * Modelo de trabajadora que consume la interfaz.
 * Es distinto al modelo Trabajadora de Django.
 */
export interface Worker {
  id: string;
  name: string;
  initials: string;
  role: string;
  areas: Partial<Record<AreaId, number>>;
  paidHours: number;
  loggedBase: number;
  lastLog: string;
}

export interface TimeLog {
  id: string;
  workerId: string;
  dressId: string;
  process: ProcessId;
  date: string;
  start: string;
  end: string;
  hours: number;
  note: string;
  seed?: boolean;
}

export interface FinanceSettings {
  personal: number;
  servicios: number;
  alquiler: number;
  monthlyGoal: number;
  targetMargin: number;
  materialsRate: number;
}

export interface IncomeItem {
  id: string;
  concept: string;
  date: string;
  amount: number;
}

export interface PendingExpense {
  id: string;
  concept: string;
  due: string;
  amount: number;
}

export interface MonthRecord {
  month: string;
  income: number;
  costs: number;
  finished: number;
}

export interface AreaLoad {
  area: AreaId;
  capacity: number;
  committed: number;
  available: number;
  utilization: number;
}

export interface AreaNeed extends AreaLoad {
  needed: number;
  margin: number;
  utilAfter: number;
  readyDay: number;
  tone: Tone;
  staff: string[];
  staffNeeded: number;
}

export interface SimulationResult {
  status: 'ok' | 'risk' | 'bad';
  totalHours: number;

  /**
   * Resumen compatible con los componentes que todavía
   * utilizan los procesos tradicionales de la interfaz.
   */
  byProcess: {
    process: ProcessId;
    hours: number;
    area: AreaId | null;
  }[];

  /**
   * Operaciones dinámicas provenientes de las rutas
   * devueltas por el catálogo de Django.
   */
  operations: SimulationOperation[];

  areas: AreaNeed[];

  start: Date;

  /**
   * Es null cuando no se pudo programar la finalización
   * con los datos de capacidad disponibles.
   */
  finish: Date | null;

  delivery: Date;
  event: Date;

  deliveryDays: number;
  marginDays: number;
  availableHours: number;
  marginHours: number;

  critical: AreaNeed | null;

  /**
   * La cola real no está disponible en las dos API
   * del simulador. null significa dato no proporcionado;
   * no debe sustituirse por cero.
   */
  queue: {
    dressesAhead: number | null;
    hoursAhead: number | null;
    delayDays: number | null;
  };

  currentLoad: number;
  staffNeeded: number;
  minLead: number;
  reasons: string[];
  alternativeDate: Date | null;
}

export interface SystemAlert {
  id: string;
  severity: 'risk' | 'bad';
  category:
    | 'Capacidad'
    | 'Producción'
    | 'Personal'
    | 'Materiales';
  title: string;
  why: string;
  impact: string;
  dressCode?: string;
}

export interface ClientRequest {
  id: string;
  client: string;
  city: string;
  summary: string;
  type: DressType;
  eventDate: string;
  received: string;
  channel: string;
  corteId: string;
  complexity: Complexity;
  collection: CollectionId;
  price: number;
  bordado?: Level;
  features?: string[];
}
