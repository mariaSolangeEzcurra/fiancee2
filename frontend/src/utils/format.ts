import { Tone } from '../types';

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const roundHalf = (n: number) => Math.round(n * 2) / 2;

export function fmtH(h: number): string {
  return `${round1(h).toLocaleString('es-PE', { maximumFractionDigits: 1 })} h`;
}

export function fmtNum(n: number): string {
  return round1(n).toLocaleString('es-PE', { maximumFractionDigits: 1 });
}

export function fmtPct(u: number): string {
  return `${Math.round(u * 100)}%`;
}

export function fmtMoney(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}S/ ${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function fmtDuration(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export function utilTone(u: number): Tone {
  if (u >= 1) return 'bad';
  if (u >= 0.85) return 'risk';
  return 'ok';
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  risk: 'text-risk',
  bad: 'text-bad',
  neutral: 'text-cocoa-muted'
};

export const toneSoft: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  risk: 'bg-risk-soft text-risk',
  bad: 'bg-bad-soft text-bad',
  neutral: 'bg-cream text-cocoa-muted'
};

export const toneBar: Record<Tone, string> = {
  ok: 'bg-ok',
  risk: 'bg-gold-soft',
  bad: 'bg-bad',
  neutral: 'bg-nude'
};

export const inputClass =
'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-cocoa placeholder:text-cocoa-faint focus:border-gold-soft focus:outline-none focus:ring-2 focus:ring-gold-soft/40';