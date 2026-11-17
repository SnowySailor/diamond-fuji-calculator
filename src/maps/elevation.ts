import type { LatLng, Place } from '../lib/constants';
import { FUJI } from '../lib/constants';
import type { Target } from '../lib/events';
import { crossLines } from '../lib/silhouette';

/**
 * Thin wrapper over google.maps.ElevationService. Every call resolves to null
 * when the Elevation API is unavailable (key not allowed to call it, quota,
 * offline). After a REQUEST_DENIED we pause for a short while instead of firing
 * the 11 terrain requests that would fail too, then try again, so fixing the
 * key in the Cloud console takes effect without a reload.
 */

const DENIAL_BACKOFF_MS = 30_000;

let service: google.maps.ElevationService | null = null;
let denied: { reason: string; at: number } | null = null;
const cache = new Map<string, unknown>();

export function elevationUnavailableReason(): string | null {
  return denied?.reason ?? null;
}

async function getService(): Promise<google.maps.ElevationService | null> {
  if (denied && Date.now() - denied.at < DENIAL_BACKOFF_MS) return null;
  if (!service) {
    if (!window.google?.maps) return null;
    const { ElevationService } = (await google.maps.importLibrary('elevation')) as google.maps.ElevationLibrary;
    service = new ElevationService();
  }
  return service;
}

function noteError(err: unknown) {
  const code = (err as { code?: string })?.code ?? '';
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'REQUEST_DENIED' || /denied|not authorized|not activated|disabled/i.test(msg)) {
    denied = { reason: "Google refused the Elevation request: the API key isn't allowed to use the Elevation API", at: Date.now() };
  }
  console.warn('Elevation request failed:', msg);
}

const key = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

export async function groundElevation(p: LatLng): Promise<number | null> {
  const k = 'g:' + key(p);
  if (cache.has(k)) return cache.get(k) as number;
  const svc = await getService();
  if (!svc) return null;
  try {
    const { results } = await svc.getElevationForLocations({ locations: [p] });
    const e = results[0]?.elevation;
    if (typeof e !== 'number') return null;
    denied = null;
    cache.set(k, e);
    return e;
  } catch (err) {
    noteError(err);
    return null;
  }
}

async function alongPath(svc: google.maps.ElevationService, a: LatLng, b: LatLng, samples: number): Promise<Place[]> {
  const { results } = await svc.getElevationAlongPath({ path: [a, b], samples });
  return results.map((r) => ({ lat: r.location!.lat(), lng: r.location!.lng(), elev: r.elevation }));
}

export interface TerrainSamples {
  /** Lines of points across Fuji, for the real skyline. */
  ridge: Place[][];
  /** Points along the observer → summit line, for the line-of-sight check. */
  sightline: Place[];
}

/**
 * Terrain for the visualisation and line-of-sight check: 11 path requests.
 * Wide lines (±20 km) at 2 km spacing give the flanks; dense lines (±2.5 km)
 * across the crater give the summit's real shape.
 */
export async function terrainSamples(obs: LatLng, target: Target): Promise<TerrainSamples | null> {
  const k = 't:' + key(obs);
  if (cache.has(k)) return cache.get(k) as TerrainSamples;
  const svc = await getService();
  if (!svc) return null;
  const wide = crossLines(target, [-4000, -2000, 0, 2000, 4000], 20000, 2);
  const dense = crossLines(target, [-600, -300, 0, 300, 600], 2500, 2);
  try {
    const parts = await Promise.all([
      ...wide.map(([a, b]) => alongPath(svc, a, b, 512)),
      ...dense.map(([a, b]) => alongPath(svc, a, b, 512)),
    ]);
    const sightline = await alongPath(svc, obs, FUJI, 512);
    const out = { ridge: parts, sightline };
    cache.set(k, out);
    return out;
  } catch (err) {
    noteError(err);
    return null;
  }
}
