import type { LatLng, Place } from '../lib/constants';
import type { Target } from '../lib/sky';
import { crossLines } from '../lib/silhouette';

/**
 * Elevation from GSI's DEM tiles (国土地理院 標高タイル, DEM10B): 256 px PNG tiles
 * that encode metres in their RGB values. They're free to use with attribution,
 * need no key, and allow cross-origin reads. They cover Japan, which is everywhere
 * Fuji can be seen from; the sea and other countries have no data.
 * https://maps.gsi.go.jp/development/demtile.html
 */

const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';
const TILE = 256;
/** DEM10B's own resolution: ~8 m pixels at Fuji's latitude. Lower zooms are resampled from it. */
const MAX_ZOOM = 14;
const D2R = Math.PI / 180;

/** Metres per pixel, row-major; null where GSI has no tile (open sea, outside Japan). */
type Tile = Float32Array | null;
const tiles = new Map<string, Promise<Tile>>();

/**
 * GSI's encoding: x = R·2¹⁶ + G·2⁸ + B in units of 0.01 m, two's complement over
 * 24 bits, with x = 2²³ meaning "no data" (returned as NaN).
 */
export function decodeGsi(r: number, g: number, b: number): number {
  const x = (r << 16) | (g << 8) | b;
  if (x === 0x800000) return NaN;
  return (x < 0x800000 ? x : x - 0x1000000) * 0.01;
}

/** Position in global pixel coordinates at zoom z (Web Mercator, as the tiles use). */
export function globalPixel(p: LatLng, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  return {
    x: ((p.lng + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(p.lat * D2R)) / Math.PI) / 2) * n,
  };
}

async function fetchTile(z: number, x: number, y: number): Promise<Tile> {
  if (y < 0 || y >= 2 ** z) return null;
  x = ((x % 2 ** z) + 2 ** z) % 2 ** z;
  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GSI elevation tile ${z}/${x}/${y}: HTTP ${res.status}`);
  // Decode without colour management or premultiplied alpha, which would change the values.
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const ctx = new OffscreenCanvas(TILE, TILE).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, TILE, TILE).data;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = decodeGsi(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]);
  return out;
}

/** Each tile is fetched once per session; a failed fetch is forgotten so it can be retried. */
function loadTile(z: number, x: number, y: number): Promise<Tile> {
  const k = `${z}/${x}/${y}`;
  let p = tiles.get(k);
  if (!p) {
    p = fetchTile(z, x, y);
    tiles.set(k, p);
    p.catch(() => tiles.delete(k));
  }
  return p;
}

/**
 * Elevations (m) at the given points from zoom-z tiles, bilinear between pixel
 * centres. NaN where there's no data. Rejects if a tile can't be fetched.
 */
async function sample(points: LatLng[], z: number): Promise<number[]> {
  const px = points.map((p) => {
    const g = globalPixel(p, z);
    return { x: g.x - 0.5, y: g.y - 0.5 }; // pixel centres sit at +0.5
  });
  const keys = new Set<string>();
  for (const { x, y } of px)
    for (const X of [Math.floor(x), Math.floor(x) + 1])
      for (const Y of [Math.floor(y), Math.floor(y) + 1]) keys.add(`${Math.floor(X / TILE)}/${Math.floor(Y / TILE)}`);
  const loaded = new Map<string, Tile>();
  await Promise.all(
    [...keys].map(async (k) => {
      const [x, y] = k.split('/').map(Number);
      loaded.set(k, await loadTile(z, x, y));
    }),
  );
  const at = (X: number, Y: number) => {
    const t = loaded.get(`${Math.floor(X / TILE)}/${Math.floor(Y / TILE)}`);
    if (!t) return NaN;
    const i = X - Math.floor(X / TILE) * TILE;
    const j = Y - Math.floor(Y / TILE) * TILE;
    return t[j * TILE + i];
  };
  return px.map(({ x, y }) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const v00 = at(x0, y0);
    const v10 = at(x0 + 1, y0);
    const v01 = at(x0, y0 + 1);
    const v11 = at(x0 + 1, y0 + 1);
    const v = (v00 * (1 - dx) + v10 * dx) * (1 - dy) + (v01 * (1 - dx) + v11 * dx) * dy;
    if (!Number.isNaN(v)) return v;
    // At the edge of the data (a coastline), use the nearest pixel instead.
    return at(Math.round(x), Math.round(y));
  });
}

export interface Ground {
  /** Metres above sea level; 0 when `sea` is set. */
  elev: number;
  /** GSI has no land data here: the sea, or outside Japan. */
  sea: boolean;
}

/** Ground elevation at a point, or null if the tiles couldn't be fetched. */
export async function groundElevation(p: LatLng): Promise<Ground | null> {
  try {
    const [e] = await sample([p], MAX_ZOOM);
    return Number.isNaN(e) ? { elev: 0, sea: true } : { elev: e, sea: false };
  } catch (err) {
    console.warn('Elevation lookup failed:', err);
    return null;
  }
}

export interface TerrainSamples {
  /** Lines of points across Fuji, for the real skyline. */
  ridge: Place[][];
}

async function sampleLines(lines: LatLng[][], z: number): Promise<Place[][]> {
  const flat = await sample(lines.flat(), z);
  let i = 0;
  // No data near Fuji means sea (Suruga Bay), so sea level.
  return lines.map((line) =>
    line.map((p) => {
      const e = flat[i++];
      return { ...p, elev: Number.isNaN(e) ? 0 : e };
    }),
  );
}

/**
 * Terrain across Fuji, as seen in the direction of `aim`. Wide lines (±20 km) at
 * 2 km spacing give the flanks, from zoom-11 tiles (~62 m pixels, matching the
 * 78 m sample spacing). Dense lines (±2.5 km) at 150 m spacing across the crater,
 * plus one along the line of sight through it, give the summit's real shape and
 * the rim height in the middle, from full-resolution tiles. Null if the tiles
 * couldn't be fetched.
 */
export async function terrainSamples(aim: Target): Promise<TerrainSamples | null> {
  const wide = crossLines(aim, [-4000, -2000, 0, 2000, 4000], 20000, 512);
  const dense = crossLines(aim, [-450, -300, -150, 0, 150, 300, 450], 2500, 512);
  const sight = crossLines(aim, [0], 1000, 256, 'along');
  try {
    const [w, d] = await Promise.all([sampleLines(wide, 11), sampleLines([...dense, ...sight], MAX_ZOOM)]);
    return { ridge: [...w, ...d] };
  } catch (err) {
    console.warn('Terrain lookup failed:', err);
    return null;
  }
}
