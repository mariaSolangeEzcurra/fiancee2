import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  ContractInput,
  ProcessHours,
  ProcessId,
  SimulationResult,
  TimeTemplate,
  Workshop,
} from '../../types';

import { getCatalogoSimulador } from '../../services/core';
import type {
  CatalogoSimulador,
  OperacionCatalogo,
  RutaCatalogo,
} from '../../services/core';
import { catalogToTemplates } from '../../services/catalogAdapter';
import { simulate, toSimulationResult } from '../../services/simulatorApi';
import type { BackendTaller, SimulacionInput } from '../../services/simulatorApi';
import { addCalendarDays, TODAY, toISO } from '../../utils/dates';

/**
 * Simulador de capacidad.
 *
 * El catálogo (vestidos, rutas y operaciones) se descarga de Django y la
 * factibilidad la calcula Django en POST /api/core/simulador/, con la
 * carga comprometida real, los horarios y ausencias del personal, la
 * regla del bordado (15 días antes) y la temporada alta.
 */

interface CatalogState {
  templates: TimeTemplate[];
  catalog: CatalogoSimulador | null;
  loading: boolean;
  error: string | null;
}

interface ResolvedItem {
  input: ContractInput;
  template: TimeTemplate;
}

function todayISO(): string {
  return toISO(TODAY);
}

function createInitialInput(): ContractInput {
  const today = todayISO();
  const eventDate = addCalendarDays(today, 180);

  return {
    client: '',
    city: '',
    eventDate,
    // Por defecto: entrega 5 días antes del evento.
    deliveryDate: addCalendarDays(eventDate, -5),
    price: 0,
    corteId: '',
    workshop: 'Taller A',
    type: 'Quinceañera',
    complexity: 'Media',
    collection: 'Maison Luxe',
    bordado: 'Ninguno',
    encaje: 'Ninguno',
    volume: 'Estándar',
    features: [],
    excluded: [],
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseHours(value: string | number | undefined): number {
  const hours = Number(value);
  return Number.isFinite(hours) ? Math.max(0, hours) : 0;
}

export function tallerCode(workshop: Workshop): BackendTaller {
  if (workshop === 'Taller C') return 'C';
  if (workshop === 'Tienda') return 'T';
  return 'A';
}

function resolveTemplate(
  templates: TimeTemplate[],
  input?: ContractInput | null,
): TimeTemplate | null {
  if (!input?.corteId || !input.workshop) return null;

  const target = normalize(String(input.corteId));

  return (
    templates.find(
      (template) =>
        String(template.id) === String(input.corteId) &&
        template.workshop === input.workshop,
    ) ??
    templates.find(
      (template) =>
        template.backendDressId !== undefined &&
        String(template.backendDressId) === String(input.corteId) &&
        template.workshop === input.workshop,
    ) ??
    templates.find(
      (template) =>
        normalize(template.name) === target &&
        template.workshop === input.workshop,
    ) ??
    null
  );
}

/** Proceso de la interfaz equivalente a una operación de Django. */
function processFromOperation(operation: OperacionCatalogo): ProcessId | null {
  const name = normalize(operation.nombre);

  if (name.includes('patronaje')) return 'patronaje';
  if (name.includes('corte')) return 'corte';
  if (name.includes('confeccion')) return 'confeccion';
  if (name.includes('entalle')) return 'entalle';
  if (name.includes('corse') || name.includes('corset')) return 'corse';
  if (name.includes('prueba 1')) return 'prueba1';
  if (name.includes('prueba 2')) return 'prueba2';
  if (name.includes('prueba final') || name.includes('prueba 3')) return 'pruebaFinal';
  if (name.includes('ajuste')) return 'ajustes';
  if (name.includes('bordado')) return 'bordado';
  if (name.includes('encaje')) return 'encaje';
  if (name.includes('acabado') || name.includes('basta')) return 'acabados';
  if (name.includes('entrega')) return 'entrega';

  return null;
}

function operationIsExcluded(operation: OperacionCatalogo, input: ContractInput): boolean {
  const process = processFromOperation(operation);
  return process !== null && (input.excluded ?? []).includes(process);
}

function routeForTemplate(
  catalog: CatalogoSimulador,
  template: TimeTemplate,
): RutaCatalogo | null {
  if (template.backendDressId === undefined || template.backendRouteId === undefined) {
    return null;
  }

  const dress = catalog.vestidos.find((item) => item.id === template.backendDressId);
  if (!dress) return null;

  return (
    dress.rutas.find(
      (route) =>
        route.id === template.backendRouteId &&
        route.taller === tallerCode(template.workshop),
    ) ?? null
  );
}

/** Desglose de horas por proceso para el formulario. */
function getHoursFromCatalog(
  catalog: CatalogoSimulador | null,
  template: TimeTemplate | null,
  input: ContractInput,
): ProcessHours {
  if (!catalog || !template) return {};

  const route = routeForTemplate(catalog, template);
  if (!route) return {};

  const result: ProcessHours = {};

  for (const operation of route.operaciones) {
    if (
      !operation.obligatoria ||
      operation.tipo_tiempo === 'ESPERA' ||
      operationIsExcluded(operation, input)
    ) {
      continue;
    }

    const process = processFromOperation(operation);
    if (!process) continue;

    result[process] = (result[process] ?? 0) + parseHours(operation.horas_estimadas);
  }

  return result;
}

function validateInput(input?: ContractInput | null): string | null {
  if (!input) return 'Completa los datos antes de simular.';
  if (!input.corteId) return 'Selecciona un vestido del catálogo de Django.';

  if (!input.eventDate || !input.deliveryDate) {
    return 'Completa la fecha del evento y la fecha de entrega.';
  }
  if (input.deliveryDate < todayISO()) {
    return 'La fecha de entrega no puede estar en el pasado.';
  }
  if (input.deliveryDate > input.eventDate) {
    return 'La fecha de entrega no puede ser posterior al evento.';
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'El precio debe ser un número igual o mayor que cero.';
  }

  return null;
}

/** Cuerpo para POST /api/core/simulador/. */
function buildRequest(items: ResolvedItem[], catalog: CatalogoSimulador): SimulacionInput {
  // Todos los vestidos del pedido deben estar listos para la fecha más próxima.
  const fechaEntrega = items.map((i) => i.input.deliveryDate).sort()[0];
  const fechaEvento = items.map((i) => i.input.eventDate).filter(Boolean).sort()[0] ?? null;

  return {
    fecha_entrega: fechaEntrega,
    fecha_evento: fechaEvento,
    vestidos: items.map(({ input, template }) => {
      const route = routeForTemplate(catalog, template);
      const procesos = (route?.operaciones ?? [])
        .filter((operation) => operationIsExcluded(operation, input))
        .map((operation) => ({
          plantilla: operation.id,
          horas: String(operation.horas_estimadas),
          incluido: false,
        }));

      return {
        tipo_vestido: template.backendDressId as number,
        taller: tallerCode(input.workshop),
        ...(procesos.length ? { procesos } : {}),
      };
    }),
  };
}

export function useSimulator(initial?: ContractInput) {
  const [input, setInput] = useState<ContractInput>(() => initial ?? createInitialInput());
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simulatedInputKey, setSimulatedInputKey] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogState>({
    templates: [],
    catalog: null,
    loading: true,
    error: null,
  });

  const runIdRef = useRef(0);

  const refreshCatalog = useCallback(async () => {
    setCatalog((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await getCatalogoSimulador();
      const templates = catalogToTemplates(response).filter(
        (template) =>
          template.source === 'backend' &&
          template.backendDressId !== undefined &&
          template.backendRouteId !== undefined,
      );

      if (templates.length === 0) {
        throw new Error('Django no devolvió rutas utilizables en el catálogo.');
      }

      setCatalog({ templates, catalog: response, loading: false, error: null });
    } catch (error: unknown) {
      setCatalog({
        templates: [],
        catalog: null,
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo cargar el catálogo de Django.',
      });
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
    return () => {
      runIdRef.current += 1;
    };
  }, [refreshCatalog]);

  const templates = catalog.templates;

  const selectedTemplate = useMemo(() => resolveTemplate(templates, input), [templates, input]);

  const hours = useMemo(
    () => getHoursFromCatalog(catalog.catalog, selectedTemplate, input),
    [catalog.catalog, selectedTemplate, input],
  );

  const baseHours = useMemo(
    () => getHoursFromCatalog(catalog.catalog, selectedTemplate, { ...input, excluded: [] }),
    [catalog.catalog, selectedTemplate, input],
  );

  const inputKey = JSON.stringify(input);
  const stale = result !== null && simulatedInputKey !== inputKey;

  const update = useCallback((patch: Partial<ContractInput>) => {
    setInput((current) => ({ ...current, ...patch }));
    setResult(null);
    setSimulatedInputKey(null);
    setSimulationError(null);
  }, []);

  const load = useCallback((next: ContractInput) => {
    runIdRef.current += 1;
    setSimulating(false);
    setInput(next);
    setResult(null);
    setSimulatedInputKey(null);
    setSimulationError(null);
  }, []);

  const runMany = useCallback(
    (items: ContractInput[]) => {
      runIdRef.current += 1;
      const runId = runIdRef.current;

      setSimulationError(null);
      setResult(null);
      setSimulatedInputKey(null);

      if (catalog.loading) {
        setSimulationError('Espera a que termine de cargar el catálogo de Django.');
        return;
      }
      if (!catalog.catalog || catalog.error || templates.length === 0) {
        setSimulationError(catalog.error ?? 'No hay un catálogo válido disponible.');
        return;
      }
      if (items.length === 0) {
        setSimulationError('Agrega al menos un vestido para simular.');
        return;
      }

      for (const item of items) {
        const error = validateInput(item);
        if (error) {
          setSimulationError(error);
          return;
        }
      }

      const resolved: ResolvedItem[] = [];
      for (const item of items) {
        const template = resolveTemplate(templates, item);
        if (!template) {
          setSimulationError(`No se encontró la ruta de "${item.corteId}" para ${item.workshop}.`);
          return;
        }
        resolved.push({ input: item, template });
      }

      const keyAtStart = JSON.stringify(items.length === 1 ? items[0] : input);
      const body = buildRequest(resolved, catalog.catalog);

      setSimulating(true);
      void (async () => {
        try {
          const response = await simulate(body);
          if (runIdRef.current !== runId) return;
          setResult(toSimulationResult(response));
          setSimulatedInputKey(keyAtStart);
        } catch (error: unknown) {
          if (runIdRef.current !== runId) return;
          setResult(null);
          setSimulatedInputKey(null);
          setSimulationError(
            error instanceof Error ? error.message : 'No se pudo ejecutar la simulación en Django.',
          );
        } finally {
          if (runIdRef.current === runId) setSimulating(false);
        }
      })();
    },
    [catalog.loading, catalog.error, catalog.catalog, templates, input],
  );

  const run = useCallback(
    (override?: ContractInput) => {
      const target = override ?? input;
      if (override) setInput(override);
      runMany([target]);
    },
    [input, runMany],
  );

  return {
    input,
    update,
    setInput,
    hours,
    baseHours,
    result,
    simulating,
    stale,
    run,
    runMany,
    load,
    templates,

    catalogError: catalog.error,
    catalogLoaded: !catalog.loading && catalog.error === null,
    catalogLoading: catalog.loading,
    simulationError,
    refreshCatalog,
    selectedTemplate,

    catalogData: catalog.catalog,
    backendWorkers: catalog.catalog?.trabajadoras ?? [],
    backendDressTypes: catalog.catalog?.vestidos ?? [],

    // La capacidad ya la calcula Django dentro de la simulación.
    capacityData: null,
    capacityLoading: false,
    capacityError: null as string | null,

    // El resultado proviene de los datos reales del taller.
    simulationIsDefinitive: true,
  };
}
