import { Geodesic } from 'geographiclib-geodesic';
import {
  EARTH_R,
  TERRESTRIAL_K,
  WGS84_A,
  WGS84_E2,
  type LatLng,
  type Place,
} from './constants';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const geod = Geodesic.WGS84;

export const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
/** Wrap an angle to (-180, 180]. */
export const wrap180 = (deg: number) => {
  const d = norm360(deg);
  return d > 180 ? d - 360 : d;
};

/** Geodesic distance (m) and initial azimuth (deg, 0 = north, clockwise) from a to b. */
export function inverse(a: LatLng, b: LatLng): { distance: number; azimuth: number } {
  const r = geod.Inverse(a.lat, a.lng, b.lat, b.lng);
  return { distance: r.s12 ?? 0, azimuth: norm360(r.azi1 ?? 0) };
}

/** Point reached by travelling `distance` metres from `p` along initial azimuth `az`. */
export function direct(p: LatLng, az: number, distance: number): LatLng {
  const r = geod.Direct(p.lat, p.lng, az, distance);
  return { lat: r.lat2 ?? p.lat, lng: r.lon2 ?? p.lng };
}

type Vec3 = [number, number, number];

export function toEcef(p: Place): Vec3 {
  const phi = p.lat * D2R;
  const lam = p.lng * D2R;
  const s = Math.sin(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  return [
    (n + p.elev) * Math.cos(phi) * Math.cos(lam),
    (n + p.elev) * Math.cos(phi) * Math.sin(lam),
    (n * (1 - WGS84_E2) + p.elev) * s,
  ];
}

/** East/North/Up components (m) of `pt` relative to `obs`. */
export function enu(obs: Place, pt: Place): Vec3 {
  const o = toEcef(obs);
  const t = toEcef(pt);
  const dx = t[0] - o[0];
  const dy = t[1] - o[1];
  const dz = t[2] - o[2];
  const phi = obs.lat * D2R;
  const lam = obs.lng * D2R;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const sl = Math.sin(lam);
  const cl = Math.cos(lam);
  return [
    -sl * dx + cl * dy,
    -sp * cl * dx - sp * sl * dy + cp * dz,
    cp * cl * dx + cp * sl * dy + sp * dz,
  ];
}

export interface AzAlt {
  /** Azimuth, degrees clockwise from true north. */
  az: number;
  /** Apparent altitude, degrees (includes terrestrial refraction). */
  alt: number;
  /** Geometric altitude, degrees (Earth curvature, no refraction). */
  geomAlt: number;
  /** Straight-line distance, metres. */
  distance: number;
}

/**
 * Where a terrestrial point appears from `obs`. Earth curvature falls out of the
 * ellipsoidal ENU geometry; refraction bends the ray by k·s/(2R).
 */
export function pointAzAlt(obs: Place, pt: Place, k = TERRESTRIAL_K): AzAlt {
  const [e, n, u] = enu(obs, pt);
  const horiz = Math.hypot(e, n);
  const distance = Math.hypot(horiz, u);
  const geomAlt = Math.atan2(u, horiz) * R2D;
  const refr = ((k * distance) / (2 * EARTH_R)) * R2D;
  return { az: norm360(Math.atan2(e, n) * R2D), alt: geomAlt + refr, geomAlt, distance };
}

/** Great-circle angular separation (deg) between two horizontal-coordinate directions. */
export function angularSeparation(az1: number, alt1: number, az2: number, alt2: number): number {
  const a1 = alt1 * D2R;
  const a2 = alt2 * D2R;
  const dAz = (az2 - az1) * D2R;
  const h =
    Math.sin((a2 - a1) / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dAz / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * R2D;
}

/** Quick local offset (metres east/north) to lat/lng; fine within a few tens of km. */
export function offsetLatLng(p: LatLng, east: number, north: number): LatLng {
  const m = 111320;
  return { lat: p.lat + north / 110574, lng: p.lng + east / (m * Math.cos(p.lat * D2R)) };
}
