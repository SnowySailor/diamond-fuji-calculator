export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  /** Height above mean sea level, metres. */
  elev: number;
}

/**
 * Kengamine (剣ヶ峰), the highest point of Mt. Fuji: GSI survey point,
 * 35°21′39″N 138°43′39″E, 3776.24 m.
 */
export const FUJI: Place = { lat: 35.36083, lng: 138.7275, elev: 3776.24 };

/**
 * Centre of Fuji's summit crater (大内院, OpenStreetMap). Diamond Fuji is the sun
 * sitting in the *middle* of the summit (MLIT Kanto's definition: 頂上の真ん中),
 * and the crater centre is what projects to the middle of the flat top from any
 * direction. Kengamine is on the south-west rim, ~410 m away, so aiming at it
 * shifts the "best" day by up to a day from close or side-on viewpoints.
 * `elev` is a typical rim height (the rim peaks run 3722–3776 m).
 */
export const FUJI_CENTER: Place = { lat: 35.36354, lng: 138.73062, elev: 3740 };

/** Crater rim radius, metres (the crater is ~780 m across). */
export const CRATER_RADIUS_M = 390;

/** WGS84 ellipsoid. */
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/** Mean Earth radius (m), for refraction of terrestrial lines of sight. */
export const EARTH_R = 6371000;

/**
 * Coefficient of terrestrial refraction (ratio of Earth radius to light-ray radius).
 * 0.13 is the conventional surveying value; it varies with temperature gradient.
 */
export const TERRESTRIAL_K = 0.13;

/** Scale height (m) used to scale astronomical refraction by pressure at the observer. */
export const PRESSURE_SCALE_HEIGHT = 8434;

export const KM_PER_AU = 149597870.7;
export const MOON_RADIUS_KM = 1737.4;

export const JST_OFFSET_MS = 9 * 3600 * 1000;
export const TIME_ZONE = 'Asia/Tokyo';
