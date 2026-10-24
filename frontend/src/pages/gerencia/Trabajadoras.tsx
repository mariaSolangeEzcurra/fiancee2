
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  CalendarClock,
  CalendarOff,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Filter,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";

import {
  DIAS,
  formatoHoras,
  useTrabajadoras,
  type Trabajadora,
  type VistaPersonal,
} from "../../hooks/useTrabajadoras";

const inputClass =
  "w-full min-w-0 rounded-xl border border-[#E8DFD8] bg-white px-3.5 py-2.5 text-sm text-[#44352D] outline-none transition placeholder:text-[#A99B91] focus:border-[#BD9270] focus:ring-2 focus:ring-[#BD9270]/15";

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#49372D] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#624B3D] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8DFD8] bg-white px-3.5 py-2.5 text-sm font-medium text-[#59463A] transition hover:bg-[#FAF6F2] disabled:opacity-50";

const cardClass =
  "rounded-2xl border border-[#EDE5DF] bg-white p-4 shadow-[0_2px_12px_rgba(60,40,25,0.025)] sm:p-5";

type ModalType = "personal" | "horario" | "ausencia" | null;

const tabs: {
  id: VistaPersonal;
  label: string;
  icon: typeof Users;
}[] = [
  { id: "trabajadoras", label: "Personal", icon: Users },
  { id: "habilidades", label: "Áreas y habilidades", icon: Filter },
  { id: "carga", label: "Carga de trabajo", icon: Activity },
  { id: "reportes", label: "Reportes", icon: FileText },
];

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[#59463A]">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#261B16]/45 p-0 backdrop-blur-[3px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-modal-title"
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-[#EDE5DF] bg-[#FFFEFC] p-5 shadow-2xl sm:rounded-3xl sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="personal-modal-title"
              className="font-display text-xl font-semibold text-[#44352D] sm:text-2xl"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-[#928176]">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="rounded-xl p-2 text-[#88766A] transition hover:bg-[#F5EEE8] hover:text-[#44352D]"
          >
            <X size={19} />
          </button>
        </div>

        {children}
      </section>
    </div>
  );
}

function Notice({
  error,
  notice,
  onDismiss,
}: {
  error: string;
  notice: string;
  onDismiss: () => void;
}) {
  const message = error || notice;
  if (!message) return null;

  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        error
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-70 hover:opacity-100"
        aria-label="Cerrar mensaje"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Users;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[#928176]">{label}</p>
          <p className="mt-2 font-display text-2xl font-semibold text-[#44352D] sm:text-3xl">
            {value}
          </p>
          <p className="mt-1 text-xs text-[#A2958B]">{detail}</p>
        </div>
        <div className="rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
          <Icon size={19} />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F8F0E9] text-[#99704F]">
        <Users size={20} />
      </div>
      <p className="text-sm text-[#928176]">{children}</p>
    </div>
  );
}

export default function Trabajadoras() {
  const t = useTrabajadoras();

  const [view, setView] = useState<VistaPersonal>("trabajadoras");
  const [modal, setModal] = useState<ModalType>(null);
  const [capacityPersonId, setCapacityPersonId] = useState("");
  const [absencePersonId, setAbsencePersonId] = useState("");

  const activePerson = t.person;

  const openNew = () => {
    t.startNew();
    setModal("personal");
  };

  const openEdit = (worker: Trabajadora) => {
    t.edit(worker);
    setModal("personal");
  };

  const closeModal = () => {
    if (t.saving) return;

    setModal(null);
    t.setError("");
  };

  const openHours = async (worker: Trabajadora) => {
    t.selectPerson(worker);
    setModal("horario");
    await t.loadHours(worker);
  };

  const openAbsences = async (worker: Trabajadora) => {
    t.selectPerson(worker);
    setAbsencePersonId(String(worker.id));
    setModal("ausencia");
    await t.loadAbsences(worker);
  };

  const changeAbsencePerson = async (id: string) => {
    setAbsencePersonId(id);
    const worker = t.people.find((item) => item.id === Number(id));

    t.selectPerson(worker ?? null);

    if (worker) {
      await t.loadAbsences(worker);
    }
  };

  const changeCapacityPerson = (id: string) => {
    setCapacityPersonId(id);
    const worker = t.people.find((item) => item.id === Number(id));
    t.selectPerson(worker ?? null);
  };

  const consultCapacity = async () => {
    const worker = t.people.find(
      (item) => item.id === Number(capacityPersonId)
    );

    if (!worker) {
      t.setError("Selecciona una trabajadora.");
      return;
    }

    t.selectPerson(worker);
    await t.loadCapacity(worker, t.week);
  };

  const submitPerson = async (event: FormEvent<HTMLFormElement>) => {
    const success = await t.savePerson(event);

    if (success) {
      setModal(null);
    }
  };

  const submitHours = async (event: FormEvent<HTMLFormElement>) => {
    const success = await t.saveHours(event);

    if (success) {
      setModal(null);
    }
  };

  const submitAbsence = async (event: FormEvent<HTMLFormElement>) => {
    const success = await t.saveAbsence(event);

    if (success) {
      // El modal permanece abierto para poder registrar otra ausencia.
    }
  };

  const handleDeleteAbsence = async (id: number) => {
    if (!window.confirm("¿Deseas eliminar esta ausencia?")) return;
    await t.deleteAbsence(id);
  };

  return (
    <main className="min-h-full space-y-5 bg-[#FCFAF7] p-3 text-[#44352D] sm:space-y-6 sm:p-6 lg:p-8">
      {/* ENCABEZADO */}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#B18A6A]">
            Gerencia / Personal
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Equipo del taller
          </h1>
          <p className="mt-1 text-sm text-[#928176]">
            Organiza al equipo, sus horarios y su disponibilidad.
          </p>
        </div>

        <button
          type="button"
          className={`${primaryButton} w-full sm:w-auto`}
          onClick={openNew}
        >
          <Plus size={17} />
          Nueva trabajadora
        </button>
      </header>

      <Notice
        error={t.error}
        notice={t.notice}
        onDismiss={() => {
          t.setError("");
          t.setNotice("");
        }}
      />

      {/* RESUMEN */}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Personal registrado"
          value={t.people.length}
          detail="Total de trabajadoras"
          icon={Users}
        />
        <StatCard
          label="Activas"
          value={t.totalActive}
          detail="Disponibles en el equipo"
          icon={Check}
        />
        <StatCard
          label="Inactivas"
          value={t.people.length - t.totalActive}
          detail="Fuera del equipo activo"
          icon={Users}
        />
        <StatCard
          label="Áreas"
          value={t.options.areas.length}
          detail="Áreas configuradas"
          icon={Activity}
        />
      </section>

      {/* NAVEGACIÓN */}

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-[#EDE5DF] bg-white p-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition sm:px-4 sm:text-sm ${
                active
                  ? "bg-[#49372D] text-white shadow-sm"
                  : "text-[#88766A] hover:bg-[#FAF6F2] hover:text-[#44352D]"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* VISTA: PERSONAL */}

      {view === "trabajadoras" && (
        <section className={cardClass}>
          <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="mr-auto">
              <h2 className="font-display text-lg font-semibold">
                Personal registrado
              </h2>
              <p className="mt-0.5 text-xs text-[#928176]">
                {t.filtered.length} resultados
              </p>
            </div>

            <div className="relative w-full xl:max-w-xs">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A99B91]"
              />
              <input
                className={`${inputClass} pl-9`}
                placeholder="Buscar por nombre..."
                aria-label="Buscar trabajadora"
                value={t.search}
                onChange={(event) => t.setSearch(event.target.value)}
              />
            </div>

            <select
              className={`${inputClass} w-full xl:max-w-48`}
              aria-label="Filtrar por área"
              value={t.area}
              onChange={(event) => t.setArea(event.target.value)}
            >
              <option value="">Todas las áreas</option>
              {t.options.areas.map((item) => (
                <option key={item.valor} value={item.valor}>
                  {item.nombre}
                </option>
              ))}
            </select>

            <select
              className={`${inputClass} w-full xl:max-w-40`}
              aria-label="Filtrar por estado"
              value={t.status}
              onChange={(event) => t.setStatus(event.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </div>

          {t.loading ? (
            <div className="py-14 text-center text-sm text-[#928176]">
              Cargando personal...
            </div>
          ) : t.filtered.length === 0 ? (
            <EmptyState>
              No encontramos trabajadoras con esos filtros.
            </EmptyState>
          ) : (
            <>
              {/* TABLA PARA PANTALLAS MEDIANAS Y GRANDES */}

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[680px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#EDE5DF] text-[11px] uppercase tracking-wider text-[#A2958B]">
                      <th className="px-3 py-3 font-medium">Trabajadora</th>
                      <th className="px-3 py-3 font-medium">Área</th>
                      <th className="px-3 py-3 font-medium">Estado</th>
                      <th className="px-3 py-3 text-right font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.filtered.map((worker) => (
                      <tr
                        key={worker.id}
                        className="border-b border-[#F1EBE6] last:border-0 hover:bg-[#FCFAF7]"
                      >
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F4E8DD] text-xs font-semibold text-[#805C42]">
                              {worker.nombre
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((part) => part[0])
                                .join("")
                                .toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                {worker.nombre}
                              </p>
                              <p className="mt-0.5 text-xs text-[#A2958B]">
                                {worker.habilidades?.length ?? 0} habilidades
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-4 text-sm text-[#79685D]">
                          {worker.area_nombre || t.areaName(worker.area)}
                        </td>

                        <td className="px-3 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                              worker.activa
                                ? "bg-[#EAF4EC] text-[#477451]"
                                : "bg-[#F3EFEC] text-[#8D7D72]"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                worker.activa ? "bg-[#5D9A6A]" : "bg-[#A99B91]"
                              }`}
                            />
                            {worker.activa ? "Activa" : "Inactiva"}
                          </span>
                        </td>

                        <td className="px-3 py-4">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="Editar"
                              aria-label={`Editar ${worker.nombre}`}
                              onClick={() => openEdit(worker)}
                              className="rounded-lg p-2 text-[#79685D] hover:bg-[#F4E8DD] hover:text-[#49372D]"
                            >
                              <Pencil size={16} />
                            </button>

                            <button
                              type="button"
                              title="Horario"
                              onClick={() => void openHours(worker)}
                              className="rounded-lg p-2 text-[#79685D] hover:bg-[#F4E8DD] hover:text-[#49372D]"
                            >
                              <CalendarClock size={16} />
                            </button>

                            <button
                              type="button"
                              title="Ausencias"
                              onClick={() => void openAbsences(worker)}
                              className="rounded-lg p-2 text-[#79685D] hover:bg-[#F4E8DD] hover:text-[#49372D]"
                            >
                              <CalendarOff size={16} />
                            </button>

                            <button
                              type="button"
                              title={worker.activa ? "Desactivar" : "Activar"}
                              onClick={() => void t.toggleActive(worker)}
                              className="rounded-lg p-2 text-[#79685D] hover:bg-[#F4E8DD] hover:text-[#49372D]"
                            >
                              {worker.activa ? (
                                <X size={16} />
                              ) : (
                                <Check size={16} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* TARJETAS PARA CELULARES */}

              <div className="grid gap-3 md:hidden">
                {t.filtered.map((worker) => (
                  <article
                    key={worker.id}
                    className="rounded-xl border border-[#EFE7E1] p-3.5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F4E8DD] text-xs font-semibold text-[#805C42]">
                        {worker.nombre
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold">
                          {worker.nombre}
                        </p>
                        <p className="mt-1 text-xs text-[#928176]">
                          {worker.area_nombre || t.areaName(worker.area)}
                        </p>
                        <span
                          className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${
                            worker.activa
                              ? "bg-[#EAF4EC] text-[#477451]"
                              : "bg-[#F3EFEC] text-[#8D7D72]"
                          }`}
                        >
                          {worker.activa ? "Activa" : "Inactiva"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-2 border-t border-[#F1EBE6] pt-3">
                      <button
                        type="button"
                        onClick={() => openEdit(worker)}
                        className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-[#79685D] hover:bg-[#FAF6F2]"
                      >
                        <Pencil size={16} />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void openHours(worker)}
                        className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-[#79685D] hover:bg-[#FAF6F2]"
                      >
                        <Clock3 size={16} />
                        Horario
                      </button>
                      <button
                        type="button"
                        onClick={() => void openAbsences(worker)}
                        className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-[#79685D] hover:bg-[#FAF6F2]"
                      >
                        <CalendarOff size={16} />
                        Ausencias
                      </button>
                      <button
                        type="button"
                        onClick={() => void t.toggleActive(worker)}
                        className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-[#79685D] hover:bg-[#FAF6F2]"
                      >
                        {worker.activa ? <X size={16} /> : <Check size={16} />}
                        {worker.activa ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* VISTA: ÁREAS Y HABILIDADES */}

      {view === "habilidades" && (
        <section className={cardClass}>
          <div className="mb-5">
            <h2 className="font-display text-lg font-semibold">
              Áreas y habilidades
            </h2>
            <p className="mt-1 text-sm text-[#928176]">
              Operaciones registradas en el sistema.
            </p>
          </div>

          {t.options.areas.length === 0 ? (
            <EmptyState>No hay áreas configuradas en la API.</EmptyState>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {t.options.areas.map((item) => {
                const operations = t.options.operaciones.filter(
                  (operation) => operation.area_responsable === item.valor
                );

                const count = t.people.filter(
                  (worker) => worker.area === item.valor
                ).length;

                return (
                  <article
                    key={item.valor}
                    className="rounded-xl border border-[#EFE7E1] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium">{item.nombre}</h3>
                        <p className="mt-1 text-xs text-[#928176]">
                          {count} {count === 1 ? "trabajadora" : "trabajadoras"}
                        </p>
                      </div>
                      <span className="rounded-lg bg-[#F8F0E9] px-2.5 py-1 text-xs text-[#99704F]">
                        {operations.length} operaciones
                      </span>
                    </div>

                    {operations.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {operations.map((operation) => (
                          <span
                            key={operation.id}
                            className="rounded-lg border border-[#EDE5DF] bg-[#FCFAF7] px-2.5 py-1.5 text-xs text-[#79685D]"
                          >
                            {operation.nombre}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-xs text-[#A2958B]">
                        No hay operaciones activas en esta área.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <p className="mt-5 rounded-xl bg-[#FAF6F2] p-3 text-xs leading-5 text-[#928176]">
            Las operaciones se consultan desde la API. La creación y edición
            de operaciones no está habilitada en los endpoints que compartiste.
          </p>
        </section>
      )}

      {/* VISTA: CARGA DE TRABAJO */}

      {view === "carga" && (
        <section className={cardClass}>
          <div className="mb-5">
            <h2 className="font-display text-lg font-semibold">
              Carga de trabajo
            </h2>
            <p className="mt-1 text-sm text-[#928176]">
              Consulta la capacidad semanal de una trabajadora.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Trabajadora">
              <select
                className={inputClass}
                value={capacityPersonId}
                onChange={(event) =>
                  changeCapacityPerson(event.target.value)
                }
              >
                <option value="">Seleccionar trabajadora</option>
                {t.people.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.nombre}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fecha de la semana">
              <input
                type="date"
                className={inputClass}
                value={t.week}
                onChange={(event) => t.setWeek(event.target.value)}
              />
            </Field>

            <button
              type="button"
              className={primaryButton}
              disabled={!capacityPersonId || t.consulting}
              onClick={() => void consultCapacity()}
            >
              <Search size={16} />
              Consultar
            </button>
          </div>

          {t.consulting && (
            <p className="py-8 text-center text-sm text-[#928176]">
              Consultando disponibilidad...
            </p>
          )}

          {!t.consulting && t.capacity && (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ["Horas disponibles", t.capacity.horas_disponibles, "h"],
                  ["Horas reservadas", t.capacity.horas_reservadas, "h"],
                  ["Horas libres", t.capacity.horas_libres, "h"],
                  ["Ocupación", t.capacity.ocupacion_porcentaje, "%"],
                ].map(([label, value, suffix]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl bg-[#FAF6F2] p-4"
                  >
                    <p className="text-xs text-[#928176]">{label}</p>
                    <p className="mt-2 font-display text-2xl font-semibold">
                      {formatoHoras(value as string | number)}
                      {suffix}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-6">
                <h3 className="mb-3 text-sm font-semibold">
                  Detalle de la semana
                </h3>

                <div className="overflow-x-auto rounded-xl border border-[#EDE5DF]">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-[#FAF6F2] text-xs text-[#928176]">
                      <tr>
                        <th className="px-3 py-3 font-medium">Fecha</th>
                        <th className="px-3 py-3 font-medium">Disponibles</th>
                        <th className="px-3 py-3 font-medium">Reservadas</th>
                        <th className="px-3 py-3 font-medium">Libres</th>
                        <th className="px-3 py-3 font-medium">Sobrecarga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.capacity.detalle?.map((day) => (
                        <tr
                          key={day.fecha}
                          className="border-t border-[#F1EBE6]"
                        >
                          <td className="px-3 py-3">{day.fecha}</td>
                          <td className="px-3 py-3">
                            {formatoHoras(day.horas_disponibles)} h
                          </td>
                          <td className="px-3 py-3">
                            {formatoHoras(day.horas_reservadas)} h
                          </td>
                          <td className="px-3 py-3">
                            {formatoHoras(day.horas_libres)} h
                          </td>
                          <td className="px-3 py-3">
                            {formatoHoras(day.sobrecarga)} h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="mb-3 text-sm font-semibold">
                  Reservas de esa semana
                </h3>

                {t.reservations.length === 0 ? (
                  <p className="rounded-xl bg-[#FAF6F2] p-4 text-sm text-[#928176]">
                    No hay reservas para esta semana.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {t.reservations.map((reservation) => (
                      <div
                        key={reservation.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EFE7E1] p-3.5"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {reservation.operacion_nombre ||
                              `Reserva #${reservation.id}`}
                          </p>
                          <p className="mt-1 text-xs text-[#928176]">
                            {reservation.fecha} · {reservation.estado}
                          </p>
                        </div>
                        <span className="rounded-lg bg-[#F8F0E9] px-2.5 py-1.5 text-xs text-[#805C42]">
                          {formatoHoras(reservation.horas_reservadas)} h
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* VISTA: REPORTES */}

      {view === "reportes" && (
        <section className={cardClass}>
          <div className="mb-5">
            <h2 className="font-display text-lg font-semibold">
              Reporte de personal
            </h2>
            <p className="mt-1 text-sm text-[#928176]">
              Resumen del equipo agrupado por área.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-left text-sm">
              <thead className="bg-[#FAF6F2] text-xs text-[#928176]">
                <tr>
                  <th className="rounded-l-lg px-3 py-3 font-medium">Área</th>
                  <th className="px-3 py-3 font-medium">Total</th>
                  <th className="px-3 py-3 font-medium">Activas</th>
                  <th className="rounded-r-lg px-3 py-3 font-medium">Inactivas</th>
                </tr>
              </thead>
              <tbody>
                {t.options.areas.map((item) => {
                  const group = t.people.filter(
                    (worker) => worker.area === item.valor
                  );
                  const active = group.filter(
                    (worker) => worker.activa
                  ).length;

                  return (
                    <tr
                      key={item.valor}
                      className="border-b border-[#F1EBE6] last:border-0"
                    >
                      <td className="px-3 py-3 font-medium">
                        {item.nombre}
                      </td>
                      <td className="px-3 py-3">{group.length}</td>
                      <td className="px-3 py-3 text-[#477451]">
                        {active}
                      </td>
                      <td className="px-3 py-3 text-[#928176]">
                        {group.length - active}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs leading-5 text-[#A2958B]">
            Este resumen se calcula a partir del personal recibido desde Django.
            No modifica ni crea registros en el backend.
          </p>
        </section>
      )}

      {/* MODAL: CREAR O EDITAR PERSONAL */}

      {modal === "personal" && (
        <Modal
          title={t.editing ? "Editar trabajadora" : "Nueva trabajadora"}
          description="Completa los datos del equipo del taller."
          onClose={closeModal}
        >
          <form onSubmit={submitPerson} className="space-y-4">
            <Field label="Nombre completo">
              <input
                className={inputClass}
                autoFocus
                required
                maxLength={150}
                placeholder="Ej. María López"
                value={t.form.nombre}
                onChange={(event) =>
                  t.setForm({
                    ...t.form,
                    nombre: event.target.value,
                  })
                }
              />
            </Field>

            <Field label="Área principal">
              <select
                className={inputClass}
                required
                value={t.form.area}
                onChange={(event) =>
                  t.setForm({
                    ...t.form,
                    area: event.target.value,
                  })
                }
              >
                <option value="">Seleccionar área</option>
                {t.options.areas.map((item) => (
                  <option key={item.valor} value={item.valor}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </Field>

            <fieldset className="rounded-xl border border-[#EDE5DF] p-3.5">
              <legend className="px-1 text-sm font-medium text-[#59463A]">
                Habilidades y operaciones
              </legend>

              {t.options.operaciones.length === 0 ? (
                <p className="py-2 text-xs text-[#928176]">
                  No hay operaciones activas registradas.
                </p>
              ) : (
                <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                  {t.options.operaciones.map((operation) => {
                    const checked = t.form.habilidades.includes(
                      operation.id
                    );

                    return (
                      <label
                        key={operation.id}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition ${
                          checked
                            ? "border-[#C6A183] bg-[#FAF4EE]"
                            : "border-transparent hover:bg-[#FAF6F2]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[#805C42]"
                          checked={checked}
                          onChange={(event) =>
                            t.setForm((current) => ({
                              ...current,
                              habilidades: event.target.checked
                                ? [...current.habilidades, operation.id]
                                : current.habilidades.filter(
                                    (id) => id !== operation.id
                                  ),
                            }))
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-[#59463A]">
                            {operation.nombre}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[#A2958B]">
                            {operation.area_nombre ||
                              t.areaName(operation.area_responsable)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <Field label="Observaciones">
              <textarea
                className={inputClass}
                rows={3}
                maxLength={2000}
                placeholder="Información adicional (opcional)"
                value={t.form.observaciones}
                onChange={(event) =>
                  t.setForm({
                    ...t.form,
                    observaciones: event.target.value,
                  })
                }
              />
            </Field>

            <label className="flex items-center gap-3 rounded-xl bg-[#FAF6F2] p-3.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#805C42]"
                checked={t.form.activa}
                onChange={(event) =>
                  t.setForm({
                    ...t.form,
                    activa: event.target.checked,
                  })
                }
              />
              <span>
                <span className="block text-sm font-medium">
                  Personal activo
                </span>
                <span className="mt-0.5 block text-xs text-[#928176]">
                  Puede considerarse para la planificación del taller.
                </span>
              </span>
            </label>

            {t.error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
              >
                {t.error}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-[#EDE5DF] pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={secondaryButton}
                disabled={t.saving}
                onClick={closeModal}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={primaryButton}
                disabled={t.saving}
              >
                {t.saving
                  ? "Guardando..."
                  : t.editing
                    ? "Guardar cambios"
                    : "Registrar trabajadora"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: HORARIO */}

      {modal === "horario" && activePerson && (
        <Modal
          title="Horario semanal"
          description={activePerson.nombre}
          onClose={closeModal}
        >
          {t.consulting ? (
            <p className="py-8 text-center text-sm text-[#928176]">
              Cargando horario...
            </p>
          ) : (
            <form onSubmit={submitHours} className="space-y-4">
              <div className="space-y-1">
                {DIAS.map((day, index) => (
                  <div
                    key={day}
                    className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition hover:bg-[#FAF6F2]"
                  >
                    <label
                      htmlFor={`hours-${index}`}
                      className="text-sm font-medium"
                    >
                      {day}
                    </label>

                    <div className="flex items-center gap-2">
                      <input
                        id={`hours-${index}`}
                        className={`${inputClass} w-24 text-right`}
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        required
                        value={t.hours[index]}
                        onChange={(event) =>
                          t.setHours((current) =>
                            current.map((value, i) =>
                              i === index ? event.target.value : value
                            )
                          )
                        }
                      />
                      <span className="w-3 text-xs text-[#928176]">h</span>
                    </div>
                  </div>
                ))}
              </div>

              <p className="rounded-xl bg-[#FAF6F2] p-3 text-xs leading-5 text-[#928176]">
                Usa 0 para los días de descanso. El sistema guarda los siete
                días en la disponibilidad semanal de Django.
              </p>

              {t.error && (
                <p role="alert" className="text-xs text-red-700">
                  {t.error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-[#EDE5DF] pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={t.saving}
                  onClick={closeModal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={primaryButton}
                  disabled={t.saving}
                >
                  {t.saving ? "Guardando..." : "Guardar horario"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* MODAL: AUSENCIAS */}

      {modal === "ausencia" && (
        <Modal
          title="Ausencias y permisos"
          description="Registra una ausencia y revisa las ya registradas."
          onClose={closeModal}
        >
          <div className="space-y-4">
            <Field label="Trabajadora">
              <select
                className={inputClass}
                value={absencePersonId}
                onChange={(event) =>
                  void changeAbsencePerson(event.target.value)
                }
              >
                <option value="">Seleccionar trabajadora</option>
                {t.people.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.nombre}
                  </option>
                ))}
              </select>
            </Field>

            {activePerson && (
              <>
                <form
                  onSubmit={submitAbsence}
                  className="space-y-3 rounded-xl bg-[#FAF6F2] p-3.5 sm:p-4"
                >
                  <h3 className="text-sm font-semibold">
                    Registrar ausencia
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Desde">
                      <input
                        className={inputClass}
                        type="date"
                        required
                        value={t.absence.fecha_inicio}
                        onChange={(event) =>
                          t.setAbsence({
                            ...t.absence,
                            fecha_inicio: event.target.value,
                          })
                        }
                      />
                    </Field>

                    <Field label="Hasta">
                      <input
                        className={inputClass}
                        type="date"
                        min={t.absence.fecha_inicio || undefined}
                        required
                        value={t.absence.fecha_fin}
                        onChange={(event) =>
                          t.setAbsence({
                            ...t.absence,
                            fecha_fin: event.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>

                  <Field label="Horas no disponibles por día">
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      max="24"
                      step="0.25"
                      required
                      value={t.absence.horas_no_disponibles}
                      onChange={(event) =>
                        t.setAbsence({
                          ...t.absence,
                          horas_no_disponibles: event.target.value,
                        })
                      }
                    />
                  </Field>

                  <Field label="Motivo">
                    <input
                      className={inputClass}
                      maxLength={200}
                      placeholder="Motivo (opcional)"
                      value={t.absence.motivo}
                      onChange={(event) =>
                        t.setAbsence({
                          ...t.absence,
                          motivo: event.target.value,
                        })
                      }
                    />
                  </Field>

                  {t.error && (
                    <p role="alert" className="text-xs text-red-700">
                      {t.error}
                    </p>
                  )}

                  <button
                    type="submit"
                    className={`${primaryButton} w-full`}
                    disabled={t.saving || t.consulting}
                  >
                    <Plus size={16} />
                    {t.saving ? "Guardando..." : "Registrar ausencia"}
                  </button>
                </form>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">
                      Ausencias registradas
                    </h3>
                    <span className="text-xs text-[#928176]">
                      {t.absences.length} registros
                    </span>
                  </div>

                  {t.consulting ? (
                    <p className="py-5 text-center text-sm text-[#928176]">
                      Cargando ausencias...
                    </p>
                  ) : t.absences.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[#E8DFD8] p-5 text-center text-xs text-[#928176]">
                      Esta trabajadora no tiene ausencias registradas.
                    </p>
                  ) : (
                    <div className="max-h-52 space-y-2 overflow-y-auto">
                      {t.absences.map((item) => (
                        <article
                          key={item.id}
                          className="flex items-start justify-between gap-3 rounded-xl border border-[#EFE7E1] p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {item.fecha_inicio} — {item.fecha_fin}
                            </p>
                            <p className="mt-1 text-xs text-[#928176]">
                              {formatoHoras(item.horas_no_disponibles)} h/día
                              {item.motivo ? ` · ${item.motivo}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg p-2 text-[#9B7463] hover:bg-red-50 hover:text-red-700"
                            title="Eliminar ausencia"
                            aria-label="Eliminar ausencia"
                            onClick={() =>
                              void handleDeleteAbsence(item.id)
                            }
                          >
                            <X size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
