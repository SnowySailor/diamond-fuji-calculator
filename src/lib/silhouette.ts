import { FUJI, type Place } from './constants';
import { offsetLatLng, pointAzAlt } from './geo';
import { skyOffset, type Target } from './events';

/** A silhouette vertex on the sky plane, degrees relative to the summit (x right, y up). */
export interface SkyPoint {
  x: number;
  y: number;
}

/**
 * Modelled radial elevation profile of Fuji (m above sea level at `r` metres from
 * Kengamine): a gently domed crater top, then concave ~32° flanks easing to the
 * ~900 m plain. Checked against the 5th stations (Fujinomiya 2400 m @ ~3 km,
 * Yoshida 2305 m @ ~3.8 km, Gotemba 1440 m @ ~6.8 km).
 */
export function modelElevation(r: number): number {
  if (r <= 450) return FUJI.elev - 50 * (r / 450) ** 2;
  return 900 + 2826 * Math.exp(-(r - 450) / 4500);
}

/**
 * Visible skyline: the upper envelope of sampled terrain lines on the sky.
 * Each line is treated as a continuous polyline, interpolated at every bin
 * centre, and the highest line wins. (Taking the max *sample* per bin instead
 * leaves sawtooth artefacts wherever bins are narrower than the sample spacing.)
 */
export function skyline(lines: SkyPoint[][], bins = 8000): SkyPoint[] {
  let w = 0;
  for (const line of lines) for (const p of line) w = Math.max(w, Math.abs(p.x));
  w = Math.min(w, 80);
  if (w === 0) return [];
  const bw = (2 * w) / bins;
  const raw = new Float64Array(bins).fill(-Infinity);
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i];
      const q = line[i + 1];
      const lo = Math.min(p.x, q.x);
      const hi = Math.max(p.x, q.x);
      const k0 = Math.max(0, Math.ceil((lo + w) / bw - 0.5));
      const k1 = Math.min(bins - 1, Math.floor((hi + w) / bw - 0.5));
      for (let k = k0; k <= k1; k++) {
        const x = -w + (k + 0.5) * bw;
        const y = hi === lo ? Math.max(p.y, q.y) : p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
        if (y > raw[k]) raw[k] = y;
      }
    }
  }
  const out: SkyPoint[] = [];
  for (let k = 0; k < bins; k++) if (raw[k] > -Infinity) out.push({ x: -w + (k + 0.5) * bw, y: raw[k] });
  return out;
}

export function projectPlaces(obs: Place, target: Target, places: Place[]): SkyPoint[] {
  const out: SkyPoint[] = [];
  for (const pl of places) {
    const p = pointAzAlt(obs, pl);
    if (p.distance < 50) continue;
    out.push(skyOffset(p, target));
  }
  return out;
}

/**
 * Sample points on lines perpendicular to the line of sight through the summit.
 * `alongOffsets` are metres along the sight line (negative = toward the observer).
 */
export function crossLines(
  target: Target,
  alongOffsets: number[],
  halfWidth: number,
  samples: number,
  summit: Place = FUJI,
): { lat: number; lng: number }[][] {
  const z = (target.az * Math.PI) / 180;
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  return alongOffsets.map((a) => {
    const line: { lat: number; lng: number }[] = [];
    for (let i = 0; i < samples; i++) {
      const b = -halfWidth + (2 * halfWidth * i) / (samples - 1);
      line.push(offsetLatLng(summit, a * sz + b * cz, a * cz - b * sz));
    }
    return line;
  });
}

/** Skyline of the modelled (axisymmetric) mountain as seen from `obs`. */
export function modelSilhouette(obs: Place, target: Target, summit: Place = FUJI): SkyPoint[] {
  const along: number[] = [];
  for (let a = -3000; a <= 3000; a += 250) along.push(a);
  const n = 801;
  const lines = crossLines(target, along, 20000, n, summit).map((line, li) =>
    projectPlaces(
      obs,
      target,
      line.map((ll, i) => ({ ...ll, elev: modelElevation(Math.hypot(along[li], -20000 + (40000 * i) / (n - 1))) })),
    ),
  );
  return skyline(lines);
}

/** Radius around Kengamine treated as "the summit" (covers the ~800 m crater). */
export const SUMMIT_ZONE_M = 1200;

export interface LineOfSight {
  clear: boolean;
  /** Summit altitude minus the highest obstruction's altitude, degrees. */
  marginDeg: number;
  worst?: Place & { distanceKm: number };
}

/**
 * Whether terrain sampled along the observer→summit path hides the summit.
 * Ignores the first 300 m (the observer's own ground) and the last 1.2 km: that is
 * Fuji's own crater, whose near rim can stand higher than Kengamine from close
 * range. That rim is where the sun actually sits, so it isn't an obstruction.
 */
export function lineOfSight(obs: Place, target: Target, samples: Place[]): LineOfSight {
  let maxAlt = -Infinity;
  let worst: LineOfSight['worst'];
  for (const s of samples) {
    const p = pointAzAlt(obs, s);
    if (p.distance < 300 || target.distance - p.distance < SUMMIT_ZONE_M) continue;
    if (p.alt > maxAlt) {
      maxAlt = p.alt;
      worst = { ...s, distanceKm: p.distance / 1000 };
    }
  }
  if (!worst) return { clear: true, marginDeg: Infinity };
  const marginDeg = target.alt - maxAlt;
  return { clear: marginDeg > 0, marginDeg, worst };
}
