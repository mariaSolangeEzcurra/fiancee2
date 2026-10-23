import React from 'react';
import { Tone } from '../../types';
import { cn, toneBar, utilTone } from '../../utils/format';

interface MeterProps {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}

export function Meter({ value, tone, className, label }: MeterProps) {
  const t = tone ?? utilTone(value);
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={label}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-sand/70', className)}>
      
      <div className={cn('h-full rounded-full', toneBar[t])} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>);

}