import React, { useEffect, useState } from "react";
import { CalendarDays, Clock3, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import {
  obtenerMiDisponibilidad,
  type MiDisponibilidadTaller,
} from "../../services/tallerApi";

const cardClass =
  "rounded-2xl border border-[#EDE5DF] bg-white p-4 shadow-[0_2px_12px_rgba(60,40,25,0.025)] sm:p-5";

export function MySchedule() {
  const [horario, setHorario] =
    useState<MiDisponibilidadTaller | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarHorario = async () => {
      try {
        const respuesta = await obtenerMiDisponibilidad();
        setHorario(respuesta);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo cargar tu horario."
        );
      } finally {
        setCargando(false);
      }
    };

    cargarHorario();
  }, []);

  return (
    <main className="min-h-full space-y-5 bg-[#FCFAF7] p-3 text-[#44352D] sm:space-y-6 sm:p-6 lg:p-8">
      {/* ENCABEZADO */}
      <header>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#B18A6A]">
          Mi espacio / Horario
        </p>

        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Mi horario
        </h1>

        <p className="mt-1 text-sm text-[#928176]">
          Consulta los días y las horas que tienes configurados.
        </p>
      </header>

      {/* CONTENIDO */}
      {cargando ? (
        <section className={`${cardClass} flex min-h-48 flex-col items-center justify-center gap-3 text-center`}>
          <div className="rounded-xl bg-[#F8F0E9] p-3 text-[#99704F]">
            <LoaderCircle size={22} className="animate-spin" />
          </div>

          <p className="text-sm text-[#928176]">
            Cargando tu horario...
          </p>
        </section>
      ) : horario ? (
        <>
          {/* RESUMEN */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#928176]">
                    Días configurados
                  </p>

                  <p className="mt-2 font-display text-2xl font-semibold text-[#44352D] sm:text-3xl">
                    {horario.total_dias_configurados}
                  </p>

                  <p className="mt-1 text-xs text-[#A2958B]">
                    Días de trabajo registrados
                  </p>
                </div>

                <div className="rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
                  <CalendarDays size={19} />
                </div>
              </div>
            </div>

            <div className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#928176]">
                    Días con horario
                  </p>

                  <p className="mt-2 font-display text-2xl font-semibold text-[#44352D] sm:text-3xl">
                    {horario.disponibilidad.length}
                  </p>

                  <p className="mt-1 text-xs text-[#A2958B]">
                    Registros de disponibilidad
                  </p>
                </div>

                <div className="rounded-xl bg-[#F8F0E9] p-2.5 text-[#99704F]">
                  <Clock3 size={19} />
                </div>
              </div>
            </div>
          </section>

          {/* HORARIO SEMANAL */}
          <section className={cardClass}>
            <div className="mb-5 flex flex-col gap-1">
              <h2 className="font-display text-lg font-semibold">
                Horario de trabajo
              </h2>

              <p className="text-sm text-[#928176]">
                {horario.trabajadora}
              </p>
            </div>

            {horario.disponibilidad.length > 0 ? (
              <div className="space-y-2">
                {horario.disponibilidad.map((dia) => (
                  <article
                    key={dia.id}
                    className="flex flex-col gap-3 rounded-xl border border-[#EFE7E1] p-3.5 transition hover:bg-[#FCFAF7] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F8F0E9] text-[#99704F]">
                        <CalendarDays size={18} />
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium capitalize text-[#44352D]">
                          {dia.dia_nombre}
                        </p>

                        <p className="mt-0.5 text-xs text-[#A2958B]">
                          Disponibilidad del día
                        </p>
                      </div>
                    </div>

                    <div className="flex w-fit items-center gap-2 rounded-lg bg-[#FAF6F2] px-3 py-2 text-sm text-[#79685D]">
                      <Clock3 size={16} className="shrink-0 text-[#99704F]" />

                      <span>
                        <strong className="font-semibold text-[#44352D]">
                          {dia.horas_disponibles}
                        </strong>{" "}
                        horas
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="px-4 py-12 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F8F0E9] text-[#99704F]">
                  <CalendarDays size={20} />
                </div>

                <p className="text-sm text-[#928176]">
                  No tienes días ni horas configurados actualmente.
                </p>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className={cardClass}>
          <div className="px-4 py-12 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F8F0E9] text-[#99704F]">
              <CalendarDays size={20} />
            </div>

            <p className="text-sm text-[#928176]">
              No se pudo cargar tu horario.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
