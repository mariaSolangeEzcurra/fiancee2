
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { dressSeeds } from '../data/dresses';
import { financeDefaults } from '../data/finance';
import { timeTemplates } from '../data/processes';
import { seedTimeLogs } from '../data/timeLogs';
import { workers as seedWorkers } from '../data/workers';

import {
  ContractInput,
  Dress,
  FinanceSettings,
  NoteKind,
  ProcessHours,
  ProcessId,
  TimeLog,
  TimeTemplate,
  Worker,
} from '../types';

import { TODAY, toISO } from '../utils/dates';
import { buildDress, createDressFromContract } from '../utils/dresses';
import { round1 } from '../utils/format';

import { getCatalogoSimulador } from '../services/core';
import { catalogToTemplates } from '../services/catalogAdapter';

interface WorkSession {
  shiftStart: Date | null;
  task: {
    dressId: string;
    process: ProcessId;
    start: Date;
  } | null;
}

export type CatalogStatus = 'loading' | 'connected' | 'error';

interface AppContextValue {
  dresses: Dress[];
  workers: Worker[];
  logs: TimeLog[];
  templates: TimeTemplate[];
  finance: FinanceSettings;
  session: WorkSession;
  currentWorkerId: string;

  catalogStatus: CatalogStatus;
  catalogError: string | null;
  refreshCatalog: () => Promise<void>;

  acceptContract: (
    input: ContractInput,
    hours: ProcessHours,
    priority: Dress['priority']
  ) => Dress;

  completeStep: (dressId: string) => void;
  setCurrentStep: (dressId: string, index: number) => void;
  addNote: (
    dressId: string,
    text: string,
    kind: NoteKind,
    author: string
  ) => void;

  toggleStepWorker: (
    dressId: string,
    stepIndex: number,
    workerId: string
  ) => void;

  setStepEstimate: (
    dressId: string,
    stepIndex: number,
    hours: number
  ) => void;

  setDeadline: (dressId: string, date: string) => void;
  addLog: (log: Omit<TimeLog, 'id'>) => void;

  updateTemplateHours: (
    templateId: string,
    process: ProcessId,
    hours: number
  ) => void;

  updateFinance: (patch: Partial<FinanceSettings>) => void;

  startShift: () => void;
  endShift: () => void;
  startTask: (dressId: string, process: ProcessId) => void;
  finishTask: (note: string) => TimeLog | null;
}

const AppContext = createContext<AppContextValue | null>(null);

const hhmm = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;

export function AppProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Estos datos siguen siendo locales hasta conectar sus endpoints.
  const [workers] = useState<Worker[]>(seedWorkers);

  const [templates, setTemplates] =
    useState<TimeTemplate[]>(timeTemplates);

  const [dresses, setDresses] = useState<Dress[]>(() =>
    dressSeeds.map((seed, index) =>
      buildDress(seed, timeTemplates, seedWorkers, index)
    )
  );

  const [logs, setLogs] = useState<TimeLog[]>(seedTimeLogs);
  const [finance, setFinance] =
    useState<FinanceSettings>(financeDefaults);

  const [session, setSession] = useState<WorkSession>({
    shiftStart: null,
    task: null,
  });

  const [catalogStatus, setCatalogStatus] =
    useState<CatalogStatus>('loading');

  const [catalogError, setCatalogError] =
    useState<string | null>(null);

  const currentWorkerId = 'w5';

  /**
   * Descarga el catálogo desde Django.
   * Si falla, conserva las plantillas locales y expone el error
   * para que la interfaz pueda mostrar el estado de conexión.
   */
  const refreshCatalog = useCallback(async () => {
    setCatalogStatus('loading');
    setCatalogError(null);

    try {
      const catalog = await getCatalogoSimulador();
      const backendTemplates = catalogToTemplates(catalog);

      if (backendTemplates.length === 0) {
        throw new Error(
          'Django respondió, pero no devolvió plantillas de operaciones.'
        );
      }

      const backendIds = new Set(
        backendTemplates.map((template) => template.id)
      );

      const fallbackTemplates = timeTemplates.filter(
        (template) => !backendIds.has(template.id)
      );

      setTemplates([
        ...backendTemplates,
        ...fallbackTemplates,
      ]);

      setCatalogStatus('connected');
      setCatalogError(null);
    } catch (error: unknown) {
      setCatalogStatus('error');

      setCatalogError(
        error instanceof Error
          ? error.message
          : 'No se pudo cargar el catálogo desde Django.'
      );
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const updateDress = useCallback(
    (id: string, fn: (dress: Dress) => Dress) => {
      setDresses((current) =>
        current.map((dress) =>
          dress.id === id ? fn(dress) : dress
        )
      );
    },
    []
  );

  const acceptContract = useCallback(
    (
      input: ContractInput,
      hours: ProcessHours,
      priority: Dress['priority']
    ) => {
      const dress = createDressFromContract(
        input,
        hours,
        workers,
        dresses,
        priority
      );

      setDresses((current) => [...current, dress]);

      return dress;
    },
    [dresses, workers]
  );

  const completeStep = useCallback(
    (dressId: string) =>
      updateDress(dressId, (dress) => {
        const steps = dress.steps.map((step, index) =>
          index === dress.currentIndex
            ? {
                ...step,
                done: true,
                workedHours: Math.max(
                  step.workedHours,
                  step.process === 'entrega' ? 0 : step.workedHours
                ),
              }
            : step
        );

        const isLast =
          dress.currentIndex >= dress.steps.length - 1;

        return {
          ...dress,
          steps,
          currentIndex: isLast
            ? dress.currentIndex
            : dress.currentIndex + 1,
          status: isLast ? 'Terminado' : 'En producción',
          isNew: false,
        };
      }),
    [updateDress]
  );

  const setCurrentStep = useCallback(
    (dressId: string, index: number) =>
      updateDress(dressId, (dress) => ({
        ...dress,
        currentIndex: index,
        status: 'En producción',
        isNew: false,
        steps: dress.steps.map((step, stepIndex) => ({
          ...step,
          done: stepIndex < index,
        })),
      })),
    [updateDress]
  );

  const addNote = useCallback(
    (
      dressId: string,
      text: string,
      kind: NoteKind,
      author: string
    ) =>
      updateDress(dressId, (dress) => ({
        ...dress,
        notes: [
          {
            id: `${dressId}-${Date.now()}`,
            date: toISO(TODAY),
            author,
            text,
            kind,
          },
          ...dress.notes,
        ],
      })),
    [updateDress]
  );

  const toggleStepWorker = useCallback(
    (
      dressId: string,
      stepIndex: number,
      workerId: string
    ) =>
      updateDress(dressId, (dress) => ({
        ...dress,
        steps: dress.steps.map((step, index) =>
          index === stepIndex
            ? {
                ...step,
                workerIds: step.workerIds.includes(workerId)
                  ? step.workerIds.filter(
                      (id) => id !== workerId
                    )
                  : [...step.workerIds, workerId],
              }
            : step
        ),
      })),
    [updateDress]
  );

  const setStepEstimate = useCallback(
    (
      dressId: string,
      stepIndex: number,
      hours: number
    ) =>
      updateDress(dressId, (dress) => ({
        ...dress,
        steps: dress.steps.map((step, index) =>
          index === stepIndex
            ? {
                ...step,
                estHours: Math.max(0, hours),
              }
            : step
        ),
      })),
    [updateDress]
  );

  const setDeadline = useCallback(
    (dressId: string, date: string) =>
      updateDress(dressId, (dress) => ({
        ...dress,
        deadline: date,
      })),
    [updateDress]
  );

  const addLog = useCallback(
    (log: Omit<TimeLog, 'id'>) => {
      setLogs((current) => [
        { ...log, id: `log-${Date.now()}` },
        ...current,
      ]);

      updateDress(log.dressId, (dress) => {
        let index = dress.steps.findIndex(
          (step) =>
            step.process === log.process && !step.done
        );

        if (index < 0) {
          index = dress.steps.findIndex(
            (step) => step.process === log.process
          );
        }

        if (index < 0) return dress;

        return {
          ...dress,
          status:
            dress.status === 'En cola'
              ? 'En producción'
              : dress.status,
          steps: dress.steps.map((step, stepIndex) =>
            stepIndex === index
              ? {
                  ...step,
                  workedHours: round1(
                    step.workedHours + log.hours
                  ),
                }
              : step
          ),
        };
      });
    },
    [updateDress]
  );

  const updateTemplateHours = useCallback(
    (
      templateId: string,
      process: ProcessId,
      hours: number
    ) => {
      setTemplates((current) =>
        current.map((template) => {
          if (template.id !== templateId) return template;

          const next = { ...template.hours };

          if (hours > 0) {
            next[process] = hours;
          } else {
            delete next[process];
          }

          return {
            ...template,
            hours: next,
          };
        })
      );
    },
    []
  );

  const updateFinance = useCallback(
    (patch: Partial<FinanceSettings>) =>
      setFinance((current) => ({
        ...current,
        ...patch,
      })),
    []
  );

  const startShift = useCallback(
    () => setSession({ shiftStart: new Date(), task: null }),
    []
  );

  const endShift = useCallback(
    () => setSession({ shiftStart: null, task: null }),
    []
  );

  const startTask = useCallback(
    (dressId: string, process: ProcessId) =>
      setSession((current) => ({
        ...current,
        task: {
          dressId,
          process,
          start: new Date(),
        },
      })),
    []
  );

  const finishTask = useCallback(
    (note: string) => {
      const task = session.task;

      if (!task) return null;

      const end = new Date();

      const elapsedHours = Math.max(
        1 / 60,
        (end.getTime() - task.start.getTime()) / 3600000
      );

      const log: TimeLog = {
        id: `log-${Date.now()}`,
        workerId: currentWorkerId,
        dressId: task.dressId,
        process: task.process,
        date: toISO(TODAY),
        start: hhmm(task.start),
        end: hhmm(end),
        hours: Math.round(elapsedHours * 100) / 100,
        note,
      };

      addLog(log);
      setSession((current) => ({
        ...current,
        task: null,
      }));

      return log;
    },
    [session.task, addLog, currentWorkerId]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      dresses,
      workers,
      logs,
      templates,
      finance,
      session,
      currentWorkerId,

      catalogStatus,
      catalogError,
      refreshCatalog,

      acceptContract,
      completeStep,
      setCurrentStep,
      addNote,
      toggleStepWorker,
      setStepEstimate,
      setDeadline,
      addLog,
      updateTemplateHours,
      updateFinance,
      startShift,
      endShift,
      startTask,
      finishTask,
    }),
    [
      dresses,
      workers,
      logs,
      templates,
      finance,
      session,
      currentWorkerId,
      catalogStatus,
      catalogError,
      refreshCatalog,
      acceptContract,
      completeStep,
      setCurrentStep,
      addNote,
      toggleStepWorker,
      setStepEstimate,
      setDeadline,
      addLog,
      updateTemplateHours,
      updateFinance,
      startShift,
      endShift,
      startTask,
      finishTask,
    ]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }

  return context;
}

export function workerWeekHours(
  worker: Worker,
  logs: TimeLog[]
): number {
  return (
    worker.loggedBase +
    logs
      .filter(
        (log) => log.workerId === worker.id && !log.seed
      )
      .reduce((sum, log) => sum + log.hours, 0)
  );
}
