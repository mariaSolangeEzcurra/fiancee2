
import React, { useMemo } from 'react';
import {
  LoaderCircleIcon,
  SparklesIcon,
  CheckCircle2Icon,
} from 'lucide-react';

import type {
  ContractInput,
  DressType,
  ProcessId,
  ProcessHours,
  TimeTemplate,
  Workshop,
} from '../../types';

import { routeFromHours, totalHours } from '../../utils/estimate';
import { cn, fmtH, inputClass } from '../../utils/format';
import { processName } from '../../utils/processes';
import { Field } from '../ui/Field';
import { Segmented } from '../ui/Segmented';

interface SimulatorFormProps {
  input: ContractInput;
  onChange: (patch: Partial<ContractInput>) => void;
  hours: ProcessHours;
  baseHours: ProcessHours;
  templates: TimeTemplate[];
  onSimulate: () => void;
  simulating: boolean;
  catalogLoading?: boolean;
  catalogError?: string | null;
}

export function SimulatorForm({
  input,
  onChange,
  hours,
  baseHours,
  templates,
  onSimulate,
  simulating,
  catalogLoading = false,
  catalogError = null,
}: SimulatorFormProps) {
  const availableTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.source === 'backend' &&
          template.backendDressId !== undefined &&
          template.backendRouteId !== undefined
      ),
    [templates]
  );

  const selectedTemplate = useMemo(
    () =>
      availableTemplates.find(
        (template) =>
          template.workshop === input.workshop &&
          (
            String(template.backendDressId) === input.corteId ||
            template.id === input.corteId
          )
      ),
    [availableTemplates, input.corteId, input.workshop]
  );

  const workshopTemplates = useMemo(
    () =>
      availableTemplates.filter(
        (template) => template.workshop === input.workshop
      ),
    [availableTemplates, input.workshop]
  );

  const route = useMemo(
    () => routeFromHours(baseHours).filter((process) => process !== 'entrega'),
    [baseHours]
  );

  const activeProcesses = route.filter(
    (process) => !input.excluded.includes(process)
  );

  const total = totalHours(hours);

  const activeCount = activeProcesses.filter(
    (process) => (hours[process] ?? 0) > 0
  ).length;

  const handleTemplate = (value: string) => {
    const template = workshopTemplates.find(
      (item) =>
        String(item.backendDressId) === value ||
        item.id === value
    );

    if (!template) {
      onChange({ corteId: value });
      return;
    }

    onChange({
      corteId:
        template.backendDressId !== undefined
          ? String(template.backendDressId)
          : template.id,
      workshop: template.workshop,
      excluded: [],
    });
  };

  const handleWorkshop = (workshop: Workshop) => {
    const nextTemplate = availableTemplates.find(
      (template) => template.workshop === workshop
    );

    onChange({
      workshop,
      corteId: nextTemplate
        ? String(nextTemplate.backendDressId ?? nextTemplate.id)
        : '',
      excluded: [],
    });
  };

  const toggleProcess = (process: ProcessId) => {
    const excluded = input.excluded.includes(process)
      ? input.excluded.filter((item) => item !== process)
      : [...input.excluded, process];

    onChange({ excluded });
  };

  const handleEvent = (value: string) => {
    if (!value) {
      onChange({ eventDate: '', deliveryDate: '' });
      return;
    }

    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() - 5);

    const deliveryDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

    onChange({
      eventDate: value,
      deliveryDate,
    });
  };

  const canSimulate =
    !catalogLoading &&
    !catalogError &&
    Boolean(selectedTemplate) &&
    Boolean(input.eventDate) &&
    Boolean(input.deliveryDate) &&
    input.deliveryDate <= input.eventDate &&
    !simulating;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (catalogLoading) return;

        if (catalogError) return;

        if (!selectedTemplate) return;

        if (!input.eventDate || !input.deliveryDate) return;

        if (input.deliveryDate > input.eventDate) return;

        onSimulate();
      }}
      className="overflow-hidden rounded-2xl border border-line bg-paper"
      aria-label="Datos del contrato para simular capacidad"
    >
      <Section
        number="01"
        title="Datos de la solicitud"
        description="Información general y fechas de planificación."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cliente" htmlFor="sim-client">
            <input
              id="sim-client"
              className={inputClass}
              value={input.client}
              onChange={(event) =>
                onChange({ client: event.target.value })
              }
              placeholder="Nombre de la clienta"
            />
          </Field>

          <Field label="Ciudad" htmlFor="sim-city">
            <input
              id="sim-city"
              className={inputClass}
              value={input.city}
              onChange={(event) =>
                onChange({ city: event.target.value })
              }
              placeholder="Ciudad"
            />
          </Field>

          <Field label="Tipo de vestido" className="sm:col-span-2">
            <Segmented<DressType>
              ariaLabel="Tipo de vestido"
              value={input.type}
              onChange={(value) => onChange({ type: value })}
              options={[
                { value: 'Novia', label: 'Novia' },
                { value: 'Quinceañera', label: 'Quinceañera' },
              ]}
            />
          </Field>

          <Field label="Fecha del evento" htmlFor="sim-event">
            <input
              id="sim-event"
              type="date"
              className={cn(inputClass, 'tabular')}
              value={input.eventDate}
              onChange={(event) => handleEvent(event.target.value)}
              required
            />
          </Field>

          <Field
            label="Fecha máxima de entrega"
            htmlFor="sim-delivery"
            hint="Por defecto, 5 días antes del evento."
          >
            <input
              id="sim-delivery"
              type="date"
              className={cn(inputClass, 'tabular')}
              value={input.deliveryDate}
              onChange={(event) =>
                onChange({ deliveryDate: event.target.value })
              }
              required
            />
          </Field>

          <Field label="Precio del contrato (S/)" htmlFor="sim-price">
            <input
              id="sim-price"
              type="number"
              min={0}
              step={100}
              className={cn(inputClass, 'tabular')}
              value={input.price}
              onChange={(event) =>
                onChange({
                  price: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        number="02"
        title="Ruta de producción"
        description="Selecciona el taller y una ruta registrada en Django."
      >
        <Field label="Taller previsto">
          <Segmented<Workshop>
            ariaLabel="Taller previsto"
            value={input.workshop}
            onChange={handleWorkshop}
            options={[
              { value: 'Taller A', label: 'Taller A · completo' },
              { value: 'Taller C', label: 'Taller C → Taller A' },
            ]}
          />
        </Field>

        {input.workshop === 'Taller C' && (
          <p className="mt-3 rounded-xl bg-cream px-3 py-3 text-xs leading-relaxed text-cocoa">
            La ruta del Taller C se calculará con las operaciones configuradas
            en Django para ese taller. Las horas mostradas dependerán de los
            datos recibidos del catálogo.
          </p>
        )}

        <div className="mt-4">
          <Field label="Vestido / ruta de producción" htmlFor="sim-corte">
            <select
              id="sim-corte"
              className={inputClass}
              value={selectedTemplate?.backendDressId !== undefined
                ? String(selectedTemplate.backendDressId)
                : input.corteId}
              onChange={(event) => handleTemplate(event.target.value)}
              disabled={
                catalogLoading ||
                Boolean(catalogError) ||
                workshopTemplates.length === 0
              }
              required
            >
              {workshopTemplates.length === 0 ? (
                <option value="">
                  No hay rutas disponibles para este taller
                </option>
              ) : (
                workshopTemplates.map((template) => (
                  <option
                    key={`${template.backendRouteId}-${template.backendDressId}`}
                    value={String(template.backendDressId)}
                  >
                    {template.name}
                  </option>
                ))
              )}
            </select>
          </Field>
        </div>

        {catalogLoading && (
          <p className="mt-3 text-sm text-cocoa-muted">
            Cargando rutas desde Django…
          </p>
        )}

        {catalogError && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700"
          >
            No se pudo cargar el catálogo: {catalogError}
          </p>
        )}

        {!catalogLoading && !catalogError && !selectedTemplate && (
          <p className="mt-3 text-sm text-cocoa-muted">
            Selecciona una ruta válida para consultar sus operaciones.
          </p>
        )}

        {selectedTemplate && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-cream/50 p-4">
            <CheckCircle2Icon
              className="mt-0.5 h-5 w-5 shrink-0 text-cocoa"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-cocoa">
                {selectedTemplate.name}
              </p>
              <p className="mt-1 text-xs text-cocoa-muted">
                {selectedTemplate.workshop} · Ruta vinculada al catálogo
                de Django
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section
        number="03"
        title="Procesos requeridos"
        description="Desmarca los procesos que no aplican a este vestido."
      >
        {route.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {route.map((process) => {
              const enabled = !input.excluded.includes(process);

              return (
                <button
                  key={process}
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => toggleProcess(process)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition',
                    enabled
                      ? 'border-nude bg-cream text-cocoa'
                      : 'border-dashed border-line text-cocoa-faint line-through'
                  )}
                >
                  {processName(process)}
                  <span className="font-semibold">
                    {enabled ? fmtH(hours[process] ?? 0) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-cream p-4 text-sm text-cocoa-muted">
            {catalogLoading
              ? 'Cargando las operaciones…'
              : 'Las operaciones aparecerán cuando se cargue una ruta válida.'}
          </p>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Metric label="Horas estimadas de trabajo" value={fmtH(total)} />
          <Metric
            label="Procesos activos"
            value={`${activeCount} procesos`}
          />
        </div>
      </Section>

      <div className="flex flex-col gap-4 bg-cream/60 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-xs text-cocoa-muted">
            Estimación según las operaciones seleccionadas
          </p>
          <p className="mt-1 text-lg font-semibold text-cocoa">
            {fmtH(total)}
            <span className="ml-2 text-sm font-normal text-cocoa-muted">
              en {activeCount} procesos
            </span>
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSimulate}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cocoa px-6 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-[#3a281f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {simulating ? (
            <LoaderCircleIcon
              className="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <SparklesIcon className="h-4 w-4" aria-hidden="true" />
          )}
          {simulating ? 'Calculando…' : 'SIMULAR CAPACIDAD'}
        </button>
      </div>
    </form>
  );
}

function Section({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-6 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream text-xs font-semibold text-cocoa">
          {number}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-cocoa">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-cocoa-muted">
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-xs text-cocoa-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-cocoa">{value}</p>
    </div>
  );
}
