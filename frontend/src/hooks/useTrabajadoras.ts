
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useAuth } from "../contexts/AuthContext";

const API_BASE = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const API = `${API_BASE}/api/gerencia/personal`;

export const DIAS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

export type VistaPersonal =
  | "trabajadoras"
  | "habilidades"
  | "carga"
  | "reportes";

export interface Area {
  valor: string;
  nombre: string;
}

export interface DiaOpcion {
  valor: number;
  nombre: string;
}

export interface Operacion {
  id: number;
  nombre: string;
  area_responsable: string;
  area_nombre?: string;
  descripcion?: string;
  activa: boolean;
}

export interface Trabajadora {
  id: number;
  nombre: string;
  area: string;
  area_nombre?: string;
  activa: boolean;
  observaciones: string;
  habilidades: number[];
  habilidades_detalle?: Operacion[];
  horarios?: Horario[];
  username: string;
  email: string;
}

export interface FormTrabajadora {
  nombre: string;
  area: string;
  activa: boolean;
  observaciones: string;
  habilidades: number[];
  username: string;
  email: string;
  password: string;
}

export interface Horario {
  id?: number;
  dia_semana: number;
  dia_nombre?: string;
  horas_disponibles: string | number;
}

export interface Ausencia {
  id: number;
  trabajadora: number;
  trabajadora_nombre?: string;
  fecha_inicio: string;
  fecha_fin: string;
  horas_no_disponibles: string | number;
  motivo: string;
}

export interface FormAusencia {
  fecha_inicio: string;
  fecha_fin: string;
  horas_no_disponibles: string;
  motivo: string;
}

export interface DetalleCapacidad {
  fecha: string;
  dia_semana: number;
  horas_base: string | number;
  horas_ausencia: string | number;
  horas_disponibles: string | number;
  horas_reservadas: string | number;
  horas_libres: string | number;
  sobrecarga: string | number;
}

export interface Capacidad {
  trabajadora: number;
  nombre: string;
  activa: boolean;
  semana_inicio: string;
  semana_fin: string;
  horas_disponibles: string | number;
  horas_reservadas: string | number;
  horas_libres: string | number;
  ocupacion_porcentaje: string | number;
  detalle: DetalleCapacidad[];
}

export interface Reserva {
  id: number;
  fecha: string;
  operacion_nombre?: string;
  horas_reservadas: string | number;
  estado: string;
  [key: string]: unknown;
}

export interface Opciones {
  areas: Area[];
  dias: DiaOpcion[];
  operaciones: Operacion[];
}

interface ListaPaginada<T> {
  results: T[];
  next?: string | null;
}

interface RespuestaHorario {
  trabajadora?: number;
  nombre?: string;
  mensaje?: string;
  horarios?: Horario[];
}

interface PayloadTrabajadora {
  nombre: string;
  area: string;
  activa: boolean;
  observaciones: string;
  habilidades: number[];
  username: string;
  email: string;
  password?: string;
}

const formularioInicial = (): FormTrabajadora => ({
  nombre: "",
  area: "",
  activa: true,
  observaciones: "",
  habilidades: [],
  username: "",
  email: "",
  password: "",
});

const ausenciaInicial = (): FormAusencia => ({
  fecha_inicio: "",
  fecha_fin: "",
  horas_no_disponibles: "0",
  motivo: "",
});

function obtenerError(data: unknown, status: number): string {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    if (obj.detail) return String(obj.detail);
    if (obj.detalle) return String(obj.detalle);

    return Object.entries(obj)
      .map(([campo, valor]) => {
        const mensaje = Array.isArray(valor)
          ? valor.join(", ")
          : typeof valor === "string"
            ? valor
            : JSON.stringify(valor);

        return `${campo}: ${mensaje}`;
      })
      .join(" · ");
  }

  return `Ocurrió un error (HTTP ${status}).`;
}

function convertirLista<T>(
  data: T[] | ListaPaginada<T> | null | undefined
): T[] {
  if (Array.isArray(data)) return data;

  if (data && Array.isArray(data.results)) {
    return data.results;
  }

  return [];
}

export function formatoHoras(
  value: number | string | null | undefined
): string {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function obtenerLunesActual(): string {
  const date = new Date();
  const day = (date.getDay() + 6) % 7;

  date.setDate(date.getDate() - day);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${dayOfMonth}`;
}

export function useTrabajadoras() {
  const { accessToken } = useAuth();

  const [people, setPeople] = useState<Trabajadora[]>([]);

  const [options, setOptions] = useState<Opciones>({
    areas: [],
    dias: DIAS.map((nombre, valor) => ({ valor, nombre })),
    operaciones: [],
  });

  const [person, setPerson] = useState<Trabajadora | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormTrabajadora>(
    formularioInicial
  );

  const [hours, setHours] = useState<string[]>(
    () => Array(7).fill("0")
  );

  const [absences, setAbsences] = useState<Ausencia[]>([]);
  const [absence, setAbsence] = useState<FormAusencia>(
    ausenciaInicial
  );

  const [capacity, setCapacity] = useState<Capacidad | null>(null);
  const [reservations, setReservations] = useState<Reserva[]>([]);
  const [week, setWeek] = useState(obtenerLunesActual());

  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Petición autenticada a Django REST Framework.
  const request = useCallback(
    async <T,>(
      path: string,
      config: RequestInit = {}
    ): Promise<T> => {
      if (!accessToken) {
        throw new Error(
          "No hay una sesión activa. Vuelve a iniciar sesión."
        );
      }

      let response: Response;

      try {
        response = await fetch(
          `${API}/${path.replace(/^\/+/, "")}`,
          {
            ...config,
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
              ...(config.body !== undefined
                ? { "Content-Type": "application/json" }
                : {}),
              ...config.headers,
            },
          }
        );
      } catch {
        throw new Error(
          "No se pudo conectar con Django. Verifica el servidor y la URL de la API."
        );
      }

      if (response.status === 204) {
        return null as T;
      }

      const text = await response.text();
      let data: unknown = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Tu sesión expiró. Inicia sesión nuevamente."
          );
        }

        if (response.status === 403) {
          throw new Error(
            "No tienes permisos para acceder al módulo de Gerencia."
          );
        }

        throw new Error(obtenerError(data, response.status));
      }

      return data as T;
    },
    [accessToken]
  );

  const requestList = useCallback(
    async <T,>(path: string): Promise<T[]> => {
      const data = await request<T[] | ListaPaginada<T>>(path);
      return convertirLista(data);
    },
    [request]
  );

  // Cargar operaciones desde el endpoint confirmado.
  const loadOperations = useCallback(async (): Promise<boolean> => {
    try {
      const operaciones = await requestList<Operacion>("operaciones/");

      setOptions((current) => ({
        ...current,
        operaciones,
      }));

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [requestList]);

  // Cargar trabajadoras, opciones y operaciones.
  const load = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError("");

    try {
      const [trabajadoras, opciones, operaciones] = await Promise.all([
        requestList<Trabajadora>("trabajadoras/"),
        request<Partial<Opciones>>("trabajadoras/opciones/"),
        requestList<Operacion>("operaciones/"),
      ]);

      setPeople(trabajadoras);

      setOptions({
        areas: opciones.areas ?? [],
        dias:
          opciones.dias?.length
            ? opciones.dias
            : DIAS.map((nombre, valor) => ({ valor, nombre })),
        operaciones:
          operaciones.length > 0
            ? operaciones
            : opciones.operaciones ?? [],
      });

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [request, requestList]);

  useEffect(() => {
    void load();
  }, [load]);

  // Búsqueda por nombre, usuario o correo.
  const filtered = useMemo(() => {
    return people.filter((p) => {
      const term = search.trim().toLocaleLowerCase();

      const matchesName =
        p.nombre.toLocaleLowerCase().includes(term) ||
        (p.username ?? "").toLocaleLowerCase().includes(term) ||
        (p.email ?? "").toLocaleLowerCase().includes(term);

      const matchesArea = !area || p.area === area;
      const matchesStatus = !status || String(p.activa) === status;

      return matchesName && matchesArea && matchesStatus;
    });
  }, [people, search, area, status]);

  const totalActive = useMemo(
    () => people.filter((p) => p.activa).length,
    [people]
  );

  const areaName = useCallback(
    (code: string) =>
      options.areas.find((item) => item.valor === code)?.nombre ||
      people.find((item) => item.area === code)?.area_nombre ||
      code ||
      "Sin área",
    [options.areas, people]
  );

  const clearMessages = useCallback(() => {
    setError("");
    setNotice("");
  }, []);

  const startNew = useCallback(() => {
    setPerson(null);
    setEditing(false);
    setForm(formularioInicial());
    clearMessages();
  }, [clearMessages]);

  const edit = useCallback(
    (worker: Trabajadora) => {
      setPerson(worker);
      setEditing(true);
      clearMessages();

      setForm({
        nombre: worker.nombre ?? "",
        area: worker.area ?? "",
        activa: worker.activa,
        observaciones: worker.observaciones ?? "",
        habilidades: (worker.habilidades ?? []).map(Number),
        username: worker.username ?? "",
        email: worker.email ?? "",
        password: "",
      });
    },
    [clearMessages]
  );

  const cancelEdit = useCallback(() => {
    setPerson(null);
    setEditing(false);
    setForm(formularioInicial());
    clearMessages();
  }, [clearMessages]);

  // Crear o actualizar una trabajadora.
  const savePerson = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<boolean> => {
    event.preventDefault();
    clearMessages();

    if (!form.nombre.trim()) {
      setError("Escribe el nombre completo.");
      return false;
    }

    if (!form.area) {
      setError("Selecciona el área principal.");
      return false;
    }

    if (!form.username.trim()) {
      setError("Escribe el nombre de usuario.");
      return false;
    }

    if (!form.email.trim()) {
      setError("Escribe el correo electrónico.");
      return false;
    }

    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      form.email.trim()
    );

    if (!emailValido) {
      setError("Escribe un correo electrónico válido.");
      return false;
    }

    const isEditing = editing && person !== null;

    if (!isEditing && !form.password) {
      setError("Escribe una contraseña para la cuenta.");
      return false;
    }

    if (form.password && form.password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return false;
    }

    const payload: PayloadTrabajadora = {
      nombre: form.nombre.trim(),
      area: form.area,
      activa: form.activa,
      observaciones: form.observaciones.trim(),
      // Solo se envían IDs de operaciones seleccionadas.
      habilidades: form.habilidades.map(Number).filter(Number.isFinite),
      username: form.username.trim(),
      email: form.email.trim(),
    };

    // La contraseña se envía solo si se escribió.
    if (form.password) {
      payload.password = form.password;
    }

    setSaving(true);

    try {
      const endpoint =
        isEditing && person
          ? `trabajadoras/${person.id}/`
          : "trabajadoras/";

      await request<Trabajadora>(endpoint, {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });

      const refreshed = await load();

      setPerson(null);
      setEditing(false);
      setForm(formularioInicial());

      setNotice(
        refreshed
          ? isEditing
            ? "Los datos de la trabajadora se actualizaron."
            : "La trabajadora y su cuenta se registraron correctamente."
          : "Se guardó correctamente, pero no se pudo actualizar el listado."
      );

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Activar o desactivar sin eliminar el historial.
  const toggleActive = async (
    worker: Trabajadora
  ): Promise<boolean> => {
    clearMessages();

    try {
      const updated = await request<Trabajadora>(
        `trabajadoras/${worker.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ activa: !worker.activa }),
        }
      );

      setPeople((current) =>
        current.map((item) =>
          item.id === worker.id
            ? { ...item, ...updated }
            : item
        )
      );

      setNotice(
        updated.activa
          ? "Trabajadora activada correctamente."
          : "Trabajadora desactivada correctamente."
      );

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const selectPerson = useCallback(
    (worker: Trabajadora | null) => {
      setPerson(worker);
      setCapacity(null);
      setReservations([]);
      setAbsences([]);
      setHours(Array(7).fill("0"));
      setAbsence(ausenciaInicial());
      clearMessages();
    },
    [clearMessages]
  );

  // Consultar horario semanal.
  const loadHours = async (
    worker: Trabajadora
  ): Promise<boolean> => {
    setConsulting(true);
    clearMessages();

    try {
      const data = await request<
        RespuestaHorario | Horario[]
      >(`trabajadoras/${worker.id}/horarios/`);

      const horarioLista = Array.isArray(data)
        ? data
        : data.horarios ?? [];

      const nextHours = Array<string>(7).fill("0");

      for (const item of horarioLista) {
        const day = Number(item.dia_semana);

        if (day >= 0 && day <= 6) {
          nextHours[day] = String(item.horas_disponibles);
        }
      }

      setHours(nextHours);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setConsulting(false);
    }
  };

  // Guardar horario semanal.
  // El formato { horarios: [...] } debe coincidir con el serializer de Django.
  const saveHours = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<boolean> => {
    event.preventDefault();
    clearMessages();

    if (!person) {
      setError("Selecciona una trabajadora.");
      return false;
    }

    const invalid = hours.some((value) => {
      const number = Number(value);
      return (
        !Number.isFinite(number) ||
        number < 0 ||
        number > 24
      );
    });

    if (invalid) {
      setError("Cada día debe tener entre 0 y 24 horas.");
      return false;
    }

    setSaving(true);

    try {
      const response = await request<
        RespuestaHorario | Horario[]
      >(`trabajadoras/${person.id}/horarios/`, {
        method: "PUT",
        body: JSON.stringify({
          horarios: hours.map((value, dia_semana) => ({
            dia_semana,
            horas_disponibles: value,
          })),
        }),
      });

      const horarioLista = Array.isArray(response)
        ? response
        : response.horarios ?? [];

      if (horarioLista.length > 0) {
        const nextHours = Array<string>(7).fill("0");

        for (const item of horarioLista) {
          if (item.dia_semana >= 0 && item.dia_semana <= 6) {
            nextHours[item.dia_semana] = String(
              item.horas_disponibles
            );
          }
        }

        setHours(nextHours);
      }

      setNotice(
        !Array.isArray(response) && response.mensaje
          ? response.mensaje
          : "Horario guardado correctamente."
      );

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Consultar ausencias específicas de una trabajadora.
  const loadAbsences = async (
    worker: Trabajadora
  ): Promise<boolean> => {
    setConsulting(true);
    clearMessages();

    try {
      const data = await requestList<Ausencia>(
        `trabajadoras/${worker.id}/ausencias/`
      );

      setAbsences(data);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setConsulting(false);
    }
  };

  // Registrar una ausencia.
  const saveAbsence = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<boolean> => {
    event.preventDefault();
    clearMessages();

    if (!person) {
      setError("Selecciona una trabajadora.");
      return false;
    }

    if (
      !absence.fecha_inicio ||
      !absence.fecha_fin ||
      absence.fecha_fin < absence.fecha_inicio
    ) {
      setError("Verifica las fechas de inicio y fin.");
      return false;
    }

    const hoursValue = Number(absence.horas_no_disponibles);

    if (
      !Number.isFinite(hoursValue) ||
      hoursValue < 0 ||
      hoursValue > 24
    ) {
      setError("Las horas no disponibles deben estar entre 0 y 24.");
      return false;
    }

    setSaving(true);

    try {
      await request<Ausencia>("ausencias/", {
        method: "POST",
        body: JSON.stringify({
          trabajadora: person.id,
          fecha_inicio: absence.fecha_inicio,
          fecha_fin: absence.fecha_fin,
          horas_no_disponibles: absence.horas_no_disponibles,
          motivo: absence.motivo.trim(),
        }),
      });

      const updated = await requestList<Ausencia>(
        `trabajadoras/${person.id}/ausencias/`
      );

      setAbsences(updated);
      setAbsence(ausenciaInicial());
      setNotice("Ausencia registrada correctamente.");

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Editar una ausencia existente.
  const updateAbsence = async (
    id: number,
    data: Partial<FormAusencia>
  ): Promise<boolean> => {
    clearMessages();

    try {
      await request<Ausencia>(`ausencias/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });

      if (person) {
        const updated = await requestList<Ausencia>(
          `trabajadoras/${person.id}/ausencias/`
        );
        setAbsences(updated);
      } else {
        const updated = await requestList<Ausencia>("ausencias/");
        setAbsences(updated);
      }

      setNotice("Ausencia actualizada correctamente.");
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  // Eliminar ausencia.
  const deleteAbsence = async (
    id: number
  ): Promise<boolean> => {
    clearMessages();

    try {
      await request<null>(`ausencias/${id}/`, {
        method: "DELETE",
      });

      setAbsences((current) =>
        current.filter((item) => item.id !== id)
      );

      setNotice("Ausencia eliminada correctamente.");
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  // Consultar capacidad semanal y reservas.
  const loadCapacity = async (
    worker: Trabajadora,
    date: string = week
  ): Promise<boolean> => {
    setConsulting(true);
    clearMessages();

    try {
      const [capacityData, reservationsData] = await Promise.all([
        request<Capacidad>(
          `trabajadoras/${worker.id}/capacidad/?fecha=${encodeURIComponent(date)}`
        ),
        requestList<Reserva>(
          `trabajadoras/${worker.id}/reservas/`
        ),
      ]);

      setCapacity(capacityData);

      setReservations(
        reservationsData.filter((reservation) => {
          if (!reservation.fecha) return true;

          return (
            reservation.fecha >= capacityData.semana_inicio &&
            reservation.fecha <= capacityData.semana_fin
          );
        })
      );

      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setConsulting(false);
    }
  };

  // Consultar todas las ausencias del taller.
  const loadAllAbsences = async (): Promise<Ausencia[]> => {
    const data = await requestList<Ausencia>("ausencias/");
    setAbsences(data);
    return data;
  };

  return {
    people,
    options,
    person,
    editing,
    form,
    setForm,
    hours,
    setHours,
    absences,
    absence,
    setAbsence,
    capacity,
    reservations,
    week,
    setWeek,
    search,
    setSearch,
    area,
    setArea,
    status,
    setStatus,
    loading,
    saving,
    consulting,
    error,
    notice,
    setError,
    setNotice,
    filtered,
    totalActive,
    areaName,
    load,
    loadOperations,
    loadHours,
    loadAbsences,
    loadCapacity,
    loadAllAbsences,
    startNew,
    edit,
    cancelEdit,
    savePerson,
    toggleActive,
    selectPerson,
    saveHours,
    saveAbsence,
    updateAbsence,
    deleteAbsence,
  };
}
