import React from 'react';
import { Tone } from '../../types';
import { cn, toneBar, toneSoft } from '../../utils/format';

interface StatusPillProps {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}

export function StatusPill({ tone, children, className }: StatusPillProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', toneSoft[tone], className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', toneBar[tone])} aria-hidden="true" />
      {children}
    </span>);

}