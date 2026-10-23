import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';

export const TODAY = new Date(
  new Date().getFullYear(),
  new Date().getMonth(),
  new Date().getDate()
);

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function isWorkingDay(d: Date): boolean {
  return d.getDay() !== 0;
}

/** Working days (Mon–Sat) in the interval (from, to]. Negative when `to` is before `from`. */
export function workingDaysBetween(from: Date, to: Date): number {
  const sign = to >= from ? 1 : -1;
  const start = sign === 1 ? from : to;
  const end = sign === 1 ? to : from;
  const cur = new Date(start);
  let count = 0;
  for (let i = 0; i < 1000; i++) {
    cur.setDate(cur.getDate() + 1);
    if (cur > end) break;
    if (isWorkingDay(cur)) count++;
  }
  return sign * count;
}

export function addWorkingDays(from: Date, n: number): Date {
  const cur = new Date(from);
  let added = 0;
  while (added < n) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur)) added++;
  }
  return cur;
}

export function addCalendarDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

const asDate = (d: Date | string) => typeof d === 'string' ? parseDate(d) : d;

export const fmtDate = (d: Date | string) => format(asDate(d), 'dd/MM/yyyy');
export const fmtShort = (d: Date | string) => format(asDate(d), 'dd/MM');
export const fmtLong = (d: Date | string) => format(asDate(d), "EEEE d 'de' MMMM", { locale: es });
export const fmtDayMonth = (d: Date | string) => format(asDate(d), "d 'de' MMM", { locale: es });

export function calendarDaysUntil(d: Date | string): number {
  return differenceInCalendarDays(asDate(d), TODAY);
}