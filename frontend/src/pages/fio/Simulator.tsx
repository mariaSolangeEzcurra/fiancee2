
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  XIcon,
  PlusIcon,
  SparklesIcon,
  FileCheck2Icon,
  Trash2Icon,
  RefreshCwIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import type { ContractInput } from '../../types';

import { SimulationResult } from '../../components/simulator/SimulationResult';
import { SimulatorForm } from '../../components/simulator/SimulatorForm';
import { useSimulator } from '../../components/simulator/useSimulator';
import { PageHeader } from '../../components/ui/PageHeader';

import { fmtShort } from '../../utils/dates';

interface ContractDress {
  id: string;
  input: ContractInput;
}

function cloneInput(input: ContractInput): ContractInput {
  return {
    ...input,
    features: [...(input.features ?? [])],
    excluded: [...(input.excluded ?? [])],
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function dressKey(input: ContractInput): string {
  return `${input.workshop}::${normalize(String(input.corteId))}`;
}

function validateInput(input: ContractInput): string | null {
  if (!input.client.trim()) {
    return 'Ingresa el nombre de la clienta.';
  }

  if (!input.corteId) {
    return 'Selecciona un vestido del catálogo.';
  }

  if (!input.eventDate || !input.deliveryDate) {
    return 'Completa las fechas del evento y de entrega.';
  }

  if (input.deliveryDate > input.eventDate) {
    return 'La fecha de entrega no puede ser posterior a la fecha del evento.';
  }

  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'El precio debe ser un número igual o mayor que cero.';
  }

  return null;
}

function getAlternativeDate(value: Date | string): string {
  if (typeof value === 'string') {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/);

    if (dateOnly) {
      return dateOnly[0];
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new Error('La fecha alternativa recibida no es válida.');
    }

    return formatLocalDate(parsed);
  }

  return formatLocalDate(value);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function Simulator() {
  const sim = useSimulator();

  const [contractDresses, setContractDresses] = useState<ContractDress[]>([]);
  const [activeDraftAdded, setActiveDraftAdded] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [simulatedItemsKey, setSimulatedItemsKey] = useState<string | null>(
    null
  );

  const getContractInputs = (): ContractInput[] => {
    const items = contractDresses.map((item) => cloneInput(item.input));

    if (!activeDraftAdded) {
      items.push(cloneInput(sim.input));
    }

    return items;
  };

  const currentItems = getContractInputs();
  const currentItemsKey = JSON.stringify(currentItems);

  const resultStale =
    Boolean(sim.result) &&
    (sim.stale || simulatedItemsKey !== currentItemsKey);

  const totalDresses = currentItems.length;

  const invalidateResult = () => {
    setSimulatedItemsKey(null);
  };

  const update = (patch: Partial<ContractInput>) => {
    sim.update(patch);
    setActiveDraftAdded(false);
    invalidateResult();
  };

  const handleAddDress = () => {
    if (sim.catalogLoading) {
      toast.error('Espera a que termine de cargar el catálogo.');
      return;
    }

    if (sim.catalogError) {
      toast.error(sim.catalogError);
      return;
    }

    if (!sim.selectedTemplate) {
      toast.error('Selecciona un vestido válido del catálogo.');
      return;
    }

    const validationError = validateInput(sim.input);

    if (validationError) {
      toast.error(validationError);
      return;
    }

    const key = dressKey(sim.input);

    if (contractDresses.some((item) => dressKey(item.input) === key)) {
      toast.error(
        'Este vestido y taller ya están agregados. Selecciona otro modelo.'
      );
      return;
    }

    setContractDresses((items) => [
      ...items,
      {
        id: `${key}::${Date.now()}`,
        input: cloneInput(sim.input),
      },
    ]);

    setActiveDraftAdded(true);
    invalidateResult();

    toast.success('Vestido agregado a la lista de simulación.', {
      description: `${sim.input.corteId} · ${sim.input.workshop}`,
    });
  };

  const handleRemoveDress = (id: string) => {
    setContractDresses((items) =>
      items.filter((item) => item.id !== id)
    );

    invalidateResult();
    toast.success('Vestido retirado de la lista.');
  };

  const handleSimulateContract = () => {
    if (sim.catalogLoading) {
      toast.error('Espera a que cargue el catálogo.');
      return;
    }

    if (sim.catalogError) {
      toast.error(sim.catalogError);
      return;
    }

    if (sim.simulating || sim.capacityLoading) {
      toast.error('Espera a que termine la consulta actual.');
      return;
    }

    const items = getContractInputs();

    if (items.length === 0) {
      toast.error('Agrega al menos un vestido para simular.');
      return;
    }

    for (const item of items) {
      const error = validateInput(item);

      if (error) {
        toast.error(
          `${item.corteId || 'Vestido sin seleccionar'}: ${error}`
        );
        return;
      }
    }

    const keys = items.map(dressKey);

    if (new Set(keys).size !== keys.length) {
      toast.error('Hay vestidos duplicados en la contratación.');
      return;
    }

    const missingTemplate = items.find(
      (item) =>
        !sim.templates.some(
          (template) =>
            template.workshop === item.workshop &&
            (
              template.id === item.corteId ||
              String(template.backendDressId ?? '') ===
                String(item.corteId)
            )
        )
    );

    if (missingTemplate) {
      toast.error(
        `No se encontró una ruta de producción para "${missingTemplate.corteId}". Selecciona el vestido nuevamente.`
      );
      return;
    }

    setSimulatedItemsKey(JSON.stringify(items));
    setResultModalOpen(true);
    sim.runMany(items);
  };

  const handleAcceptContract = () => {
    toast.error('Registro de contratos aún no disponible.', {
      description:
        'Esta pantalla solo realiza estimaciones. No se guardan contratos ni reservas en Django.',
    });
  };

  const handleAlternative = () => {
    if (!sim.result?.alternativeDate) {
      toast.error('No hay una fecha alternativa disponible.');
      return;
    }

    let alternativeDate: string;

    try {
      alternativeDate = getAlternativeDate(sim.result.alternativeDate);
    } catch {
      toast.error('No se pudo interpretar la fecha alternativa.');
      return;
    }

    const items = getContractInputs();
    const currentKey = dressKey(sim.input);

    const updatedItems = items.map((item) => {
      if (dressKey(item) !== currentKey) {
        return cloneInput(item);
      }

      return {
        ...cloneInput(item),
        deliveryDate: alternativeDate,
      };
    });

    if (activeDraftAdded) {
      setContractDresses((current) =>
        current.map((item) =>
          dressKey(item.input) === currentKey
            ? {
                ...item,
                input: {
                  ...cloneInput(item.input),
                  deliveryDate: alternativeDate,
                },
              }
            : item
        )
      );
    }

    sim.setInput({
      ...sim.input,
      deliveryDate: alternativeDate,
    });

    setSimulatedItemsKey(JSON.stringify(updatedItems));
    sim.runMany(updatedItems);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador de capacidad"
        subtitle="Prepara una lista de vestidos y consulta una estimación preliminar antes de planificar su producción."
      />

      <section className="sticky top-0 z-20 rounded-2xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAddDress}
            disabled={
              sim.catalogLoading ||
              Boolean(sim.catalogError) ||
              sim.simulating ||
              sim.capacityLoading
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gold-soft bg-paper px-4 py-3 text-sm font-semibold text-cocoa hover:bg-champagne-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Agregar vestido
          </button>

          <button
            type="button"
            onClick={handleSimulateContract}
            disabled={
              sim.simulating ||
              sim.capacityLoading ||
              sim.catalogLoading ||
              Boolean(sim.catalogError)
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cocoa px-4 py-3 text-sm font-semibold text-white hover:bg-[#3a281f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SparklesIcon className="h-4 w-4" />
            {sim.simulating || sim.capacityLoading
              ? 'Consultando capacidad…'
              : 'Simular contratación'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!sim.result || resultStale) {
                toast.error('Primero realiza una simulación actualizada.');
                return;
              }

              setResultModalOpen(true);
            }}
            disabled={!sim.result || resultStale}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileCheck2Icon className="h-4 w-4" />
            Ver resultado
          </button>

          <div className="ml-auto text-right">
            <p className="text-xs text-cocoa-muted">Vestidos en la lista</p>
            <p className="text-lg font-semibold text-cocoa">
              {totalDresses}
            </p>
          </div>
        </div>
      </section>

      {sim.catalogError && (
        <section
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <p className="font-semibold">No se pudo cargar el catálogo</p>
          <p className="mt-1">{sim.catalogError}</p>

          <button
            type="button"
            onClick={() => void sim.refreshCatalog()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 font-medium hover:bg-red-100"
          >
            <RefreshCwIcon className="h-4 w-4" />
            Reintentar
          </button>
        </section>
      )}

      {sim.catalogLoading && (
        <section className="flex items-center gap-3 rounded-xl border border-line bg-paper p-4 text-sm text-cocoa-muted">
          <RefreshCwIcon className="h-5 w-5 animate-spin" />
          Cargando catálogo desde Django…
        </section>
      )}

      

      {sim.capacityError && (
        <section
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <p className="font-semibold">No se pudo consultar la capacidad</p>
          <p className="mt-1">{sim.capacityError}</p>
        </section>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(280px,4fr)]">
        <div className="min-w-0">
          <SimulatorForm
            input={sim.input}
            onChange={update}
            hours={sim.hours}
            baseHours={sim.baseHours}
            templates={sim.templates}
            onSimulate={handleSimulateContract}
            simulating={sim.simulating || sim.capacityLoading}
            catalogLoading={sim.catalogLoading}
            catalogError={sim.catalogError}
          />
        </div>

        <aside className="min-w-0 rounded-2xl border border-line bg-paper p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-cocoa">
              Vestidos agregados
            </h2>

            <span className="rounded-full bg-champagne-soft px-3 py-1 text-xs font-semibold text-cocoa">
              {totalDresses}
            </span>
          </div>

          <p className="mt-1 text-sm text-cocoa-muted">
            Estos vestidos pertenecen a la lista de simulación. Todavía no
            son contratos guardados en la base de datos.
          </p>

          <div className="mt-4 space-y-3">
            {contractDresses.map((item, index) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-cream/50 p-3"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-cocoa">
                    Vestido {index + 1}: {item.input.corteId}
                  </p>

                  <p className="mt-1 text-xs text-cocoa-muted">
                    {item.input.workshop}
                  </p>

                  <p className="text-xs text-cocoa-muted">
                    Clienta: {item.input.client}
                  </p>

                  <p className="text-xs text-cocoa-muted">
                    Entrega: {fmtShort(item.input.deliveryDate)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveDress(item.id)}
                  className="rounded-lg p-2 text-cocoa-muted hover:bg-red-50 hover:text-red-700"
                  aria-label={`Quitar vestido ${item.input.corteId}`}
                  title="Quitar vestido"
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
            ))}

            {!activeDraftAdded && (
              <div className="rounded-xl border border-gold-soft bg-champagne-soft/40 p-3">
                <p className="text-sm font-semibold text-cocoa">
                  Borrador actual: {sim.input.corteId || 'Sin seleccionar'}
                </p>

                <p className="mt-1 text-xs text-cocoa-muted">
                  {sim.input.workshop} · {sim.input.client || 'Sin clienta'}
                </p>

                <p className="text-xs text-cocoa-muted">
                  Entrega: {fmtShort(sim.input.deliveryDate)}
                </p>
              </div>
            )}

            {activeDraftAdded && (
              <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                El borrador actual ya está agregado. Cambia el modelo en el
                formulario para preparar otro vestido.
              </p>
            )}

            {totalDresses === 0 && (
              <p className="rounded-xl border border-dashed border-nude p-5 text-center text-sm text-cocoa-muted">
                No hay vestidos en la lista.
              </p>
            )}
          </div>

          {resultStale && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Los datos cambiaron después de la última simulación. Vuelve a
              simular para actualizar el resultado.
            </p>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {resultModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setResultModalOpen(false);
              }
            }}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="simulation-modal-title"
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl"
            >
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-paper px-5 py-4 sm:px-7">
                <div>
                  <h2
                    id="simulation-modal-title"
                    className="font-display text-2xl font-semibold text-cocoa"
                  >
                    Resultado de simulación
                  </h2>

                  <p className="mt-1 text-xs text-cocoa-muted">
                    {totalDresses} vestido(s) considerados · Estimación preliminar
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setResultModalOpen(false)}
                  className="rounded-xl border border-line p-2 text-cocoa hover:bg-cream"
                  aria-label="Cerrar resultados"
                  title="Cerrar"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
                {sim.simulating || sim.capacityLoading ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
                    <RefreshCwIcon className="h-8 w-8 animate-spin text-cocoa" />

                    <p className="font-display text-2xl font-semibold text-cocoa">
                      Consultando capacidad…
                    </p>

                    <p className="text-sm text-cocoa-muted">
                      Consultando los datos disponibles en Django.
                    </p>
                  </div>
                ) : sim.simulationError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
                  >
                    {sim.simulationError}
                  </div>
                ) : sim.result ? (
                  <SimulationResult
                    result={sim.result}
                    stale={resultStale || sim.simulating}
                    accepted={null}
                    onAccept={handleAcceptContract}
                    onUseAlternative={handleAlternative}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-nude p-8 text-center">
                    <SparklesIcon className="mx-auto h-8 w-8 text-cocoa-muted" />

                    <p className="mt-3 font-semibold text-cocoa">
                      Aún no hay resultados
                    </p>

                    <p className="mt-1 text-sm text-cocoa-muted">
                      Completa los datos y pulsa “Simular contratación”.
                    </p>
                  </div>
                )}
              </div>

              <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-cream/60 px-5 py-4 sm:px-7">
                <p className="text-xs text-cocoa-muted">
                  No se crean contratos ni reservas desde esta pantalla.
                </p>

                <button
                  type="button"
                  onClick={() => setResultModalOpen(false)}
                  className="rounded-xl border border-line bg-paper px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream"
                >
                  Volver a editar
                </button>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
