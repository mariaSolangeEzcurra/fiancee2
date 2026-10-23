import React from 'react';
import { cn } from '../../utils/format';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-cocoa-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-cocoa-faint">{hint}</p>}
    </div>);

}