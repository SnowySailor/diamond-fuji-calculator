import { FUJI_CENTER, type Place } from './constants';
import { inverse, pointAzAlt, wrap180 } from './geo';

/** What the sun or moon has to line up with, as seen from the observer. */
export interface Target {
  /** Azimuth of the middle of the summit, degrees. */
  az: number;
  /** Apparent altitude of the visible summit ridge in that direction, degrees. */
  alt: number;
  geomAlt: number;
  /** Ground distance to the crater centre, metres. */
  distance: number;
}

/** A point on the sky plane, degrees relative to the target (x right, y up). */
export interface SkyPoint {
  x: number;
  y: number;
}

/** Sky-plane offset (deg) of a direction from the target: x right, y up. */
export function skyOffset(pos: { az: number; alt: number }, target: Target): SkyPoint {
  return {
    x: wrap180(pos.az - target.az) * Math.cos((target.alt * Math.PI) / 180),
    y: pos.alt - target.alt,
  };
}

/**
 * First-guess target: the direction of the crater centre, at typical rim height.
 * The direction is what decides the date; `settleTarget` then lifts or lowers the
 * altitude to the actual skyline, which only nudges the time.
 */
export function aimTarget(obs: Place): Target {
  const p = pointAzAlt(obs, FUJI_CENTER);
  const { distance } = inverse(obs, FUJI_CENTER);
  return { az: p.az, alt: p.alt, geomAlt: p.geomAlt, distance };
}
