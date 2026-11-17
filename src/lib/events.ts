import { FUJI, JST_OFFSET_MS, type Place } from './constants';
import { angularSeparation, inverse, pointAzAlt, wrap180 } from './geo';
import {
  bodyPosition,
  makeObserver,
  moonPhase,
  searchAltitude,
  unrefract,
  type BodyName,
  type BodyPosition,
} from './astro';

export interface Target {
  /** Azimuth of the summit from the observer, degrees. */
  az: number;
  /** Apparent altitude of the summit, degrees (curvature + terrestrial refraction). */
  alt: number;
  geomAlt: number;
  /** Geodesic ground distance to the summit, metres. */
  distance: number;
}

export function summitTarget(obs: Place, summit: Place = FUJI): Target {
  const p = pointAzAlt(obs, summit);
  const { distance } = inverse(obs, summit);
  return { az: p.az, alt: p.alt, geomAlt: p.geomAlt, distance };
}

export type AlignmentKind = 'center' | 'disk' | 'near' | 'far';

export interface Alignment {
  body: BodyName;
  direction: 'rising' | 'setting';
  /** JST calendar date of the event, YYYY-MM-DD. */
  date: string;
  /** When the body's centre crosses the summit's apparent altitude. */
  crossTime: Date;
  /** When the body's centre passes closest to the summit. */
  bestTime: Date;
  /** Closest angular distance between body centre and summit, degrees. */
  missDeg: number;
  /** Horizontal offset at the crossing, degrees on the sky (+ = right of summit). */
  offsetDeg: number;
  semidiameter: number;
  kind: AlignmentKind;
  /** Moon only. */
  illum?: number;
  waxing?: boolean;
  /** Moon only: the sun's altitude at that moment (daylight vs night). */
  sunAlt?: number;
}

export const CENTER_TOLERANCE_DEG = 0.05;
export const NEAR_TOLERANCE_DEG = 1;

export function classify(missDeg: number, semidiameter: number): AlignmentKind {
  if (missDeg <= CENTER_TOLERANCE_DEG) return 'center';
  if (missDeg <= semidiameter) return 'disk';
  if (missDeg <= NEAR_TOLERANCE_DEG) return 'near';
  return 'far';
}

export function jstDateString(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST midnight at the start of the given day (month 0-based, day may overflow). */
export function jstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - JST_OFFSET_MS);
}

/** Root of f between t0±window, by bracket expansion + Illinois regula falsi. */
function findRoot(f: (t: number) => number, t0: number): number | null {
  let step = 60_000;
  let a = t0 - step;
  let b = t0 + step;
  let fa = f(a);
  let fb = f(b);
  while (fa * fb > 0) {
    step *= 2;
    if (step > 2 * 3600_000) return null;
    a = t0 - step;
    b = t0 + step;
    fa = f(a);
    fb = f(b);
  }
  let side = 0;
  for (let i = 0; i < 60 && Math.abs(b - a) > 50; i++) {
    const c = (a * fb - b * fa) / (fb - fa);
    const fc = f(c);
    if (fc === 0) return c;
    if (fc * fb > 0) {
      b = c;
      fb = fc;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      a = c;
      fa = fc;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return (a + b) / 2;
}

/** Sky-plane offset (deg) of a body from the summit: x right, y up. */
export function skyOffset(pos: { az: number; alt: number }, target: Target) {
  return {
    x: wrap180(pos.az - target.az) * Math.cos((target.alt * Math.PI) / 180),
    y: pos.alt - target.alt,
  };
}

export interface YearResult {
  target: Target;
  body: BodyName;
  direction: 'rising' | 'setting';
  /** One entry per crossing of the summit altitude, in time order. */
  crossings: Alignment[];
}

/**
 * Every time in `year` (JST) that the sun or moon crosses the summit's apparent
 * altitude on the summit's side of the sky, with how close it passes.
 */
export function computeYear(obs: Place, year: number, body: BodyName, summit: Place = FUJI): YearResult {
  const target = summitTarget(obs, summit);
  const direction: 'rising' | 'setting' = target.az < 180 ? 'rising' : 'setting';
  const dir = direction === 'rising' ? 1 : -1;
  const observer = makeObserver(obs);
  const geomTarget = unrefract(target.alt, obs.elev);
  const pos = (t: number) => bodyPosition(body, new Date(t), obs, observer);
  const altDiff = (t: number) => pos(t).alt - target.alt;

  const crossings: Alignment[] = [];
  const evaluate = (guess: Date) => {
    const tc = findRoot(altDiff, guess.getTime());
    if (tc === null) return;
    const ev = describe(obs, body, tc, pos, target, direction);
    if (ev) crossings.push(ev);
  };

  const yearEnd = jstMidnight(year + 1, 0, 1).getTime();
  if (body === 'sun') {
    for (let d = 0; ; d++) {
      const start = jstMidnight(year, 0, 1 + d);
      if (start.getTime() >= yearEnd) break;
      const t = searchAltitude('sun', observer, dir, start, 1, geomTarget);
      if (t) evaluate(t);
    }
  } else {
    let start = jstMidnight(year, 0, 1);
    for (;;) {
      const t = searchAltitude('moon', observer, dir, start, 3, geomTarget);
      if (!t || t.getTime() >= yearEnd) break;
      evaluate(t);
      start = new Date(t.getTime() + 0.6 * 86400_000);
    }
  }
  return { target, body, direction, crossings };
}

function describe(
  obs: Place,
  body: BodyName,
  tc: number,
  pos: (t: number) => BodyPosition,
  target: Target,
  direction: 'rising' | 'setting',
): Alignment | null {
  const pc = pos(tc);
  const P = skyOffset(pc, target);
  // Velocity on the sky (deg/ms) from a symmetric difference.
  const h = 30_000;
  const p1 = skyOffset(pos(tc - h), target);
  const p2 = skyOffset(pos(tc + h), target);
  const vx = (p2.x - p1.x) / (2 * h);
  const vy = (p2.y - p1.y) / (2 * h);
  const v2 = vx * vx + vy * vy;
  if (v2 === 0) return null;
  // Closest approach of the (locally straight) path to the summit at the origin.
  const tBest = tc - (P.x * vx + P.y * vy) / v2;
  const pb = pos(tBest);
  const missDeg = angularSeparation(pb.az, pb.alt, target.az, target.alt);
  const ev: Alignment = {
    body,
    direction,
    date: jstDateString(new Date(tc)),
    crossTime: new Date(tc),
    bestTime: new Date(tBest),
    missDeg,
    offsetDeg: P.x,
    semidiameter: pb.semidiameter,
    kind: classify(missDeg, pb.semidiameter),
  };
  if (body === 'moon') {
    const ph = moonPhase(new Date(tBest));
    ev.illum = ph.illum;
    ev.waxing = ph.waxing;
    ev.sunAlt = bodyPosition('sun', new Date(tBest), obs).alt;
  }
  return ev;
}

export interface Season {
  events: Alignment[];
  best: Alignment;
}

/** Group near-alignments into runs of consecutive dates, each with its best day. */
export function seasons(crossings: Alignment[], maxMiss = NEAR_TOLERANCE_DEG, gapDays = 3): Season[] {
  const near = crossings.filter((c) => c.missDeg <= maxMiss);
  const out: Season[] = [];
  let cur: Alignment[] = [];
  const flush = () => {
    if (cur.length) {
      out.push({ events: cur, best: cur.reduce((a, b) => (b.missDeg < a.missDeg ? b : a)) });
      cur = [];
    }
  };
  for (const c of near) {
    const prev = cur[cur.length - 1];
    if (prev && c.crossTime.getTime() - prev.crossTime.getTime() > gapDays * 86400_000) flush();
    cur.push(c);
  }
  flush();
  return out;
}
