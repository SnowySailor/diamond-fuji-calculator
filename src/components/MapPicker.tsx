import { useEffect, useRef, useState } from 'react';
import { FUJI, type LatLng } from '../lib/constants';
import { loadGoogleMaps, onMapsAuthFailure } from '../maps/loadGoogleMaps';

interface Props {
  observer: LatLng;
  onPick: (p: LatLng) => void;
  onReady?: () => void;
}

interface MapRefs {
  map: google.maps.Map;
  observer: google.maps.marker.AdvancedMarkerElement;
  line: google.maps.Polyline;
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
  return el;
}

export function MapPicker({ observer, onPick, onReady }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<MapRefs | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const latest = useRef(observer);
  latest.current = observer;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = onMapsAuthFailure(() =>
      setError('Google Maps rejected the API key. Check that http://127.0.0.1:4778/* is an allowed referrer.'),
    );
    let cancelled = false;
    (async () => {
      try {
        await loadGoogleMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
        const [{ Map, Polyline }, { AdvancedMarkerElement }] = await Promise.all([
          google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
          google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
        ]);
        if (cancelled || !box.current) return;
        const observer = latest.current;
        const map = new Map(box.current, {
          mapId: 'DEMO_MAP_ID', // advanced markers need a map id; the demo one needs no setup
          mapTypeId: 'terrain',
          center: { lat: (observer.lat + FUJI.lat) / 2, lng: (observer.lng + FUJI.lng) / 2 },
          zoom: 9,
          gestureHandling: 'greedy',
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: ['terrain', 'roadmap', 'hybrid'] },
        });
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(observer);
        bounds.extend(FUJI);
        map.fitBounds(bounds, 60);

        new AdvancedMarkerElement({ map, position: FUJI, content: fujiBadge(), title: 'Mt. Fuji (Kengamine)' });
        const obsMarker = new AdvancedMarkerElement({
          map,
          position: observer,
          content: observerDot(),
          gmpDraggable: true,
          title: 'You — drag or click the map to move',
        });
        obsMarker.addListener('dragend', () => {
          const p = obsMarker.position as google.maps.LatLngLiteral | google.maps.LatLng | null;
          if (!p) return;
          const ll = p instanceof google.maps.LatLng ? p.toJSON() : p;
          pick.current({ lat: ll.lat, lng: ll.lng });
        });
        const line = new Polyline({
          map,
          path: [observer, FUJI],
          geodesic: true,
          strokeColor: '#d9622b',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          clickable: false,
        });
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) pick.current(e.latLng.toJSON());
        });
        refs.current = { map, observer: obsMarker, line };
        onReady?.();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      off();
    };
    // The map is created once; position updates happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.observer.position = observer;
    r.line.setPath([observer, FUJI]);
  }, [observer.lat, observer.lng]);

  return (
    <div className="map-wrap">
      <div ref={box} className="map" />
      {error && (
        <div className="map-error">
          <strong>Map unavailable.</strong> {error}
          <div>You can still type coordinates below.</div>
        </div>
      )}
    </div>
  );
}
