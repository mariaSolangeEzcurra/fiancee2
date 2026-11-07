import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  XIcon,
  PlusIcon,
  SparklesIcon,
  FileCheck2Icon,
  Trash2Icon,
  RefreshCwIcon,
  PencilLineIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import type { ContractInput } from '../../types';

import { SimulationResult } from '../../components/simulator/SimulationResult';
import { SimulatorForm } from '../../components/simulator/SimulatorForm';
import { useSimulator } from '../../components/simulator/useSimulator';
import { PageHeader } from '../../components/ui/PageHeader';

import { saveSimulatorPrefill } from '../../services/contractsApi';
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
  if (!input.corteId) return 'Selecciona un vestido del catálogo.';
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

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAlternativeDate(value: Date | string): string {
  if (typeof value === 'string') {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (dateOnly) return dateOnly[0];

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('La fecha alternativa recibida no es válida.');
    }
    return formatLocalDate(parsed);
  }
  return formatLocalDate(value);
}

export function Simulator() {
  const sim = useSimulator();
  const navigate = useNavigate();

  const [contractDresses, setContractDresses] = useState<ContractDress[]>([]);
  const [activeDraftAdded, setActiveDraftAdded] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [simulatedItemsKey, setSimulatedItemsKey] = useState<string | null>(null);

  const busy = sim.simulating || sim.capacityLoading;
  const catalogUnavailable = sim.catalogLoading || Boolean(sim.catalogError);

  /** Nombre legible del vestido (el corteId puede ser un código interno). */
  const findTemplate = (input: ContractInput) =>
    sim.templates.find(
      (template) =>
        template.workshop === input.workshop &&
        (template.id === input.corteId ||
          String(template.backendDressId ?? '') === String(input.corteId))
    );

  const dressName = (input: ContractInput) =>
    findTemplate(input)?.name ?? (input.corteId ? String(input.corteId) : 'Sin seleccionar');

  const getContractInputs = (): ContractInput[] => {
    const items = contractDresses.map((item) => cloneInput(item.input));
    if (!activeDraftAdded) items.push(cloneInput(sim.input));
    return items;
  };

  const currentItems = getContractInputs();
  const currentItemsKey = JSON.stringify(currentItems);
  const resultStale =
    Boolean(sim.result) && (sim.stale || simulatedItemsKey !== currentItemsKey);
  const totalDresses = currentItems.length;
  const draftVisible = !activeDraftAdded;

  const invalidateResult = () => setSimulatedItemsKey(null);

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
      toast.error('Este vestido y taller ya están en la lista.');
      return;
    }

    setContractDresses((items) => [
      ...items,
      { id: `${key}::${Date.now()}`, input: cloneInput(sim.input) },
    ]);
    setActiveDraftAdded(true);
    invalidateResult();

    toast.success('Vestido agregado al pedido.', {
      description: `${dressName(sim.input)} · ${sim.input.workshop}`,
    });
  };

  const handleRemoveDress = (id: string) => {
    setContractDresses((items) => items.filter((item) => item.id !== id));
    invalidateResult();
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
    if (busy) {
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
        toast.error(`${dressName(item)}: ${error}`);
        return;
      }
    }

    const keys = items.map(dressKey);
    if (new Set(keys).size !== keys.length) {
      toast.error('Hay vestidos repetidos en el pedido.');
      return;
    }

    const missingTemplate = items.find((item) => !findTemplate(item));
    if (missingTemplate) {
      toast.error(
        `No se encontró la ruta de "${dressName(missingTemplate)}". Selecciona el vestido nuevamente.`
      );
      return;
    }

    setSimulatedItemsKey(JSON.stringify(items));
    setResultModalOpen(true);
    sim.runMany(items);
  };

  /**
   * Aceptar: los vestidos simulados pasan al formulario de contrato
   * (prellenado). Al guardarlo, Django crea la clienta si no existe y
   * reserva las horas del taller.
   */
  const handleAcceptContract = () => {
    if (!sim.result || resultStale) {
      toast.error('Vuelve a simular antes de aceptar.');
      return;
    }

    saveSimulatorPrefill(
      getContractInputs().map((item) => ({
        client: item.client,
        corteId: item.corteId,
        workshop: item.workshop,
        eventDate: item.eventDate,
        deliveryDate: item.deliveryDate,
        price: item.price,
        backendDressId: findTemplate(item)?.backendDressId,
      }))
    );

    setResultModalOpen(false);
    navigate('/fio/contratos');
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

    // La fecha se aplica a todos los vestidos del pedido.
    const updatedItems = getContractInputs().map((item) => ({
      ...cloneInput(item),
      deliveryDate: alternativeDate,
    }));

    setContractDresses((current) =>
      current.map((item) => ({
        ...item,
        input: { ...cloneInput(item.input), deliveryDate: alternativeDate },
      }))
    );
    sim.setInput({ ...sim.input, deliveryDate: alternativeDate });

    setSimulatedItemsKey(JSON.stringify(updatedItems));
    sim.runMany(updatedItems);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador de capacidad"
        subtitle="Antes de aceptar un contrato, comprueba si el taller llega a la fecha con la carga y el personal reales."
      />

      {/* Acciones: un solo lugar para simular */}
      <section className="sticky top-0 z-20 rounded-2xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSimulateContract}
            disabled={busy || catalogUnavailable}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cocoa px-5 py-3 text-sm font-semibold text-white hover:bg-[#3a281f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <RefreshCwIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SparklesIcon className="h-4 w-4" />
            )}
            {busy ? 'Simulando…' : `Simular ${totalDresses > 1 ? `${totalDresses} vestidos` : 'contratación'}`}
          </button>

          <button
            type="button"
            onClick={handleAddDress}
            disabled={busy || catalogUnavailable}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gold-soft bg-paper px-4 py-3 text-sm font-semibold text-cocoa hover:bg-champagne-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Agregar otro vestido
          </button>

          {sim.result && !resultStale && (
            <button
              type="button"
              onClick={() => setResultModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream"
            >
              <FileCheck2Icon className="h-4 w-4" />
              Ver resultado
            </button>
          )}

          {resultStale && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
              Cambiaste datos: vuelve a simular
            </span>
          )}
        </div>
      </section>

      {sim.catalogError && (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
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
          Cargando catálogo…
        </section>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(280px,4fr)]">
        {/* El botón "Simular" del formulario se oculta: se usa el de arriba. */}
        <div className="min-w-0 [&_button[type=submit]]:hidden">
          <SimulatorForm
            input={sim.input}
            onChange={update}
            hours={sim.hours}
            baseHours={sim.baseHours}
            templates={sim.templates}
            onSimulate={handleSimulateContract}
            simulating={busy}
            catalogLoading={sim.catalogLoading}
            catalogError={sim.catalogError}
          />
        </div>

        {/* Pedido: lista numerada y ordenada */}
        <aside className="min-w-0 rounded-2xl border border-line bg-paper xl:sticky xl:top-24">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="font-display text-2xl font-semibold text-cocoa">Pedido</h2>
            <span className="rounded-full bg-champagne-soft px-3 py-1 text-xs font-semibold text-cocoa">
              {totalDresses} {totalDresses === 1 ? 'vestido' : 'vestidos'}
            </span>
          </div>

          <ol className="divide-y divide-line">
            {contractDresses.map((item, index) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cocoa text-xs font-semibold text-white">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-cocoa">
                    {dressName(item.input)}
                  </p>
                  <p className="truncate text-xs text-cocoa-muted">
                    {item.input.workshop} · Entrega {fmtShort(item.input.deliveryDate)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveDress(item.id)}
                  className="rounded-lg p-2 text-cocoa-muted hover:bg-red-50 hover:text-red-700"
                  aria-label={`Quitar ${dressName(item.input)}`}
                  title="Quitar del pedido"
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </li>
            ))}

            {draftVisible && (
              <li className="flex items-center gap-3 bg-champagne-soft/30 px-5 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-gold-soft text-xs font-semibold text-cocoa">
                  {contractDresses.length + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-cocoa">
                    {dressName(sim.input)}
                  </p>
                  <p className="truncate text-xs text-cocoa-muted">
                    {sim.input.workshop} · Entrega {fmtShort(sim.input.deliveryDate)}
                  </p>
                </div>

                <span className="inline-flex items-center gap-1 rounded-full border border-gold-soft px-2 py-0.5 text-[11px] font-medium text-cocoa">
                  <PencilLineIcon className="h-3 w-3" />
                  En edición
                </span>
              </li>
            )}
          </ol>

          <div className="border-t border-line px-5 py-3 text-xs text-cocoa-muted">
            Solo es una simulación: los datos de la clienta se piden recién al aceptar el contrato.
          </div>
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
              if (event.target === event.currentTarget) setResultModalOpen(false);
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
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl"
            >
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
                <div>
                  <h2 id="simulation-modal-title" className="font-display text-2xl font-semibold text-cocoa">
                    Resultado
                  </h2>
                  <p className="mt-0.5 text-xs text-cocoa-muted">
                    {totalDresses} {totalDresses === 1 ? 'vestido' : 'vestidos'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setResultModalOpen(false)}
                  className="rounded-xl border border-line p-2 text-cocoa hover:bg-cream"
                  aria-label="Cerrar"
                  title="Cerrar"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
                {busy ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                    <RefreshCwIcon className="h-8 w-8 animate-spin text-cocoa" />
                    <p className="font-display text-2xl font-semibold text-cocoa">Simulando…</p>
                    <p className="text-sm text-cocoa-muted">Revisando la carga y el personal del taller.</p>
                  </div>
                ) : sim.simulationError ? (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                    {sim.simulationError}
                  </div>
                ) : sim.result ? (
                  <SimulationResult
                    result={sim.result}
                    stale={resultStale || sim.simulating}
                    accepted={null}
                    onAccept={handleAcceptContract}
                    onUseAlternative={handleAlternative}
                    simulationIsDefinitive={sim.simulationIsDefinitive}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-nude p-8 text-center">
                    <SparklesIcon className="mx-auto h-8 w-8 text-cocoa-muted" />
                    <p className="mt-3 font-semibold text-cocoa">Aún no hay resultados</p>
                    <p className="mt-1 text-sm text-cocoa-muted">Completa los datos y pulsa "Simular".</p>
                  </div>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}