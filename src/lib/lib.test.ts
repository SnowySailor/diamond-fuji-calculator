import { describe, expect, it } from 'vitest';
import { FUJI, type Place } from './constants';
import { inverse, pointAzAlt } from './geo';
import { bodyPosition, searchAltitude, makeObserver } from './astro';
import { computeYear, jstMidnight, seasons, summitTarget } from './events';
import { lineOfSight, modelSilhouette } from './silhouette';

const TOKYO_STATION: Place = { lat: 35.6812, lng: 139.7671, elev: 3 };
const fmtJst = (d: Date) =>
  d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

describe('geo', () => {
  it('Tokyo Station → Fuji is ~100 km at ~249.6°', () => {
    const r = inverse(TOKYO_STATION, FUJI);
    expect(r.distance / 1000).toBeGreaterThan(98);
    expect(r.distance / 1000).toBeLessThan(102);
    expect(r.azimuth).toBeGreaterThan(249.4);
    expect(r.azimuth).toBeLessThan(249.9);
    // ENU azimuth agrees with the geodesic azimuth.
    expect(Math.abs(pointAzAlt(TOKYO_STATION, FUJI).az - r.azimuth)).toBeLessThan(0.01);
  });

  it('summit altitude from Tokyo is about +1.7° (curvature + refraction)', () => {
    const t = summitTarget(TOKYO_STATION);
    // atan(3773/100k)=2.16°, minus curvature 0.45°, plus refraction 0.06°.
    expect(t.alt).toBeGreaterThan(1.6);
    expect(t.alt).toBeLessThan(1.85);
  });
});

describe('astro (vs NAOJ 暦計算室, Tokyo 35.6581N 139.7414E, 2026-02)', () => {
  const tokyo: Place = { lat: 35.6581, lng: 139.7414, elev: 0 };
  const obs = makeObserver(tokyo);
  // NAOJ: upper limb on the horizon with 35′08″ refraction.
  const cases = [
    { day: 1, set: '17:08', az: 249.5 },
    { day: 17, set: '17:24', az: 255.9 },
    { day: 18, set: '17:25', az: 256.3 },
  ];
  for (const c of cases) {
    it(`sunset Feb ${c.day} ≈ ${c.set}, az ${c.az}°`, () => {
      const t = searchAltitude('sun', obs, -1, jstMidnight(2026, 1, c.day), 1, -(35 + 8 / 60 + 16.2) / 60)!;
      const p = bodyPosition('sun', t, tokyo, obs);
      // Our refraction model should put the upper limb within ~3′ of the horizon there too.
      expect(Math.abs(p.alt + p.semidiameter)).toBeLessThan(0.06);
      const [h, m] = c.set.split(':').map(Number);
      const mins = (h - 9 + 24) % 24 * 60 + m; // UTC minutes
      const got = t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
      expect(Math.abs(got - (mins + 0.5))).toBeLessThan(1.1);
      expect(Math.abs(p.az - c.az)).toBeLessThan(0.15);
    });
  }
});

/** Best sun alignment for a spot in a given month. */
function bestIn(place: Place, year: number, month: number) {
  const y = computeYear(place, year, 'sun');
  const s = seasons(y.crossings).filter((s) => s.best.date.slice(5, 7) === String(month).padStart(2, '0'));
  expect(s.length).toBeGreaterThan(0);
  return s[0].best;
}

describe('diamond fuji fixtures (published dates; ±2 days)', () => {
  const day = (iso: string) => Number(iso.slice(8, 10));

  it('Den-en-chōfu: sunset Feb 17–18 (MLIT Kanto, "周辺" with eyeballed coordinates)', () => {
    // At the station itself we get Feb 15; MLIT's point for the neighbourhood is
    // approximate, and 1 km north–south moves the date by about a day here.
    const b = bestIn({ lat: 35.598, lng: 139.6673, elev: 30 }, 2026, 2);
    expect(b.direction).toBe('setting');
    expect(Math.abs(day(b.date) - 17.5)).toBeLessThanOrEqual(3);
    expect(b.kind === 'center' || b.kind === 'disk').toBe(true);
  });

  it('Yokohama Ōsanbashi: sunset Mar 9–10 (MLIT Kanto)', () => {
    const b = bestIn({ lat: 35.4517, lng: 139.6478, elev: 10 }, 2026, 3);
    expect(Math.abs(day(b.date) - 9.5)).toBeLessThanOrEqual(2);
  });

  it('Yamanakako: Nagaike (early Feb) → Asahigaoka (Feb 20+) → Panorama-dai (~Feb 23)', () => {
    const nagaike = bestIn({ lat: 35.427, lng: 138.8714, elev: 985 }, 2026, 2);
    const asahi = bestIn({ lat: 35.4076, lng: 138.876, elev: 985 }, 2026, 2);
    const pano = bestIn({ lat: 35.4126, lng: 138.9095, elev: 1090 }, 2026, 2);
    expect(day(nagaike.date)).toBeLessThanOrEqual(10);
    expect(day(asahi.date)).toBeGreaterThanOrEqual(18);
    expect(day(asahi.date)).toBeLessThanOrEqual(24);
    expect(Math.abs(day(pano.date) - 23)).toBeLessThanOrEqual(2);
    expect(day(nagaike.date)).toBeLessThan(day(asahi.date));
    // Lake Yamanaka sunsets happen mid/late afternoon behind the close, tall mountain.
    expect(fmtJst(pano.bestTime) < '17:00').toBe(true);
  });
});

describe('moon (Pearl Fuji)', () => {
  it('finds every moonset through the summit altitude and the dawn full-moon Pearl Fuji', () => {
    const y = computeYear({ lat: 35.598, lng: 139.6673, elev: 30 }, 2026, 'moon');
    // ~one moonset per 24h50m.
    expect(y.crossings.length).toBeGreaterThan(345);
    expect(y.crossings.length).toBeLessThan(360);
    const hits = y.crossings.filter((c) => c.kind === 'center' || c.kind === 'disk');
    expect(hits.length).toBeGreaterThan(0);
    const pearl = hits.find((c) => (c.illum ?? 0) > 0.95);
    expect(pearl?.date).toBe('2026-04-03');
    expect(pearl!.sunAlt!).toBeLessThan(0);
  });
});

describe('silhouette', () => {
  it('model skyline peaks at the summit', () => {
    const t = summitTarget(TOKYO_STATION);
    const sky = modelSilhouette(TOKYO_STATION, t);
    const top = sky.reduce((a, b) => (b.y > a.y ? b : a));
    expect(Math.abs(top.x)).toBeLessThan(0.05);
    expect(Math.abs(top.y)).toBeLessThan(0.02);
  });

  it('line of sight flags a blocking ridge', () => {
    const t = summitTarget(TOKYO_STATION);
    const mid = { lat: 35.52, lng: 139.25, elev: 5000 };
    expect(lineOfSight(TOKYO_STATION, t, [mid]).clear).toBe(false);
    expect(lineOfSight(TOKYO_STATION, t, [{ ...mid, elev: 100 }]).clear).toBe(true);
  });

  it("doesn't treat Fuji's own near crater rim as an obstruction", () => {
    // Panorama-dai, 17.5 km out: Google terrain has the near rim (3689 m) ~500 m in
    // front of Kengamine, appearing above it. That's the summit, not a blocker.
    const pano: Place = { lat: 35.4126, lng: 138.9095, elev: 1094.6 };
    const t = summitTarget(pano);
    const rim = { lat: 35.36257, lng: 138.73225, elev: 3689 };
    expect(lineOfSight(pano, t, [rim]).clear).toBe(true);
  });
});

it('prints a sample for eyeballing', () => {
  const y = computeYear(TOKYO_STATION, 2026, 'sun');
  for (const s of seasons(y.crossings))
    console.log(
      'Tokyo Stn',
      s.best.date,
      fmtJst(s.best.bestTime),
      (s.best.missDeg * 60).toFixed(1) + "'",
      s.best.kind,
    );
});
