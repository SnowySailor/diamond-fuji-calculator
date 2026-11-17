import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { MapPicker } from './components/MapPicker';
import { Controls, type ElevSource } from './components/Controls';
import { AlignmentView } from './components/AlignmentView';
import { ResultsTable, filterForBody } from './components/ResultsTable';
import { YearChart } from './components/YearChart';
import type { LatLng, Place } from './lib/constants';
import type { BodyName } from './lib/astro';
import { computeYear, seasons, summitTarget, type Alignment } from './lib/events';
import { lineOfSight, modelSilhouette, projectPlaces, skyline } from './lib/silhouette';
import { elevationUnavailableReason, groundElevation, terrainSamples, type TerrainSamples } from './maps/elevation';

interface UrlState {
  observer: LatLng;
  ground: number | null;
  agl: number;
  year: number;
  body: BodyName;
}

const DEFAULT_OBSERVER: LatLng = { lat: 35.6812, lng: 139.7671 }; // Tokyo Station

function readUrl(): UrlState {
  const q = new URLSearchParams(location.search);
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const lat = num('lat');
  const lng = num('lng');
  return {
    observer: lat !== null && lng !== null ? { lat, lng } : DEFAULT_OBSERVER,
    ground: num('g'),
    agl: num('h') ?? 1.6,
    year: num('y') ?? new Date().getFullYear(),
    body: q.get('b') === 'moon' ? 'moon' : 'sun',
  };
}

function writeUrl(s: UrlState) {
  const q = new URLSearchParams({
    lat: s.observer.lat.toFixed(5),
    lng: s.observer.lng.toFixed(5),
    g: String(Math.round(s.ground ?? 0)),
    h: String(s.agl),
    y: String(s.year),
    b: s.body,
  });
  history.replaceState(null, '', `?${q}`);
}

/** The next upcoming best day, or the first of the year if they've all passed. */
function defaultSelection(pool: Alignment[], body: BodyName): Alignment | null {
  const groups = seasons(pool, 1, body === 'sun' ? 3 : 0.5);
  if (!groups.length) return null;
  const now = Date.now();
  return (groups.find((g) => g.best.bestTime.getTime() > now) ?? groups[0]).best;
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [observer, setObserver] = useState<LatLng>(initial.observer);
  const [ground, setGround] = useState<number>(initial.ground ?? 3);
  const [groundSource, setGroundSource] = useState<ElevSource>(initial.ground !== null ? 'manual' : 'loading');
  const [agl, setAgl] = useState(initial.agl);
  const [year, setYear] = useState(initial.year);
  const [body, setBody] = useState<BodyName>(initial.body);
  const [minIllum, setMinIllum] = useState(0.9);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [terrain, setTerrain] = useState<TerrainSamples | null>(null);
  const [terrainStatus, setTerrainStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [elevationNote, setElevationNote] = useState<string | null>(null);

  const place: Place = useMemo(
    () => ({ lat: observer.lat, lng: observer.lng, elev: ground + agl }),
    [observer.lat, observer.lng, ground, agl],
  );
  const deferredPlace = useDeferredValue(place);

  useEffect(() => writeUrl({ observer, ground, agl, year, body }), [observer, ground, agl, year, body]);

  // Ground elevation + terrain whenever the observer moves (after the map/API is loaded).
  const [skipFirstGround] = useState(initial.ground !== null);
  const [firstRun, setFirstRun] = useState(true);
  useEffect(() => {
    if (!mapsReady) return;
    let cancelled = false;
    const useLookup = !(firstRun && skipFirstGround);
    setFirstRun(false);
    if (useLookup) setGroundSource('loading');
    setTerrainStatus('loading');
    const timer = setTimeout(async () => {
      if (useLookup) {
        const g = await groundElevation(observer);
        if (cancelled) return;
        if (g !== null) {
          setGround(Math.round(g));
          setGroundSource('google');
        } else {
          setGroundSource('manual');
          setElevationNote(elevationUnavailableReason() ? 'Elevation API unavailable: enter it yourself' : 'Lookup failed: enter it yourself');
        }
      }
      const samples = await terrainSamples(observer, summitTarget({ ...observer, elev: 0 }));
      if (cancelled) return;
      setTerrain(samples);
      setTerrainStatus(samples ? 'ok' : 'unavailable');
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observer.lat, observer.lng, mapsReady]);

  // If Maps never loads, stop showing "loading" states.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!mapsReady) {
        setGroundSource((s) => (s === 'loading' ? 'manual' : s));
        setTerrainStatus((s) => (s === 'loading' ? 'unavailable' : s));
      }
    }, 8000);
    return () => clearTimeout(t);
  }, [mapsReady]);

  const target = useMemo(() => summitTarget(deferredPlace), [deferredPlace]);
  const result = useMemo(() => computeYear(deferredPlace, year, body), [deferredPlace, year, body]);
  const pool = useMemo(() => filterForBody(result, minIllum), [result, minIllum]);

  const selected = useMemo(() => {
    if (selectedKey !== null) {
      // Keep the same day selected across small changes (e.g. elevation edits).
      const day = 86400_000 / 2;
      const hit = result.crossings.find((c) => Math.abs(c.crossTime.getTime() - selectedKey) < day);
      if (hit) return hit;
    }
    return defaultSelection(pool, body);
  }, [selectedKey, result, pool, body]);

  const onSelect = useCallback((a: Alignment) => setSelectedKey(a.crossTime.getTime()), []);

  const modelSky = useMemo(() => modelSilhouette(deferredPlace, target), [deferredPlace, target]);
  const terrainSky = useMemo(
    () => (terrain ? skyline(terrain.ridge.map((line) => projectPlaces(deferredPlace, target, line))) : null),
    [terrain, deferredPlace, target],
  );
  const los = useMemo(
    () => (terrain ? lineOfSight(deferredPlace, target, terrain.sightline) : null),
    [terrain, deferredPlace, target],
  );

  const moveObserver = useCallback((p: LatLng) => {
    setObserver({ lat: p.lat, lng: p.lng });
    setSelectedKey(null);
  }, []);

  return (
    <div className="app">
      <header className="top">
        <h1>
          Diamond Fuji <span className="jp">ダイヤモンド富士</span>
        </h1>
        <p className="muted">Click the map where you'll stand. All times are JST.</p>
      </header>

      <main className="layout">
        <aside className="left">
          <MapPicker observer={observer} onPick={moveObserver} onReady={() => setMapsReady(true)} />
          <Controls
            observer={observer}
            onObserver={moveObserver}
            ground={ground}
            onGround={(m) => {
              setGround(m);
              setGroundSource('manual');
              setElevationNote(null);
            }}
            groundSource={groundSource}
            agl={agl}
            onAgl={setAgl}
            year={year}
            onYear={(y) => {
              setYear(y);
              setSelectedKey(null);
            }}
            body={body}
            onBody={(b) => {
              setBody(b);
              setSelectedKey(null);
            }}
            minIllum={minIllum}
            onMinIllum={(v) => {
              setMinIllum(v);
              setSelectedKey(null);
            }}
            target={target}
            los={los}
            terrainStatus={terrainStatus}
            elevationNote={elevationNote}
          />
        </aside>

        <section className="right">
          {selected ? (
            <AlignmentView
              place={deferredPlace}
              target={target}
              event={selected}
              silhouette={terrainSky && terrainSky.length > 50 ? terrainSky : modelSky}
              ridgeSource={terrainSky && terrainSky.length > 50 ? 'terrain' : 'model'}
            />
          ) : (
            <div className="view placeholder">
              <p>No pass to show yet.</p>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h3>
                {body === 'sun' ? 'Diamond Fuji' : 'Pearl Fuji'} dates, {year}
              </h3>
            </div>
            <ResultsTable result={result} year={year} minIllum={minIllum} selected={selected} onSelect={onSelect} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Through the year</h3>
              <p className="muted small">
                How far left or right of the summit the {body} {result.direction === 'setting' ? 'sets' : 'rises'} past it, day by
                day. Where it crosses the line, the {body} goes behind the summit. Click to jump to a date.
              </p>
            </div>
            <YearChart crossings={result.crossings} year={year} selected={selected} onSelect={onSelect} minIllum={minIllum} />
          </div>

          <p className="muted small foot">
            Fuji’s position: Kengamine summit, 35.36083° N 138.72750° E, 3776.24 m (GSI). Sun and moon positions come from
            astronomy-engine, with refraction scaled for your elevation. The line of sight to the summit uses k = 0.13
            terrestrial refraction. Buildings, trees and the weather aren’t modelled. Real refraction near the horizon varies
            from day to day, so expect up to a minute either way.
          </p>
        </section>
      </main>
    </div>
  );
}
