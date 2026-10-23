
import type { AreaNeed } from '../../types';
import {
  cn,
  fmtH,
  fmtPct,
  toneBar,
  toneText,
  utilTone,
} from '../../utils/format';
import { areaName } from '../../utils/processes';
import { Meter } from '../ui/Meter';

function isDemoName(name: string): boolean {
  return /^demo(?:\s|$)/i.test(name.trim());
}

export function AreaNeedsTable({
  areas,
}: {
  areas: AreaNeed[];
}) {
  if (areas.length === 0) {
    return (
      <div className="rounded-lg border border-line p-4 text-sm text-cocoa-muted">
        No hay operaciones con necesidades de capacidad identificadas
        en las áreas evaluadas.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-cocoa-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Área
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Horas requeridas
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Horas restantes
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Horas comprometidas
            </th>
            <th scope="col" className="w-44 py-2 pr-3 font-medium">
              Utilización calculada
            </th>
            <th scope="col" className="py-2 font-medium">
              Personal identificable
            </th>
          </tr>
        </thead>

        <tbody>
          {areas.map((area) => {
            const staff = [...new Set(area.staff)]
              .filter((name) => name.trim() && !isDemoName(name));

            const staffCount = staff.length;
            const utilization = Math.max(0, area.utilAfter);

            const utilizationLabel =
              utilization > 3 ? '>300%' : fmtPct(utilization);

            return (
              <tr
                key={area.area}
                className="border-b border-line/70 last:border-0"
              >
                <td className="py-3 pr-3">
                  <span className="flex items-center gap-2 font-medium text-cocoa">
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        toneBar[area.tone],
                      )}
                      aria-hidden="true"
                    />
                    {areaName(area.area)}
                  </span>
                </td>

                <td className="tabular py-3 pr-3 text-right font-semibold text-cocoa">
                  {fmtH(area.needed)}
                </td>

                <td
                  className={cn(
                    'tabular py-3 pr-3 text-right font-semibold',
                    toneText[area.tone],
                  )}
                >
                  {fmtH(area.available)}
                </td>

                <td className="tabular py-3 pr-3 text-right text-cocoa-muted">
                  {fmtH(area.committed)}
                </td>

                <td className="py-3 pr-3">
                  <div className="flex items-center gap-2">
                    <Meter
                      value={utilization}
                      tone={utilTone(
                        utilization > 1
                          ? 1
                          : utilization >= 0.9
                            ? 0.9
                            : utilization,
                      )}
                      label={`Utilización de ${areaName(area.area)}`}
                    />

                    <span className="tabular w-11 shrink-0 text-right text-xs text-cocoa-muted">
                      {utilizationLabel}
                    </span>
                  </div>
                </td>

                <td className="py-3 text-xs text-cocoa-muted">
                  {staffCount > 0 ? (
                    <div>
                      <span className="font-medium text-cocoa">
                        {staffCount}
                      </span>{' '}
                      {staffCount === 1 ? 'persona' : 'personas'}

                      <div
                        className="mt-1 max-w-48 truncate"
                        title={staff.join(', ')}
                      >
                        {staff.join(', ')}
                      </div>
                    </div>
                  ) : (
                    <span>
                      Sin personal identificable en el resultado
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 text-xs leading-relaxed text-cocoa-muted">
        Las horas restantes corresponden a la capacidad devuelta por
        Django. No garantizan que todas esas horas puedan utilizarse
        en la fecha de cada operación. Los nombres de demostración
        se ocultan, pero deben corregirse también en el origen de datos.
      </p>
    </div>
  );
}
