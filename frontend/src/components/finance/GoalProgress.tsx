import React from 'react';
import { FinanceSettings } from '../../types';
import { computeFinance } from '../../utils/finance';
import { cn, fmtMoney, fmtPct } from '../../utils/format';

interface GoalProgressProps {
  settings: FinanceSettings;
  summary: ReturnType<typeof computeFinance>;
  size?: 'lg' | 'sm';
}

export function GoalProgress({ settings, summary, size = 'lg' }: GoalProgressProps) {
  const goal = settings.monthlyGoal;
  const scale = Math.max(goal, summary.breakEven, summary.revenue) * 1.05;
  const pct = (n: number) => `${Math.min(100, n / scale * 100)}%`;
  const coversFixed = summary.revenue >= summary.breakEven;

  return (
    <div>
      <div className={cn('grid gap-4', size === 'lg' ? 'sm:grid-cols-3' : 'grid-cols-3')}>
        <div>
          <p className="text-xs text-cocoa-muted">Meta mensual</p>
          <p className={cn('tabular font-semibold text-cocoa', size === 'lg' ? 'text-2xl' : 'text-lg')}>{fmtMoney(goal)}</p>
        </div>
        <div>
          <p className="text-xs text-cocoa-muted">Ingresos actuales</p>
          <p className={cn('tabular font-semibold text-cocoa', size === 'lg' ? 'text-2xl' : 'text-lg')}>{fmtMoney(summary.revenue)}</p>
        </div>
        <div>
          <p className="text-xs text-cocoa-muted">Faltan</p>
          <p className={cn('tabular font-semibold text-bad', size === 'lg' ? 'text-2xl' : 'text-lg')}>{fmtMoney(summary.gap)}</p>
        </div>
      </div>

      <div className="relative mt-4 pb-7 pt-6">
        <div className="relative h-3 overflow-hidden rounded-full bg-sand/70">
          <div className="h-full rounded-full bg-gold" style={{ width: pct(summary.revenue) }} />
        </div>
        <Marker left={pct(summary.breakEven)} label={`Equilibrio ${fmtMoney(summary.breakEven)}`} tone={coversFixed ? 'text-ok' : 'text-bad'} position="bottom" />
        <Marker left={pct(goal)} label={`Meta · ${fmtPct(summary.goalProgress)} logrado`} tone="text-cocoa" position="top" />
      </div>
      <p className="text-xs leading-relaxed text-cocoa-muted">
        {coversFixed ?
        'Los ingresos del mes ya cubren los gastos fijos y los materiales.' :
        `Faltan ${fmtMoney(summary.breakEven - summary.revenue)} para cubrir los gastos fijos (${fmtMoney(summary.fixed)}) y los materiales.`}
      </p>
    </div>);

}

function Marker({ left, label, tone, position }: {left: string;label: string;tone: string;position: 'top' | 'bottom';}) {
  return (
    <div className="absolute top-5 h-5 w-0.5 -translate-x-1/2 bg-cocoa" style={{ left }}>
      <span
        className={cn(
          'tabular absolute right-0 whitespace-nowrap text-[11px] font-medium',
          position === 'top' ? 'bottom-full mb-0.5' : 'top-full mt-0.5',
          tone
        )}>
        
        {label}
      </span>
    </div>);

}