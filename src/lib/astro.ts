import * as Astronomy from 'astronomy-engine';
import { KM_PER_AU, MOON_RADIUS_KM, PRESSURE_SCALE_HEIGHT, type Place } from './constants';

export type BodyName = 'sun' | 'moon';

export interface BodyPosition {
  az: number;
  /** Apparent altitude of the body's centre, refraction included. */
  alt: number;
  /** Geometric (airless) topocentric altitude. */
  geomAlt: number;
  /** Apparent angular radius, degrees. */
  semidiameter: number;
  distanceKm: number;
}

const BODY = { sun: Astronomy.Body.Sun, moon: Astronomy.Body.Moon } as const;

export function makeObserver(p: Place): Astronomy.Observer {
  return new Astronomy.Observer(p.lat, p.lng, p.elev);
}

/**
 * Astronomical refraction for a body at geometric altitude `geomAlt`, using the
 * Saemundsson formula (10 °C, 1010 hPa) scaled for the lower pressure at elevation.
 */
export function refraction(geomAlt: number, elev: number): number {
  return Astronomy.Refraction('normal', geomAlt) * Math.exp(-Math.max(0, elev) / PRESSURE_SCALE_HEIGHT);
}

/** Geometric altitude whose refracted (apparent) altitude is `apparentAlt`. */
export function unrefract(apparentAlt: number, elev: number): number {
  let h = apparentAlt;
  for (let i = 0; i < 6; i++) h = apparentAlt - refraction(h, elev);
  return h;
}

export function bodyPosition(
  body: BodyName,
  date: Date,
  place: Place,
  observer: Astronomy.Observer = makeObserver(place),
): BodyPosition {
  const eq = Astronomy.Equator(BODY[body], date, observer, true, true);
  const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec);
  const distanceKm = eq.dist * KM_PER_AU;
  const semidiameter =
    body === 'sun'
      ? 959.63 / 3600 / eq.dist
      : (Math.asin(MOON_RADIUS_KM / distanceKm) * 180) / Math.PI;
  return {
    az: hor.azimuth,
    alt: hor.altitude + refraction(hor.altitude, place.elev),
    geomAlt: hor.altitude,
    semidiameter,
    distanceKm,
  };
}

export interface MoonPhaseInfo {
  /** Illuminated fraction 0..1. */
  illum: number;
  /** Ecliptic elongation 0..360 (0 new, 180 full). */
  phaseDeg: number;
  waxing: boolean;
}

export function moonPhase(date: Date): MoonPhaseInfo {
  const ill = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const phaseDeg = Astronomy.MoonPhase(date);
  return { illum: ill.phase_fraction, phaseDeg, waxing: phaseDeg < 180 };
}

export function searchAltitude(
  body: BodyName,
  observer: Astronomy.Observer,
  direction: 1 | -1,
  start: Date,
  limitDays: number,
  geomAlt: number,
): Date | null {
  const t = Astronomy.SearchAltitude(BODY[body], observer, direction, start, limitDays, geomAlt);
  return t ? t.date : null;
}
