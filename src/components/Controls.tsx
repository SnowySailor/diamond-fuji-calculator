import { useEffect, useState, type ReactNode } from 'react';
import type { LatLng } from '../lib/constants';
import type { Target } from '../lib/events';
import type { LineOfSight } from '../lib/silhouette';
import type { BodyName } from '../lib/astro';

export type ElevSource = 'google' | 'manual' | 'loading';

interface Props {
  observer: LatLng;
  onObserver: (p: LatLng) => void;
  ground: number;
  onGround: (m: number) => void;
  groundSource: ElevSource;
  agl: number;
  onAgl: (m: number) => void;
  year: number;
  onYear: (y: number) => void;
  body: BodyName;
  onBody: (b: BodyName) => void;
  minIllum: number;
  onMinIllum: (v: number) => void;
  target: Target;
  los: LineOfSight | null;
  terrainStatus: 'loading' | 'ok' | 'unavailable';
  elevationNote: string | null;
}

/** Number input that only commits valid values (on blur / Enter). */
function NumberField(props: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  digits?: number;
  suffix?: string;
  min?: number;
  max?: number;
  hint?: ReactNode;
}) {
  const { value, digits = 0 } = props;
  const [text, setText] = useState(value.toFixed(digits));
  useEffect(() => setText(value.toFixed(digits)), [value, digits]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && (props.min === undefined || v >= props.min) && (props.max === undefined || v <= props.max)) {
      props.onCommit(v);
    } else setText(value.toFixed(digits));
  };
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <span className="field-input">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {props.suffix && <span className="suffix">{props.suffix}</span>}
      </span>
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Controls(p: Props) {
  const losText = (() => {
    if (p.terrainStatus === 'loading') return <span className="muted">Checking terrain…</span>;
    if (!p.los) return <span className="muted">Not checked (needs the Elevation API)</span>;
    if (p.los.clear)
      return (
        <span className="ok">
          Clear: summit {p.los.marginDeg === Infinity ? '' : `${(p.los.marginDeg * 60).toFixed(0)}′ `}above the terrain in between
        </span>
      );
    const w = p.los.worst!;
    return (
      <span className="warn">
        Blocked by terrain {w.distanceKm.toFixed(1)} km away ({Math.round(w.elev)} m), {(-p.los.marginDeg * 60).toFixed(0)}′
        above the summit
      </span>
    );
  })();

  return (
    <div className="controls">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={p.body === 'sun'} className={p.body === 'sun' ? 'on' : ''} onClick={() => p.onBody('sun')}>
          Diamond Fuji <span className="muted">sun</span>
        </button>
        <button role="tab" aria-selected={p.body === 'moon'} className={p.body === 'moon' ? 'on' : ''} onClick={() => p.onBody('moon')}>
          Pearl Fuji <span className="muted">moon</span>
        </button>
      </div>

      <div className="grid2">
        <NumberField label="Latitude" value={p.observer.lat} digits={5} min={-90} max={90} onCommit={(lat) => p.onObserver({ ...p.observer, lat })} />
        <NumberField label="Longitude" value={p.observer.lng} digits={5} min={-180} max={180} onCommit={(lng) => p.onObserver({ ...p.observer, lng })} />
        <NumberField
          label="Ground elevation"
          value={p.ground}
          digits={0}
          suffix="m"
          onCommit={p.onGround}
          hint={
            p.groundSource === 'loading' ? 'Looking up…' : p.groundSource === 'google' ? 'From Google terrain' : p.elevationNote ?? 'Entered by you'
          }
        />
        <NumberField label="Eye height above ground" value={p.agl} digits={1} min={0} suffix="m" onCommit={p.onAgl} hint="Add floors or a tripod here" />
        <label className="field">
          <span className="field-label">Year</span>
          <span className="field-input year">
            <button onClick={() => p.onYear(p.year - 1)} aria-label="Previous year">‹</button>
            <span className="num">{p.year}</span>
            <button onClick={() => p.onYear(p.year + 1)} aria-label="Next year">›</button>
          </span>
        </label>
        {p.body === 'moon' && (
          <label className="field">
            <span className="field-label">Moon phase</span>
            <select value={p.minIllum} onChange={(e) => p.onMinIllum(Number(e.target.value))}>
              <option value={0.9}>Near full (≥ 90% lit)</option>
              <option value={0.5}>Gibbous or fuller (≥ 50%)</option>
              <option value={0}>Any phase</option>
            </select>
          </label>
        )}
      </div>

      <dl className="facts">
        <div>
          <dt>Distance to summit</dt>
          <dd>{(p.target.distance / 1000).toFixed(1)} km</dd>
        </div>
        <div>
          <dt>Bearing</dt>
          <dd>{p.target.az.toFixed(2)}°</dd>
        </div>
        <div>
          <dt>Summit appears at</dt>
          <dd>
            {p.target.alt.toFixed(3)}° altitude
          </dd>
        </div>
        <div className="wide">
          <dt>Line of sight</dt>
          <dd>{losText}</dd>
        </div>
      </dl>
      {p.target.distance > 330_000 && (
        <p className="warn small">Beyond about 330 km the summit is below the horizon from almost anywhere.</p>
      )}
    </div>
  );
}
