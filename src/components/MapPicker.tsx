import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre finds its worker relative to its own module, which bundling breaks; hand Vite the file instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { FUJI, type LatLng } from '../lib/constants';
import { direct, inverse } from '../lib/geo';

interface Props {
  observer: LatLng;
  onPick: (p: LatLng) => void;
}

interface MapRefs {
  map: MlMap;
  observer: Marker;
}

/** OpenFreeMap's vector tiles: free, no key, no usage limits. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/**
 * The map is only for picking where you stand; Fuji's terrain comes from GSI's
 * elevation tiles (maps/elevation.ts). So Positron loses the detail that crowds a
 * small map: buildings, road names and shields, airports, piers and transit lines.
 * Minor roads, paths and neighbourhood names wait until you've zoomed in.
 */
const DROP = /^(building|highway-name|highway-shield|road_shield|aeroway|airport|road_area_pier|road_pier|railway_service|railway_transit)/;
const ZOOMED_IN: Record<string, number> = { highway_minor: 14, highway_path: 14, label_other: 13 };

const GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';

async function loadStyle(): Promise<StyleSpecification> {
  const res = await fetch(STYLE_URL);
  if (!res.ok) throw new Error(`map style: HTTP ${res.status}`);
  const style = (await res.json()) as StyleSpecification;
  const layers = style.layers
    .filter((l) => !DROP.test(l.id))
    .map((l) => (l.id in ZOOMED_IN ? { ...l, minzoom: ZOOMED_IN[l.id] } : l));
  // Aerial photos go under the labels, so the "Aerial" view keeps place names.
  const firstLabel = layers.findIndex((l) => l.type === 'symbol');
  layers.splice(firstLabel < 0 ? layers.length : firstLabel, 0, {
    id: 'photo',
    type: 'raster',
    source: 'photo',
    layout: { visibility: 'none' },
  });
  style.sources.photo = {
    type: 'raster',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
    tileSize: 256,
    maxzoom: 18,
    attribution: `Photo: ${GSI}`,
  };
  return { ...style, layers };
}

/** The line of sight as a geodesic, so it stays true over a few hundred km on Mercator. */
function sightLine(a: LatLng, b: LatLng, steps = 64): GeoJSONSourceSpecification['data'] {
  const { distance, azimuth } = inverse(a, b);
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = i === steps ? b : direct(a, azimuth, (distance * i) / steps);
    coordinates.push([p.lng, p.lat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

function fujiBadge(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-fuji';
  el.innerHTML = '<span class="map-fuji-tri"></span><span>富士山 3776 m</span>';
  return el;
}

function observerDot(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-observer';
  el.title = 'You — drag or click the map to move';
  return el;
}

export function MapPicker({ observer, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<MapRefs | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const latest = useRef(observer);
  latest.current = observer;
  const [ready, setReady] = useState(false);
  const [aerial, setAerial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const [ml, style] = await Promise.all([import('maplibre-gl'), loadStyle()]);
        if (cancelled || !box.current) return;
        ml.setWorkerUrl(workerUrl);
        const o = latest.current;
        map = new ml.Map({
          container: box.current,
          style,
          bounds: [
            [Math.min(o.lng, FUJI.lng), Math.min(o.lat, FUJI.lat)],
            [Math.max(o.lng, FUJI.lng), Math.max(o.lat, FUJI.lat)],
          ],
          // Room for the Fuji badge (centred on the summit) and the controls at top and bottom.
          fitBoundsOptions: { padding: { top: 60, bottom: 60, left: 80, right: 80 } },
          // North stays up: the line of sight's bearing should read straight off the map.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: { customAttribution: `Elevation: ${GSI}` },
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');

        new ml.Marker({ element: fujiBadge() }).setLngLat([FUJI.lng, FUJI.lat]).addTo(map);
        const obsMarker = new ml.Marker({ element: observerDot(), draggable: true }).setLngLat([o.lng, o.lat]).addTo(map);
        obsMarker.on('dragend', () => {
          const p = obsMarker.getLngLat();
          pick.current({ lat: p.lat, lng: p.lng });
        });
        map.on('click', (e) => pick.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }));

        const m = map;
        m.on('load', () => {
          m.addSource('sight', { type: 'geojson', data: sightLine(latest.current, FUJI) });
          m.addLayer({
            id: 'sight',
            type: 'line',
            source: 'sight',
            paint: { 'line-color': '#d9622b', 'line-width': 2, 'line-opacity': 0.9 },
          });
          refs.current = { map: m, observer: obsMarker };
          setReady(true);
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      refs.current = null;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.observer.setLngLat([observer.lng, observer.lat]);
    (r.map.getSource('sight') as GeoJSONSource | undefined)?.setData(sightLine(observer, FUJI));
  }, [observer.lat, observer.lng, ready]);

  useEffect(() => {
    refs.current?.map.setLayoutProperty('photo', 'visibility', aerial ? 'visible' : 'none');
  }, [aerial, ready]);

  return (
    <div className="map-wrap">
      <div ref={box} className="map" />
      {ready && (
        <div className="map-mode" role="group" aria-label="Map type">
          <button className={aerial ? '' : 'on'} aria-pressed={!aerial} onClick={() => setAerial(false)}>
            Map
          </button>
          <button className={aerial ? 'on' : ''} aria-pressed={aerial} onClick={() => setAerial(true)}>
            Aerial
          </button>
        </div>
      )}
      {error && (
        <div className="map-error">
          <strong>Map unavailable.</strong> {error}
          <div>You can still type coordinates below.</div>
        </div>
      )}
    </div>
  );
}
