import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { productionApi } from '../services/productionApi';
import type { NoteKind, ProdDress, ProdPriority, ProdWorker } from '../services/productionApi';

/**
 * Datos y acciones de producción conectados a Django.
 * Misma forma que usaban las pantallas con useApp():
 * dresses, workers, completeStep, setCurrentStep, addNote,
 * toggleStepWorker, setStepEstimate, setDeadline.
 */
export function useProduction() {
  const [dresses, setDresses] = useState<ProdDress[]>([]);
  const [workers, setWorkers] = useState<ProdWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, w] = await Promise.all([productionApi.list(), productionApi.workers()]);
      setDresses(d);
      setWorkers(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la producción.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Ejecuta una acción y reemplaza el vestido con la respuesta del backend. */
  const run = async (
    id: string,
    action: () => Promise<{ detail?: string; dress: ProdDress }>,
    successDescription?: string
  ): Promise<boolean> => {
    setBusyId(id);
    try {
      const { dress, detail } = await action();
      setDresses((list) => list.map((d) => (d.id === id ? dress : d)));
      if (detail) toast.success(detail, successDescription ? { description: successDescription } : undefined);
      return true;
    } catch (e) {
      toast.error('No se pudo guardar el cambio.', {
        description: e instanceof Error ? e.message : undefined,
      });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const findCode = (id: string) => dresses.find((d) => d.id === id)?.code;

  return {
    dresses,
    workers,
    loading,
    error,
    busyId,
    reload,
    completeStep: (id: string) => run(id, () => productionApi.completeStep(id), findCode(id)),
    setCurrentStep: (id: string, index: number) => run(id, () => productionApi.setCurrentStep(id, index)),
    setStepEstimate: (id: string, index: number, hours: number) =>
      run(id, () => productionApi.setStepEstimate(id, index, hours)),
    toggleStepWorker: (id: string, index: number, workerId: string) =>
      run(id, () => productionApi.toggleStepWorker(id, index, workerId)),
    setDeadline: (id: string, deadline: string) => run(id, () => productionApi.update(id, { deadline })),
    setPriority: (id: string, priority: ProdPriority) => run(id, () => productionApi.update(id, { priority })),
    addNote: (id: string, text: string, kind: NoteKind) => run(id, () => productionApi.addNote(id, text, kind)),
  };
}

export type ProductionStore = ReturnType<typeof useProduction>;
