import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from 'lucide-react';
import { roleProfiles } from '../data/roles';
import { fmtLong, TODAY } from '../utils/dates';

export function RoleSelect() {
  return (
    <div className="grid min-h-screen w-full bg-ivory lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="flex flex-col justify-between bg-cream px-8 py-10 md:px-14 md:py-14">
        <div>
          <p className="font-display text-5xl font-semibold leading-none text-cocoa">Fiancée</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-gold">Alta Costura · Arequipa</p>
        </div>
        <blockquote className="my-14 max-w-md">
          <p className="font-display text-3xl italic leading-snug text-cocoa-muted line-through decoration-nude decoration-1">“Creo que podemos hacerlo.”</p>
          <p className="mt-6 font-display text-[1.7rem] leading-snug text-cocoa">
            “Tenemos 47 horas disponibles, el vestido requiere 32 y el proceso crítico tiene 8 libres: es viable con un margen de 6 días.”
          </p>
        </blockquote>
        <p className="text-xs capitalize text-cocoa-muted">{fmtLong(TODAY)} · Taller A y Taller C</p>
      </aside>

      <main className="flex items-center px-6 py-12 md:px-14">
        <div className="w-full max-w-xl">
          <h1 className="font-display text-4xl font-semibold text-cocoa">¿Quién ingresa?</h1>
          <p className="mt-2 text-sm text-cocoa-muted">Cada perfil ve solo lo que necesita para su trabajo.</p>
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {roleProfiles.map((r) =>
            <li key={r.id}>
                <Link to={r.home} className="group flex items-center gap-5 py-5 transition-colors duration-150 hover:bg-cream/50 md:px-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blush-soft text-sm font-semibold text-blush-deep">{r.initials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-cocoa">
                      {r.label} <span className="font-normal text-cocoa-muted">· {r.person}</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-cocoa-muted">{r.description}</span>
                  </span>
                  <ArrowRightIcon className="h-5 w-5 shrink-0 text-cocoa-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-cocoa" aria-hidden="true" />
                </Link>
              </li>
            )}
          </ul>
        </div>
      </main>
    </div>);

}