import React from 'react';
import { cn } from '../../utils/format';

interface SegmentedProps<T extends string> {
  options: {value: T;label: string;}[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('flex w-full rounded-lg border border-line bg-cream/70 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft',
              active ? 'bg-paper text-cocoa shadow-sm ring-1 ring-line' : 'text-cocoa-muted hover:text-cocoa'
            )}>
            
            {o.label}
          </button>);

      })}
    </div>);

}