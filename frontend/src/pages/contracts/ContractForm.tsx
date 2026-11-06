import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeftIcon,
  BanIcon,
  CalendarRangeIcon,
  CheckIcon,
  ChevronDownIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  TimerIcon,
  Trash2Icon,
  UserRoundCheckIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '../../components/ui/PageHeader';
import {
  ApiError,
  contractsApi,
  ESTADOS_CONTRATO,
  matchCatalogDress,
  METODOS_PAGO,
  TALLER_LABELS,
  TIPOS_EVENTO,
  VESTIDO_EN_TIENDA,
} from '../../services/contractsApi';
import type {
  CatalogoOperacion,
  CatalogoVestido,
  Cliente,
  Contrato,
  ContratoInput,
  ContractPrefill,
  EstadoContrato,
  EstadoVestido,
  MetodoPago,
  Modalidad,
  PlanVestido,
  Taller,
  TipoEvento,
} from '../../services/contractsApi';
import { fmtShort } from '../../utils/dates';
import { ContractPlanModal, planFromReservations } from './ContractPlanModal';

// ============================================================
// ESTADO DEL FORMULARIO
// ============================================================

interface ProcesoDraft {
  plantilla: number;
  horas: string;
  incluido: boolean;
}

interface ItemDraft {
  key: string;
  id?: number;
  codigo?: string;
  estado?: EstadoVestido;
  tipo_vestido: number | null;
  taller: Taller | '';
  modalidad: Modalidad;
  descripcion: string;
  precio: string;
  precio_otros: string;
  /** null = tiempos de la plantilla; lista = tiempos ajustados. */
  procesos: ProcesoDraft[] | null;
  verProcesos: boolean;
}

interface AdelantoDraft {
  importe: string;
  fecha: string;
  metodo: MetodoPago;
  referencia: string;
}

interface FormState {
  numero: string;
  clienteId: number | null;
  cliente: {
    nombre: string;
    documento: string;
    telefono: string;
    direccion: string;
    correo: string;
  };
  serviciosManuales: boolean;
  servicio_alquiler: boolean;
  servicio_venta: boolean;
  servicio_confeccion: boolean;
  tipo_evento: TipoEvento;
  tipo_evento_detalle: string;
  fecha_evento: string;
  fecha_entrega: string;
  fecha_devolucion: string;
  fecha_recojo_fotos: string;
  fecha_devolucion_fotos: string;
  servicio_lavanderia: string;
  garantia: string;
  garantia_detalle: string;
  fecha_firma: string;
  condiciones_pago: string;
  observaciones: string;
  estado: EstadoContrato;
  vestidos: ItemDraft[];
  adelantos: AdelantoDraft[];
}

let keySeq = 0;
const newKey = () => `item-${Date.now()}-${keySeq++}`;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyItem(): ItemDraft {
  return {
    key: newKey(),
    tipo_vestido: null,
    taller: '',
    modalidad: 'VENTA',
    descripcion: '',
    precio: '',
    precio_otros: '',
    procesos: null,
    verProcesos: false,
  };
}

function emptyAdelanto(): AdelantoDraft {
  return { importe: '', fecha: '', metodo: 'EFECTIVO', referencia: '' };
}

function emptyForm(): FormState {
  return {
    numero: '',
    clienteId: null,
    cliente: { nombre: '', documento: '', telefono: '', direccion: '', correo: '' },
    serviciosManuales: false,
    servicio_alquiler: false,
    servicio_venta: false,
    servicio_confeccion: false,
    tipo_evento: 'NOVIA',
    tipo_evento_detalle: '',
    fecha_evento: '',
    fecha_entrega: '',
    fecha_devolucion: '',
    fecha_recojo_fotos: '',
    fecha_devolucion_fotos: '',
    servicio_lavanderia: '',
    garantia: '',
    garantia_detalle: 'DNI original y recibo de agua o luz',
    fecha_firma: today(),
    condiciones_pago: '',
    observaciones: '',
    estado: 'ACTIVO',
    vestidos: [emptyItem()],
    adelantos: [emptyAdelanto(), emptyAdelanto(), emptyAdelanto()],
  };
}

function formFromContract(c: Contrato): FormState {
  const adelantos = [1, 2, 3].map((orden) => {
    const a = c.adelantos.find((x) => x.orden_adelanto === orden);
    return a
      ? { importe: a.importe, fecha: a.fecha, metodo: a.metodo, referencia: a.referencia }
      : emptyAdelanto();
  });

  return {
    numero: c.numero,
    clienteId: c.cliente?.id ?? null,
    cliente: {
      nombre: c.cliente?.nombre ?? '',
      documento: c.cliente?.documento ?? '',
      telefono: c.cliente?.telefono ?? '',
      direccion: c.cliente?.direccion ?? '',
      correo: c.cliente?.correo ?? '',
    },
    serviciosManuales: true,
    servicio_alquiler: c.servicio_alquiler,
    servicio_venta: c.servicio_venta,
    servicio_confeccion: c.servicio_confeccion,
    tipo_evento: c.tipo_evento,
    tipo_evento_detalle: c.tipo_evento_detalle,
    fecha_evento: c.fecha_evento ?? '',
    fecha_entrega: c.fecha_entrega,
    fecha_devolucion: c.fecha_devolucion ?? '',
    fecha_recojo_fotos: c.fecha_recojo_fotos ?? '',
    fecha_devolucion_fotos: c.fecha_devolucion_fotos ?? '',
    servicio_lavanderia: c.servicio_lavanderia,
    garantia: c.garantia,
    garantia_detalle: c.garantia_detalle,
    fecha_firma: c.fecha_firma,
    condiciones_pago: c.condiciones_pago,
    observaciones: c.observaciones,
    estado: c.estado,
    vestidos: c.vestidos.map((v) => ({
      key: newKey(),
      id: v.id,
      codigo: v.codigo,
      estado: v.estado,
      tipo_vestido: v.tipo_vestido,
      taller: v.taller ?? '',
      modalidad: v.modalidad,
      descripcion: v.descripcion,
      precio: v.precio,
      precio_otros: v.precio_otros,
      procesos: v.procesos.some((p) => p.ajustado)
        ? v.procesos.map((p) => ({ plantilla: p.plantilla, horas: p.horas, incluido: p.incluido }))
        : null,
      verProcesos: false,
    })),
    adelantos,
  };
}

function formFromPrefill(p: ContractPrefill, catalog: CatalogoVestido[]): FormState {
  const base = emptyForm();
  return {
    ...base,
    cliente: { ...base.cliente, nombre: p.cliente_nombre ?? '' },
    fecha_evento: p.fecha_evento ?? '',
    fecha_entrega: p.fecha_entrega ?? '',
    vestidos: p.vestidos.map((v) => {
      const dress = matchCatalogDress(catalog, v.corte, v.backendDressId);
      const taller = dress?.rutas.some((r) => r.taller === v.taller) ? v.taller : '';
      return {
        ...emptyItem(),
        verProcesos: taller === 'T',
        tipo_vestido: dress?.id ?? null,
        taller,
        descripcion: dress ? '' : v.corte,
        precio: String(v.precio ?? ''),
      };
    }),
  };
}

// ============================================================
// UTILIDADES
// ============================================================

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const num = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const orNull = (value: string) => (value ? value : null);

function isLocked(item: ItemDraft): boolean {
  return Boolean(item.id && item.estado && item.estado !== 'PENDIENTE');
}

function validate(form: FormState): string | null {
  if (!form.cliente.nombre.trim()) return 'Ingresa el nombre de la clienta.';
  if (!form.fecha_entrega) return 'Ingresa la fecha de recojo del vestido.';
  if (form.fecha_evento && form.fecha_entrega > form.fecha_evento) {
    return 'La fecha de recojo no puede ser posterior a la fecha del evento.';
  }
  if (form.fecha_devolucion && form.fecha_devolucion < form.fecha_entrega) {
    return 'La devolución no puede ser anterior a la fecha de recojo.';
  }
  if (
    form.fecha_recojo_fotos &&
    form.fecha_devolucion_fotos &&
    form.fecha_devolucion_fotos < form.fecha_recojo_fotos
  ) {
    return 'La devolución de la sesión de fotos no puede ser anterior a su recojo.';
  }
  if (form.tipo_evento === 'OTRO' && !form.tipo_evento_detalle.trim()) {
    return 'Indica el tipo de evento.';
  }
  if (form.vestidos.length === 0) return 'Agrega al menos un vestido o ítem.';

  for (const [i, item] of form.vestidos.entries()) {
    const label = `Ítem ${i + 1}`;
    if (!item.tipo_vestido && !item.descripcion.trim()) {
      return `${label}: selecciona el tipo de vestido o escribe una descripción.`;
    }
    if (item.taller && !item.tipo_vestido) {
      return `${label}: para enviarlo al taller selecciona el tipo de vestido.`;
    }
    if (num(item.precio) < 0 || num(item.precio_otros) < 0) {
      return `${label}: los precios no pueden ser negativos.`;
    }
    if (item.procesos?.some((p) => p.horas === '' || num(p.horas) < 0)) {
      return `${label}: revisa las horas de los procesos.`;
    }
  }
  return null;
}

function buildPayload(form: FormState): ContratoInput {
  const cliente = form.cliente;
  return {
    numero: form.numero.trim() || undefined,
    cliente: form.clienteId,
    datos_cliente: {
      nombre: cliente.nombre.trim(),
      documento: cliente.documento.trim(),
      telefono: cliente.telefono.trim(),
      direccion: cliente.direccion.trim(),
      correo: cliente.correo.trim(),
    },
    ...(form.serviciosManuales
      ? {
          servicio_alquiler: form.servicio_alquiler,
          servicio_venta: form.servicio_venta,
          servicio_confeccion: form.servicio_confeccion,
        }
      : {}),
    tipo_evento: form.tipo_evento,
    tipo_evento_detalle: form.tipo_evento === 'OTRO' ? form.tipo_evento_detalle.trim() : '',
    fecha_evento: orNull(form.fecha_evento),
    fecha_entrega: form.fecha_entrega,
    fecha_devolucion: orNull(form.fecha_devolucion),
    fecha_recojo_fotos: orNull(form.fecha_recojo_fotos),
    fecha_devolucion_fotos: orNull(form.fecha_devolucion_fotos),
    servicio_lavanderia: form.servicio_lavanderia.trim(),
    garantia: String(num(form.garantia).toFixed(2)),
    garantia_detalle: form.garantia_detalle.trim(),
    fecha_firma: form.fecha_firma || undefined,
    condiciones_pago: form.condiciones_pago,
    observaciones: form.observaciones,
    vestidos: form.vestidos.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      tipo_vestido: item.tipo_vestido,
      taller: item.taller || null,
      modalidad: item.modalidad,
      descripcion: item.descripcion.trim(),
      precio: num(item.precio).toFixed(2),
      precio_otros: num(item.precio_otros).toFixed(2),
      ...(item.taller && item.procesos
        ? {
            procesos: item.procesos.map((p) => ({
              plantilla: p.plantilla,
              horas: num(p.horas).toFixed(2),
              incluido: p.incluido,
            })),
          }
        : {}),
    })),
    adelantos: form.adelantos.map((a) => ({
      importe: num(a.importe).toFixed(2),
      fecha: orNull(a.fecha),
      metodo: a.metodo,
      referencia: a.referencia.trim(),
    })),
  };
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado.';
}

// ============================================================
// UI BÁSICA (mismo estilo que el simulador)
// ============================================================

const inputCls =
  'w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-cocoa outline-none focus:border-gold-soft focus:ring-2 focus:ring-champagne-soft disabled:cursor-not-allowed disabled:bg-cream disabled:text-cocoa-muted';

function Card({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-cocoa">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-cocoa-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cocoa-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-cocoa-muted">{hint}</span>}
    </label>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
        checked ? 'border-gold-soft bg-champagne-soft text-cocoa' : 'border-line bg-paper text-cocoa-muted hover:bg-cream'
      }`}
      aria-pressed={checked}
    >
      <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-cocoa bg-cocoa text-white' : 'border-nude'}`}>
        {checked && <CheckIcon className="h-3 w-3" />}
      </span>
      {label}
    </button>
  );
}

// ============================================================
// COMPONENTE
// ============================================================

interface ContractFormProps {
  contractId: number | null; // null = nuevo
  prefill?: ContractPrefill | null;
  onBack: () => void;
  onSaved: (contrato: Contrato) => void;
}

type PlanModalState = {
  open: boolean;
  mode: 'preview' | 'saved' | 'current';
  loading: boolean;
  error: string | null;
  plan: PlanVestido[];
};

export function ContractForm({ contractId, prefill, onBack, onSaved }: ContractFormProps) {
  const isEdit = contractId !== null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [original, setOriginal] = useState<Contrato | null>(null);
  const [catalog, setCatalog] = useState<CatalogoVestido[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planModal, setPlanModal] = useState<PlanModalState>({
    open: false, mode: 'preview', loading: false, error: null, plan: [],
  });

  // Búsqueda de clientas
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<Cliente[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<number | undefined>(undefined);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cat, contrato] = await Promise.all([
        contractsApi.catalog(),
        isEdit ? contractsApi.get(contractId) : Promise.resolve(null),
      ]);
      setCatalog(cat);
      if (contrato) {
        setOriginal(contrato);
        setForm(formFromContract(contrato));
      } else if (prefill) {
        setForm(formFromPrefill(prefill, cat));
        toast.success('Datos traídos del simulador.', {
          description: 'Completa los datos de la clienta y revisa los precios.',
        });
      } else {
        setForm(emptyForm());
      }
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientResults([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        setClientResults(await contractsApi.searchClients(q));
      } catch {
        setClientResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(searchTimer.current);
  }, [clientQuery]);

  // ---------------- derivados ----------------

  const dressById = useMemo(() => new Map(catalog.map((d) => [d.id, d])), [catalog]);

  // Cobros extra y pagos que registró la jefa de taller.
  const extras = num(original?.total_cargos ?? '0');
  const otrosPagos = (original?.pagos ?? [])
    .filter((p) => !p.orden_adelanto)
    .reduce((s, p) => s + num(p.importe), 0);
  const total = form.vestidos.reduce((s, v) => s + num(v.precio) + num(v.precio_otros), 0) + extras;
  const pagado = form.adelantos.reduce((s, a) => s + num(a.importe), 0) + otrosPagos;
  const saldo = total - pagado;
  const enTaller = form.vestidos.filter((v) => v.taller).length;

  const servicios = form.serviciosManuales
    ? form
    : {
        servicio_alquiler: form.vestidos.some((v) => v.modalidad === 'ALQUILER'),
        servicio_venta: form.vestidos.some((v) => v.modalidad === 'VENTA'),
        servicio_confeccion: enTaller > 0,
      };

  const readOnly = isEdit && original !== null && ['CANCELADO', 'ENTREGADO'].includes(original.estado);

  // ---------------- edición ----------------

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setCliente = (patch: Partial<FormState['cliente']>) =>
    setForm((f) => ({ ...f, cliente: { ...f.cliente, ...patch } }));

  const setItem = (key: string, patch: Partial<ItemDraft>) =>
    setForm((f) => ({
      ...f,
      vestidos: f.vestidos.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    }));

  const setAdelanto = (index: number, patch: Partial<AdelantoDraft>) =>
    setForm((f) => ({
      ...f,
      adelantos: f.adelantos.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));

  const setServicio = (key: 'servicio_alquiler' | 'servicio_venta' | 'servicio_confeccion', value: boolean) =>
    setForm((f) => ({ ...f, ...servicios, serviciosManuales: true, [key]: value }));

  const addItem = () => setForm((f) => ({ ...f, vestidos: [...f.vestidos, emptyItem()] }));

  const removeItem = (item: ItemDraft) => {
    if (isLocked(item)) {
      toast.error('Este vestido ya tiene avance en el taller y no se puede quitar.');
      return;
    }
    setForm((f) => ({ ...f, vestidos: f.vestidos.filter((v) => v.key !== item.key) }));
  };

  const changeDress = (item: ItemDraft, value: string) => {
    const id = value ? Number(value) : null;
    const dress = id ? dressById.get(id) : undefined;
    const talleres = dress?.rutas.map((r) => r.taller) ?? [];
    const taller = item.taller && talleres.includes(item.taller as Taller) ? item.taller : talleres[0] ?? '';
    setItem(item.key, {
      tipo_vestido: id,
      taller,
      // Al cambiar de vestido se vuelve a los tiempos de su plantilla.
      procesos: null,
      verProcesos: dress?.nombre === VESTIDO_EN_TIENDA || taller === 'T',
    });
  };

  const operacionesDe = (item: ItemDraft): CatalogoOperacion[] => {
    if (!item.tipo_vestido || !item.taller) return [];
    const ruta = dressById.get(item.tipo_vestido)?.rutas.find((r) => r.taller === item.taller);
    return [...(ruta?.operaciones ?? [])].sort((a, b) => a.orden - b.orden || a.id - b.id);
  };

  const procesoDe = (item: ItemDraft, op: CatalogoOperacion): ProcesoDraft =>
    item.procesos?.find((p) => p.plantilla === op.id) ?? {
      plantilla: op.id,
      horas: op.horas_estimadas,
      incluido: true,
    };

  const setProceso = (item: ItemDraft, op: CatalogoOperacion, patch: Partial<ProcesoDraft>) => {
    const base = operacionesDe(item).map((o) => procesoDe(item, o));
    setItem(item.key, {
      procesos: base.map((p) => (p.plantilla === op.id ? { ...p, ...patch } : p)),
    });
  };

  const resetProcesos = (item: ItemDraft) => {
    // Se envía la lista con los tiempos base para borrar los ajustes guardados.
    setItem(item.key, {
      procesos: item.id
        ? operacionesDe(item).map((o) => ({ plantilla: o.id, horas: o.horas_estimadas, incluido: true }))
        : null,
    });
  };

  const horasItem = (item: ItemDraft) =>
    operacionesDe(item).reduce((s, op) => {
      const p = procesoDe(item, op);
      return p.incluido ? s + num(p.horas) : s;
    }, 0);

  const pickClient = (c: Cliente) => {
    setForm((f) => ({
      ...f,
      clienteId: c.id,
      cliente: {
        nombre: c.nombre,
        documento: c.documento,
        telefono: c.telefono,
        direccion: c.direccion,
        correo: c.correo,
      },
    }));
    setClientQuery('');
    setClientResults([]);
  };

  // ---------------- acciones ----------------

  const checkForm = (): ContratoInput | null => {
    const error = validate(form);
    if (error) {
      toast.error(error);
      return null;
    }
    return buildPayload(form);
  };

  const handlePreview = async () => {
    if (isEdit) {
      // Contrato guardado: se muestran las reservas actuales.
      setPlanModal({ open: true, mode: 'current', loading: true, error: null, plan: [] });
      try {
        const data = await contractsApi.planning(contractId);
        setPlanModal((m) => ({ ...m, loading: false, plan: planFromReservations(data) }));
      } catch (error) {
        setPlanModal((m) => ({ ...m, loading: false, error: errorText(error) }));
      }
      return;
    }

    const payload = checkForm();
    if (!payload) return;
    setPlanModal({ open: true, mode: 'preview', loading: true, error: null, plan: [] });
    try {
      const data = await contractsApi.preview(payload);
      setPlanModal((m) => ({ ...m, loading: false, plan: data.planificacion }));
    } catch (error) {
      setPlanModal((m) => ({ ...m, loading: false, error: errorText(error) }));
    }
  };

  const handleSave = async () => {
    const payload = checkForm();
    if (!payload) return;

    setSaving(true);
    try {
      const data = isEdit
        ? await contractsApi.update(contractId, {
            ...payload,
            ...(original && form.estado !== original.estado ? { estado: form.estado } : {}),
          })
        : await contractsApi.create(payload);

      toast.success(data.mensaje, {
        description: data.cliente_creado
          ? `Se registró a ${data.contrato.cliente?.nombre} como nueva clienta.`
          : `Contrato ${data.contrato.numero}`,
      });

      setOriginal(data.contrato);
      setForm(formFromContract(data.contrato));
      onSaved(data.contrato);

      const replanificados = data.planificacion.filter((p) => p.planificado);
      if (replanificados.length > 0) {
        setPlanModal({ open: true, mode: 'saved', loading: false, error: null, plan: data.planificacion });
      } else {
        setPlanModal((m) => ({ ...m, open: false }));
      }
    } catch (error) {
      toast.error('No se pudo guardar el contrato.', { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  const handleReplan = async () => {
    if (!isEdit) return;
    setPlanModal({ open: true, mode: 'saved', loading: true, error: null, plan: [] });
    try {
      const data = await contractsApi.replan(contractId);
      setOriginal(data.contrato);
      setForm(formFromContract(data.contrato));
      setPlanModal((m) => ({ ...m, loading: false, plan: data.planificacion }));
      toast.success(data.mensaje);
    } catch (error) {
      setPlanModal((m) => ({ ...m, loading: false, error: errorText(error) }));
    }
  };

  const handleCancelContract = async () => {
    if (!isEdit || !original) return;
    if (!window.confirm(`¿Cancelar el contrato ${original.numero}? Se liberarán las horas reservadas en el taller.`)) return;
    setSaving(true);
    try {
      const data = await contractsApi.cancel(contractId);
      setOriginal(data.contrato);
      setForm(formFromContract(data.contrato));
      onSaved(data.contrato);
      toast.success('Contrato cancelado. Se liberó la capacidad del taller.');
    } catch (error) {
      toast.error('No se pudo cancelar el contrato.', { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  // ---------------- render ----------------

  if (loading) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-line bg-paper p-4 text-sm text-cocoa-muted">
        <RefreshCwIcon className="h-5 w-5 animate-spin" />
        {isEdit ? 'Cargando contrato…' : 'Cargando catálogo desde Django…'}
      </section>
    );
  }

  if (loadError) {
    return (
      <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">No se pudo cargar la información</p>
        <p className="mt-1">{loadError}</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 font-medium hover:bg-red-100">
            <RefreshCwIcon className="h-4 w-4" /> Reintentar
          </button>
          <button type="button" onClick={onBack} className="rounded-lg border border-red-300 px-3 py-2 font-medium hover:bg-red-100">
            Volver
          </button>
        </div>
      </section>
    );
  }

  const busy = saving || planModal.loading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? `Contrato ${original?.numero ?? ''}` : 'Nuevo contrato'}
        subtitle={
          isEdit
            ? `Contrato de locación de servicios · ${original?.origen === 'SIMULADOR' ? 'Generado desde el simulador' : 'Registrado manualmente'}`
            : 'Contrato de locación de servicios. Al guardarlo se reservan automáticamente las horas del taller.'
        }
      />

      {/* Barra de acciones */}
      <section className="sticky top-0 z-20 rounded-2xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream">
            <ArrowLeftIcon className="h-4 w-4" /> Contratos
          </button>

          <button type="button" onClick={addItem} disabled={readOnly || busy} className="inline-flex items-center gap-2 rounded-xl border border-gold-soft bg-paper px-4 py-3 text-sm font-semibold text-cocoa hover:bg-champagne-soft disabled:cursor-not-allowed disabled:opacity-50">
            <PlusIcon className="h-4 w-4" /> Agregar vestido
          </button>

          <button type="button" onClick={() => void handlePreview()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50">
            <CalendarRangeIcon className="h-4 w-4" />
            {isEdit ? 'Ver planificación' : 'Revisar taller'}
          </button>

          {isEdit && !readOnly && (
            <button type="button" onClick={() => void handleReplan()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-cocoa hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50">
              <SparklesIcon className="h-4 w-4" /> Replanificar
            </button>
          )}

          <button type="button" onClick={() => void handleSave()} disabled={readOnly || busy} className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-3 text-sm font-semibold text-white hover:bg-[#3a281f] disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <RefreshCwIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar contrato'}
          </button>

          <div className="ml-auto text-right">
            <p className="text-xs text-cocoa-muted">Monto total</p>
            <p className="text-lg font-semibold text-cocoa">{money.format(total)}</p>
          </div>
        </div>
      </section>

      {readOnly && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Este contrato está {original?.estado_display.toLowerCase()} y solo se puede consultar.
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(280px,4fr)]">
        <fieldset disabled={readOnly} className="min-w-0 space-y-6">
          {/* 1. Clienta */}
          <Card
            title="Datos de la clienta"
            subtitle="Si la novia no está registrada se crea automáticamente al guardar. Si el DNI ya existe, se usa su ficha."
            right={
              form.clienteId ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
                  <UserRoundCheckIcon className="h-3.5 w-3.5" /> Clienta registrada
                  <button type="button" className="ml-1 underline" onClick={() => set('clienteId', null)}>cambiar</button>
                </span>
              ) : (
                <span className="rounded-full bg-champagne-soft px-3 py-1 text-xs font-semibold text-cocoa">Nueva o por DNI</span>
              )
            }
          >
            {!form.clienteId && (
              <div className="relative mb-4">
                <SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-cocoa-muted" />
                <input
                  className={`${inputCls} pl-9`}
                  placeholder="Buscar clienta existente por nombre, DNI o celular…"
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                />
                {(clientResults.length > 0 || searching) && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-paper shadow-lg">
                    {searching && <p className="px-3 py-2 text-xs text-cocoa-muted">Buscando…</p>}
                    {clientResults.map((c) => (
                      <button key={c.id} type="button" onClick={() => pickClient(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-cream">
                        <span className="font-semibold text-cocoa">{c.nombre}</span>
                        <span className="ml-2 text-xs text-cocoa-muted">
                          DNI {c.documento || '—'} · {c.telefono || 'sin celular'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre completo *" className="sm:col-span-2">
                <input className={inputCls} value={form.cliente.nombre} onChange={(e) => setCliente({ nombre: e.target.value })} />
              </Field>
              <Field label="DNI">
                <input className={inputCls} inputMode="numeric" value={form.cliente.documento} onChange={(e) => setCliente({ documento: e.target.value })} />
              </Field>
              <Field label="Celular">
                <input className={inputCls} inputMode="tel" value={form.cliente.telefono} onChange={(e) => setCliente({ telefono: e.target.value })} />
              </Field>
              <Field label="Domicilio" className="sm:col-span-2">
                <input className={inputCls} value={form.cliente.direccion} onChange={(e) => setCliente({ direccion: e.target.value })} />
              </Field>
              <Field label="Correo" className="sm:col-span-2">
                <input className={inputCls} type="email" value={form.cliente.correo} onChange={(e) => setCliente({ correo: e.target.value })} />
              </Field>
            </div>
          </Card>

          {/* 2. Objeto del contrato */}
          <Card title="I. Objeto del contrato" subtitle={form.serviciosManuales ? undefined : 'Los servicios se marcan solos según los vestidos; puedes cambiarlos.'}>
            <div className="flex flex-wrap gap-2">
              <Check label="Alquiler" checked={servicios.servicio_alquiler} onChange={(v) => setServicio('servicio_alquiler', v)} />
              <Check label="Venta" checked={servicios.servicio_venta} onChange={(v) => setServicio('servicio_venta', v)} />
              <Check label="Confección personalizada" checked={servicios.servicio_confeccion} onChange={(v) => setServicio('servicio_confeccion', v)} />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Tipo de vestido / evento">
                <div className="flex flex-wrap gap-2">
                  {TIPOS_EVENTO.map((t) => (
                    <Check key={t.value} label={t.label} checked={form.tipo_evento === t.value} onChange={() => set('tipo_evento', t.value)} />
                  ))}
                </div>
              </Field>
              {form.tipo_evento === 'OTRO' ? (
                <Field label="¿Qué evento? *">
                  <input className={inputCls} value={form.tipo_evento_detalle} onChange={(e) => set('tipo_evento_detalle', e.target.value)} placeholder="Promoción, gala, civil…" />
                </Field>
              ) : <div />}

              <Field label="Fecha del evento">
                <input type="date" className={inputCls} value={form.fecha_evento} onChange={(e) => set('fecha_evento', e.target.value)} />
              </Field>
              <Field label="Fecha de recojo del vestido *" hint="Es la fecha límite para el taller.">
                <input type="date" className={inputCls} value={form.fecha_entrega} onChange={(e) => set('fecha_entrega', e.target.value)} />
              </Field>
              <Field label="Alquiler: devolución del vestido y accesorios">
                <input type="date" className={inputCls} value={form.fecha_devolucion} onChange={(e) => set('fecha_devolucion', e.target.value)} />
              </Field>
              <Field label="Fecha del contrato">
                <input type="date" className={inputCls} value={form.fecha_firma} onChange={(e) => set('fecha_firma', e.target.value)} />
              </Field>
              <Field label="Sesión de fotos: recojo">
                <input type="date" className={inputCls} value={form.fecha_recojo_fotos} onChange={(e) => set('fecha_recojo_fotos', e.target.value)} />
              </Field>
              <Field label="Sesión de fotos: devolución">
                <input type="date" className={inputCls} value={form.fecha_devolucion_fotos} onChange={(e) => set('fecha_devolucion_fotos', e.target.value)} />
              </Field>
              <Field label="Servicio de lavandería" className="sm:col-span-2">
                <input className={inputCls} value={form.servicio_lavanderia} onChange={(e) => set('servicio_lavanderia', e.target.value)} placeholder="Solo si aplica" />
              </Field>
            </div>
          </Card>

          {/* 3. Vestidos */}
          <Card
            title="Vestidos e ítems"
            subtitle="Cada vestido con taller reserva horas automáticamente. Usa «Vestido en tienda» para vestidos de stock que solo se modifican, y «Sin taller» para accesorios."
            right={<span className="rounded-full bg-champagne-soft px-3 py-1 text-xs font-semibold text-cocoa">{form.vestidos.length}</span>}
          >
            <div className="space-y-3">
              {form.vestidos.map((item, index) => {
                const locked = isLocked(item);
                const dress = item.tipo_vestido ? dressById.get(item.tipo_vestido) : undefined;
                const talleres = dress?.rutas ?? [];
                return (
                  <div key={item.key} className={`rounded-xl border p-4 ${locked ? 'border-line bg-cream/60' : 'border-line bg-cream/30'}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-cocoa">
                        Ítem {index + 1}
                        {item.codigo && <span className="ml-2 text-xs font-normal text-cocoa-muted">{item.codigo}</span>}
                        {locked && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-cocoa-muted">
                            <LockIcon className="h-3 w-3" /> {item.estado === 'FINALIZADO' ? 'Finalizado' : 'En proceso'}
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(item)}
                        disabled={locked}
                        className="rounded-lg p-2 text-cocoa-muted hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        aria-label={`Quitar ítem ${index + 1}`}
                        title={locked ? 'Tiene avance en el taller' : 'Quitar ítem'}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-6">
                      <Field label="Tipo de vestido" className="sm:col-span-2">
                        <select className={inputCls} value={item.tipo_vestido ?? ''} disabled={locked} onChange={(e) => changeDress(item, e.target.value)}>
                          <option value="">— Accesorio / otro —</option>
                          {catalog.map((d) => (
                            <option key={d.id} value={d.id}>{d.nombre}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Taller" className="sm:col-span-2">
                        <select className={inputCls} value={item.taller} disabled={locked || !item.tipo_vestido} onChange={(e) => setItem(item.key, { taller: e.target.value as Taller | '', procesos: null })}>
                          <option value="">Sin taller</option>
                          {talleres.map((r) => (
                            <option key={r.id} value={r.taller}>
                              {TALLER_LABELS[r.taller] ?? `Taller ${r.taller}`}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Modalidad" className="sm:col-span-2">
                        <select className={inputCls} value={item.modalidad} onChange={(e) => setItem(item.key, { modalidad: e.target.value as Modalidad })}>
                          <option value="VENTA">Venta</option>
                          <option value="ALQUILER">Alquiler</option>
                        </select>
                      </Field>
                      <Field label="Descripción" className="sm:col-span-6">
                        <input className={inputCls} value={item.descripcion} onChange={(e) => setItem(item.key, { descripcion: e.target.value })} placeholder={dress ? `${dress.nombre} — detalles, color, talla…` : 'Velo, tocado, corona…'} />
                      </Field>
                      <Field label={item.modalidad === 'ALQUILER' ? 'Precio alquiler (S/)' : 'Precio venta (S/)'} className="sm:col-span-2">
                        <input type="number" min="0" step="0.01" className={inputCls} value={item.precio} onChange={(e) => setItem(item.key, { precio: e.target.value })} />
                      </Field>
                      <Field label="Otros (S/)" className="sm:col-span-2">
                        <input type="number" min="0" step="0.01" className={inputCls} value={item.precio_otros} onChange={(e) => setItem(item.key, { precio_otros: e.target.value })} />
                      </Field>
                      <div className="flex items-end sm:col-span-2">
                        <p className="w-full rounded-xl bg-paper px-3 py-2.5 text-right text-sm font-semibold text-cocoa">
                          {money.format(num(item.precio) + num(item.precio_otros))}
                        </p>
                      </div>
                    </div>

                    {item.taller && operacionesDe(item).length > 0 && (
                      <div className="mt-3 rounded-xl border border-line bg-paper">
                        <button
                          type="button"
                          onClick={() => setItem(item.key, { verProcesos: !item.verProcesos })}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm"
                          aria-expanded={item.verProcesos}
                        >
                          <span className="inline-flex items-center gap-2 font-semibold text-cocoa">
                            <TimerIcon className="h-4 w-4" />
                            Procesos y tiempos
                            {item.procesos && (
                              <span className="rounded-full bg-champagne-soft px-2 py-0.5 text-xs font-medium">Ajustado</span>
                            )}
                          </span>
                          <span className="inline-flex items-center gap-2 text-xs text-cocoa-muted">
                            {horasItem(item).toFixed(2)} h
                            <ChevronDownIcon className={`h-4 w-4 transition ${item.verProcesos ? 'rotate-180' : ''}`} />
                          </span>
                        </button>

                        {item.verProcesos && (
                          <div className="border-t border-line px-3 pb-3">
                            <p className="py-2 text-xs text-cocoa-muted">
                              Ajusta las horas solo para este vestido o desmarca los procesos que no aplican.
                              Los tiempos generales del catálogo no cambian.
                            </p>
                            <div className="space-y-1.5">
                              {operacionesDe(item).map((op) => {
                                const p = procesoDe(item, op);
                                const cambiado = !p.incluido || num(p.horas) !== num(op.horas_estimadas);
                                return (
                                  <div key={op.id} className={`grid grid-cols-[auto_1fr_110px] items-center gap-3 rounded-lg px-2 py-1.5 ${p.incluido ? '' : 'opacity-50'}`}>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 accent-[#4A3428]"
                                      checked={p.incluido}
                                      disabled={locked}
                                      onChange={(e) => setProceso(item, op, { incluido: e.target.checked })}
                                      aria-label={`Incluir ${op.nombre}`}
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm capitalize text-cocoa">{op.nombre}</p>
                                      <p className="text-xs text-cocoa-muted">
                                        {op.tipo_tiempo === 'ESPERA' ? 'Espera' : 'Trabajo'} · base {num(op.horas_estimadas).toFixed(2)} h
                                        {cambiado && <span className="ml-1 font-semibold text-gold">· ajustado</span>}
                                      </p>
                                    </div>
                                    <div className="relative">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        className={`${inputCls} pr-7 text-right`}
                                        value={p.horas}
                                        disabled={locked || !p.incluido}
                                        onChange={(e) => setProceso(item, op, { horas: e.target.value })}
                                        aria-label={`Horas de ${op.nombre}`}
                                      />
                                      <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-cocoa-muted">h</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {item.procesos && !locked && (
                              <button type="button" onClick={() => resetProcesos(item)} className="mt-2 text-xs font-semibold text-cocoa underline">
                                Volver a los tiempos del catálogo
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {form.vestidos.length === 0 && (
                <p className="rounded-xl border border-dashed border-nude p-5 text-center text-sm text-cocoa-muted">No hay ítems en el contrato.</p>
              )}

              <button type="button" onClick={addItem} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gold-soft px-4 py-3 text-sm font-semibold text-cocoa hover:bg-champagne-soft/40">
                <PlusIcon className="h-4 w-4" /> Agregar otro vestido o ítem
              </button>
            </div>
          </Card>

          {/* 4. Montos */}
          <Card title="Monto, adelantos y garantía" subtitle="Los adelantos se registran como pagos confirmados del contrato.">
            <div className="space-y-3">
              {form.adelantos.map((a, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-4">
                  <Field label={['Primer adelanto', 'Segundo adelanto', 'Tercer adelanto'][i]}>
                    <input type="number" min="0" step="0.01" className={inputCls} value={a.importe} onChange={(e) => setAdelanto(i, { importe: e.target.value })} placeholder="0.00" />
                  </Field>
                  <Field label="Fecha">
                    <input type="date" className={inputCls} value={a.fecha} onChange={(e) => setAdelanto(i, { fecha: e.target.value })} />
                  </Field>
                  <Field label="Método">
                    <select className={inputCls} value={a.metodo} onChange={(e) => setAdelanto(i, { metodo: e.target.value as MetodoPago })}>
                      {METODOS_PAGO.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="N.º operación">
                    <input className={inputCls} value={a.referencia} onChange={(e) => setAdelanto(i, { referencia: e.target.value })} />
                  </Field>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
              <Field label="Garantía (S/)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.garantia} onChange={(e) => set('garantia', e.target.value)} />
              </Field>
              <Field label="Detalle de la garantía" hint="Se entrega en el recojo del vestido." className="sm:col-span-2">
                <input className={inputCls} value={form.garantia_detalle} onChange={(e) => set('garantia_detalle', e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* 5. Otros */}
          <Card title="Otros datos">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="N.º de contrato" hint={isEdit ? 'Si lo cambias, se renombran los códigos de los vestidos.' : 'Vacío = se genera automáticamente.'}>
                <input className={inputCls} value={form.numero} onChange={(e) => set('numero', e.target.value)} placeholder="CT-2026-0001" />
              </Field>
              {isEdit ? (
                <Field label="Estado">
                  <select className={inputCls} value={form.estado} onChange={(e) => set('estado', e.target.value as EstadoContrato)}>
                    {ESTADOS_CONTRATO.filter((e) => e.value !== 'CANCELADO').map((e) => (
                      <option key={e.value} value={e.value}>{e.label}</option>
                    ))}
                    {form.estado === 'CANCELADO' && <option value="CANCELADO">Cancelado</option>}
                  </select>
                </Field>
              ) : <div />}
              <Field label="Condiciones de pago" className="sm:col-span-2">
                <textarea rows={2} className={inputCls} value={form.condiciones_pago} onChange={(e) => set('condiciones_pago', e.target.value)} />
              </Field>
              <Field label="Observaciones" className="sm:col-span-2">
                <textarea rows={3} className={inputCls} value={form.observaciones} onChange={(e) => set('observaciones', e.target.value)} />
              </Field>
            </div>
          </Card>
        </fieldset>

        {/* Resumen */}
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-28">
          <section className="rounded-2xl border border-line bg-paper p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold text-cocoa">Resumen</h2>
              {original && (
                <span className="rounded-full bg-champagne-soft px-3 py-1 text-xs font-semibold text-cocoa">{original.estado_display}</span>
              )}
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Clienta" value={form.cliente.nombre || '—'} />
              <Row label="Evento" value={`${TIPOS_EVENTO.find((t) => t.value === form.tipo_evento)?.label}${form.fecha_evento ? ` · ${fmtShort(form.fecha_evento)}` : ''}`} />
              <Row label="Recojo" value={form.fecha_entrega ? fmtShort(form.fecha_entrega) : '—'} />
              <Row label="Ítems / en taller" value={`${form.vestidos.length} / ${enTaller}`} />
            </dl>

            <div className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              {extras > 0 && <Row label="Cobros extra (taller)" value={money.format(extras)} />}
              <Row label="Monto total" value={money.format(total)} strong />
              <Row label="Adelantos" value={money.format(pagado - otrosPagos)} />
              {otrosPagos > 0 && <Row label="Pagos recibidos en taller" value={money.format(otrosPagos)} />}
              <Row label="Saldo" value={money.format(saldo)} strong />
              {num(form.garantia) > 0 && <Row label="Garantía" value={money.format(num(form.garantia))} />}
            </div>

            {saldo < 0 && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">Los pagos superan el monto total.</p>
            )}
          </section>

          {original && original.cargos_adicionales.length > 0 && (
            <section className="rounded-2xl border border-line bg-paper p-5">
              <h3 className="font-display text-lg font-semibold text-cocoa">Cobros extra del taller</h3>
              <p className="mt-1 text-xs text-cocoa-muted">Modificaciones pedidas por la clienta. Ya están sumadas al monto total.</p>
              <ul className="mt-3 space-y-2">
                {original.cargos_adicionales.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-cream/50 p-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-cocoa">{c.concepto}</p>
                      <p className="text-cocoa-muted">{c.vestido_codigo} · {fmtShort(c.fecha)}</p>
                    </div>
                    <span className="whitespace-nowrap font-semibold text-cocoa">+{money.format(num(c.monto))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {original && original.vestidos.some((v) => v.taller) && (
            <section className="rounded-2xl border border-line bg-paper p-5">
              <h3 className="font-display text-lg font-semibold text-cocoa">Taller</h3>
              <div className="mt-3 space-y-2">
                {original.vestidos.filter((v) => v.taller).map((v) => {
                  const tarde = v.fecha_fin_estimada && v.fecha_fin_estimada > original.fecha_entrega;
                  return (
                    <div key={v.id} className="rounded-xl border border-line bg-cream/50 p-3 text-xs">
                      <p className="font-semibold text-cocoa">{v.codigo} · {v.tipo_vestido_nombre}</p>
                      <p className="text-cocoa-muted">{v.taller === "T" ? "Tienda" : `Taller ${v.taller}`} · {v.estado_display}</p>
                      <p className={tarde || Number(v.horas_sin_asignar) > 0 ? 'text-amber-800' : 'text-cocoa-muted'}>
                        Fin estimado: {v.fecha_fin_estimada ? fmtShort(v.fecha_fin_estimada) : '—'}
                        {Number(v.horas_sin_asignar) > 0 && ` · ${v.horas_sin_asignar} h sin asignar`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {isEdit && original && !readOnly && (
            <button type="button" onClick={() => void handleCancelContract()} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <BanIcon className="h-4 w-4" /> Cancelar contrato
            </button>
          )}
        </aside>
      </div>

      <ContractPlanModal
        open={planModal.open}
        loading={planModal.loading}
        error={planModal.error}
        plan={planModal.plan}
        onClose={() => setPlanModal((m) => ({ ...m, open: false }))}
        title={
          planModal.mode === 'preview'
            ? 'Planificación del taller'
            : planModal.mode === 'saved'
              ? 'Taller planificado'
              : 'Planificación actual'
        }
        subtitle={
          planModal.mode === 'preview'
            ? `${enTaller} vestido(s) en taller · Vista previa, todavía no se guardó nada`
            : 'Horas reservadas a las trabajadoras'
        }
        footerNote={
          planModal.mode === 'preview'
            ? 'Al guardar se crean el contrato, la clienta (si es nueva) y las reservas del taller.'
            : 'Las reservas ya están registradas y descuentan capacidad del taller.'
        }
        actions={
          planModal.mode === 'preview' && !planModal.loading && !planModal.error ? (
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-cocoa px-4 py-3 text-sm font-semibold text-white hover:bg-[#3a281f] disabled:opacity-50">
              <SaveIcon className="h-4 w-4" /> {saving ? 'Guardando…' : 'Confirmar y guardar'}
            </button>
          ) : null
        }
      />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-cocoa-muted">{label}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-cocoa' : 'text-cocoa'}`}>{value}</dd>
    </div>
  );
}
