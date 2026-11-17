import { TIME_ZONE } from './lib/constants';

const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const timeSec = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateLong = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dateShort = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });

export const fmtTime = (d: Date, seconds = false) => (seconds ? timeSec : time).format(d);
export const fmtDateLong = (d: Date) => dateLong.format(d);
export const fmtDateShort = (d: Date) => dateShort.format(d);

/** Angle in arcminutes (arcseconds when tiny, degrees when large). */
export function fmtArcmin(deg: number): string {
  const m = Math.abs(deg) * 60;
  if (m >= 90) return `${Math.abs(deg).toFixed(1)}°`;
  if (m < 1) return `${(m * 60).toFixed(0)}″`;
  return `${m.toFixed(m < 10 ? 1 : 0)}′`;
}
