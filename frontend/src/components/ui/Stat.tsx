import React from 'react';
import { Tone } from '../../types';
import { cn, toneText } from '../../utils/format';

interface StatProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  size?: 'md' | 'lg';
  className?: string;
}

export function Stat({ label, value, sub, tone, size = 'md', className }: StatProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs font-medium text-cocoa-muted">{label}</p>
      <p className={cn('tabular mt-1 font-semibold leading-tight', size === 'lg' ? 'text-3xl' : 'text-xl', tone ? toneText[tone] : 'text-cocoa')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-cocoa-faint">{sub}</p>}
    </div>);

}