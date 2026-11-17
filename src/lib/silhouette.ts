import { CRATER_RADIUS_M, FUJI, FUJI_CENTER, type LatLng, type Place } from './constants';
import { offsetLatLng, pointAzAlt } from './geo';
import { aimTarget, skyOffset, type SkyPoint, type Target } from './sky';

export type { SkyPoint } from './sky';

const D2R = Math.PI / 180;
const M_PER_DEG_LAT = 110574;
const mPerDegLng = (lat: number) => 111320 * Math.cos(lat * D2R);

/** Kengamine relative to the crater centre, metres east/north. */
const KEN_E = (FUJI.lng - FUJI_CENTER.lng) * mPerDegLng(FUJI_CENTER.lat);
const KEN_N = (FUJI.lat - FUJI_CENTER.lat) * M_PER_DEG_LAT;

function radialElevation(r: number): number {
  const rim = FUJI_CENTER.elev;
  // Inside: a bowl ~230 m deep (the real crater floor is ~3540 m).
  if (r <= CRATER_RADIUS_M) return rim - 230 * (1 - (r / CRATER_RADIUS_M) ** 2);
  // Outside: concave ~32° flanks easing to the ~900 m plain.
  return 900 + (rim - 900) * Math.exp(-(r - CRATER_RADIUS_M) / 4500);
}

const KEN_BUMP = FUJI.elev - radialElevation(Math.hypot(KEN_E, KEN_N));

/**
 * Modelled elevation (m) at `east`/`north` metres from the crater centre: a crater
 * with a 3740 m rim, Kengamine as a bump on the south-west rim, then flanks checked
 * against the 5th stations (Fujinomiya 2400 m, Yoshida 2305 m, Gotemba 1440 m).
 */
export function modelElevation(east: number, north: number): number {
  const dk2 = (east - KEN_E) ** 2 + (north - KEN_N) ** 2;
  return radialElevation(Math.hypot(east, north)) + KEN_BUMP * Math.exp(-dk2 / (2 * 120 * 120));
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
  const put = (k: number, y: number) => {
    if (k >= 0 && k < bins && y > raw[k]) raw[k] = y;
  };
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i];
      const q = line[i + 1];
      const lo = Math.min(p.x, q.x);
      const hi = Math.max(p.x, q.x);
      const k0 = Math.ceil((lo + w) / bw - 0.5);
      const k1 = Math.floor((hi + w) / bw - 0.5);
      if (k1 < k0) {
        // Segment inside one bin (e.g. a line running along the sight line).
        put(Math.floor((lo + w) / bw), Math.max(p.y, q.y));
        continue;
      }
      for (let k = Math.max(0, k0); k <= Math.min(bins - 1, k1); k++) {
        const x = -w + (k + 0.5) * bw;
        put(k, p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x));
      }
    }
  }
  const out: SkyPoint[] = [];
  for (let k = 0; k < bins; k++) if (raw[k] > -Infinity) out.push({ x: -w + (k + 0.5) * bw, y: raw[k] });
  return out;
}

/** Interpolated skyline height (deg) at sky x, or null outside the sampled range. */
export function ridgeAt(sky: SkyPoint[], x: number): number | null {
  if (!sky.length || x < sky[0].x || x > sky[sky.length - 1].x) return null;
  let lo = 0;
  let hi = sky.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sky[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = sky[lo];
  const b = sky[hi];
  return b.x === a.x ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
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
 * Lines through the summit area for sampling terrain. `across` lines run
 * perpendicular to the line of sight at the given offsets along it (negative =
 * toward the observer); `along` lines run with the line of sight at the given
 * sideways offsets. Each is centred on the crater centre.
 */
export function crossLines(
  target: Target,
  alongOffsets: number[],
  halfWidth: number,
  samples: number,
  orientation: 'across' | 'along' = 'across',
  centre: LatLng = FUJI_CENTER,
): LatLng[][] {
  const z = target.az * D2R;
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  return alongOffsets.map((a) => {
    const line: LatLng[] = [];
    for (let i = 0; i < samples; i++) {
      const b = -halfWidth + (2 * halfWidth * i) / (samples - 1);
      // (s, t) = (metres along sight, metres to the right)
      const [s, t] = orientation === 'across' ? [a, b] : [b, a];
      line.push(offsetLatLng(centre, s * sz + t * cz, s * cz - t * sz));
    }
    return line;
  });
}

/** Skyline of the modelled mountain as seen from `obs`, relative to `aim`. */
export function modelSilhouette(obs: Place, aim: Target): SkyPoint[] {
  const across: number[] = [];
  for (let a = -3000; a < -650; a += 250) across.push(a);
  for (let a = -650; a <= 650; a += 25) across.push(a); // fine through the crater rim
  for (let a = 900; a <= 3000; a += 250) across.push(a);
  const toPlaces = (line: LatLng[]): Place[] =>
    line.map((ll) => ({
      ...ll,
      elev: modelElevation((ll.lng - FUJI_CENTER.lng) * mPerDegLng(FUJI_CENTER.lat), (ll.lat - FUJI_CENTER.lat) * M_PER_DEG_LAT),
    }));
  const wide = crossLines(aim, across, 20000, 801);
  const fine = crossLines(aim, across.filter((a) => Math.abs(a) <= 650), 1500, 301);
  const sight = crossLines(aim, [0], 1000, 401, 'along');
  const lines = [...wide, ...fine, ...sight].map((l) => projectPlaces(obs, aim, toPlaces(l)));
  return skyline(lines);
}

/**
 * Final target: the `aim` direction, lifted or lowered to where the skyline
 * actually is in that direction (from close range the near rim stands well above
 * rim height at the crater centre). Returns the skyline re-expressed relative to
 * the final target.
 */
export function settleTarget(aim: Target, sky: SkyPoint[]): { target: Target; sky: SkyPoint[] } {
  const y0 = ridgeAt(sky, 0);
  if (y0 === null) return { target: aim, sky };
  return {
    target: { ...aim, alt: aim.alt + y0, geomAlt: aim.geomAlt + y0 },
    sky: sky.map((p) => ({ x: p.x, y: p.y - y0 })),
  };
}

/** The target without terrain data: crater-centre direction on the modelled skyline. */
export function defaultTarget(obs: Place): Target {
  const aim = aimTarget(obs);
  return settleTarget(aim, modelSilhouette(obs, aim)).target;
}
