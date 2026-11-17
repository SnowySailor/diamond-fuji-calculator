import { useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from '../lib/constants';
import { bodyPosition, moonPhase, type BodyName } from '../lib/astro';
import { skyOffset, type Alignment, type Target } from '../lib/events';
import { angularSeparation } from '../lib/geo';
import type { SkyPoint } from '../lib/silhouette';
import { fmtArcmin, fmtDateLong, fmtTime } from '../format';

interface Props {
  place: Place;
  target: Target;
  event: Alignment;
  silhouette: SkyPoint[];
  ridgeSource: 'terrain' | 'model';
}

const W = 900;
const H = 540;
const SUMMIT_Y = H * 0.56;
const ZOOMS = [0.35, 0.7, 1.2, 2.5, 5, 12];
const SCRUB = 600; // seconds either side of the best moment

function skyColors(sunAlt: number): [string, string, string] {
  if (sunAlt > 8) return ['#5d93d1', '#9cc3ea', '#dcebf7'];
  if (sunAlt > 1) return ['#5b7fb8', '#e7b682', '#f6d6a2'];
  if (sunAlt > -2) return ['#3b5288', '#d98a5c', '#f2b073'];
  if (sunAlt > -7) return ['#1d2850', '#6c5a83', '#d4805a'];
  if (sunAlt > -13) return ['#0e1633', '#26305a', '#4b4772'];
  return ['#060a1a', '#0c1430', '#18224a'];
}

/** Interpolated skyline height (deg) at sky x, or null outside the sampled range. */
function ridgeAt(sky: SkyPoint[], x: number): number | null {
  if (!sky.length || x < sky[0].x || x > sky[sky.length - 1].x) return null;
  let lo = 0;
  let hi = sky.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sky[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = sky[lo];
  const b = sky[hi];
  return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Bright-limb direction of the moon on screen (radians, SVG coords: x right, y down). */
function brightLimbAngle(moon: { az: number; alt: number }, sun: { az: number; alt: number }): number {
  const D = Math.PI / 180;
  const a1 = moon.alt * D;
  const a2 = sun.alt * D;
  const dAz = (sun.az - moon.az) * D;
  const theta = Math.atan2(
    Math.sin(dAz) * Math.cos(a2),
    Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2) * Math.cos(dAz),
  );
  // theta: 0 = up (toward zenith), +90° = right (increasing azimuth).
  return Math.atan2(-Math.cos(theta), Math.sin(theta));
}

export function AlignmentView({ place, target, event, silhouette, ridgeSource }: Props) {
  const [zoomIdx, setZoomIdx] = useState(2);
  const [offsetSec, setOffsetSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const body: BodyName = event.body;
  const halfW = ZOOMS[zoomIdx];
  const scale = W / 2 / halfW; // px per degree
  const X = (x: number) => W / 2 + x * scale;
  const Y = (y: number) => SUMMIT_Y - y * scale;

  useEffect(() => {
    setOffsetSec(0);
    setPlaying(false);
  }, [event.bestTime.getTime(), body]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setOffsetSec((s) => {
        const n = s + dt * 20; // 20× real time
        if (n >= SCRUB) {
          setPlaying(false);
          return SCRUB;
        }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  const t = new Date(event.bestTime.getTime() + offsetSec * 1000);
  const pos = bodyPosition(body, t, place);
  const sun = body === 'sun' ? pos : bodyPosition('sun', t, place);
  const off = skyOffset(pos, target);
  const sep = angularSeparation(pos.az, pos.alt, target.az, target.alt);
  const r = pos.semidiameter * scale;

  const track = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    const t0 = event.bestTime.getTime();
    for (let s = -SCRUB - 120; s <= SCRUB + 120; s += 15) {
      pts.push(skyOffset(bodyPosition(body, new Date(t0 + s * 1000), place), target));
    }
    return pts;
  }, [event.bestTime.getTime(), body, place.lat, place.lng, place.elev, target]);

  // Minute ticks: snap to whole minutes.
  const ticks = useMemo(() => {
    const out: { x: number; y: number; t: Date }[] = [];
    const t0 = event.bestTime.getTime();
    const first = Math.ceil((t0 - (SCRUB + 120) * 1000) / 60000) * 60000;
    for (let tm = first; tm <= t0 + (SCRUB + 120) * 1000; tm += 60000) {
      const tt = new Date(tm);
      out.push({ ...skyOffset(bodyPosition(body, tt, place), target), t: tt });
    }
    return out;
  }, [event.bestTime.getTime(), body, place.lat, place.lng, place.elev, target]);

  const ridgePath = useMemo(() => {
    const margin = halfW * 1.3;
    const pts = silhouette.filter((p) => Math.abs(p.x) <= margin);
    if (pts.length < 2) return '';
    const bottom = H + 10;
    let d = `M ${X(pts[0].x).toFixed(1)} ${bottom} `;
    for (const p of pts) d += `L ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)} `;
    d += `L ${X(pts[pts.length - 1].x).toFixed(1)} ${bottom} Z`;
    return d;
  }, [silhouette, halfW]);

  // How much of the disk clears the ridge, for the "diamond" flare.
  const ridgeY = ridgeAt(silhouette, off.x);
  const visible = ridgeY === null ? 1 : Math.max(0, Math.min(1, (off.y + pos.semidiameter - ridgeY) / (2 * pos.semidiameter)));
  const onSummit = sep < pos.semidiameter * 1.05;
  // The "diamond": strongest when only a sliver of the disk clears the ridge.
  const flareStrength =
    body === 'sun' && onSummit && ridgeY !== null && visible > 0.01 && visible < 0.75
      ? Math.min(1, visible / 0.08) * Math.min(1, (0.75 - visible) / 0.45)
      : 0;

  // From close range the crater's near rim can stand above Kengamine itself.
  const ridgeAtSummit = ridgeAt(silhouette, 0);
  const summitHidden = ridgeAtSummit !== null && ridgeAtSummit > 0.01;

  const [skyTop, skyMid, skyLow] = skyColors(sun.alt);
  const horizonY = Y(-target.alt);
  const phase = body === 'moon' ? moonPhase(t) : null;
  const limb = body === 'moon' ? brightLimbAngle(pos, sun) : 0;

  // Scale bar: pick a round angle ~1/6 of the view.
  const barDeg = [0.05, 0.1, 0.25, 0.5, 1, 2, 5].find((d) => d * scale > W / 8) ?? 5;

  const labelEvery = halfW <= 0.7 ? 1 : halfW <= 1.2 ? 2 : halfW <= 2.5 ? 5 : 10;

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h2>
            {body === 'sun' ? 'Diamond Fuji' : 'Pearl Fuji'} · {fmtDateLong(event.bestTime)}
          </h2>
          <p className="muted">
            Best at <strong>{fmtTime(event.bestTime, true)}</strong> JST, centre passes{' '}
            {fmtArcmin(event.missDeg)} from the summit ({event.direction === 'setting' ? 'sets' : 'rises'}{' '}
            {event.offsetDeg > 0 ? 'right' : 'left'} of it by {fmtArcmin(Math.abs(event.offsetDeg))} at summit height)
          </p>
        </div>
        <div className="zoom" role="group" aria-label="Zoom">
          <button onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} aria-label="Zoom out">
            −
          </button>
          <span>{(halfW * 2).toFixed(halfW < 1 ? 1 : 0)}° wide</span>
          <button onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="scene" role="img" aria-label="Position of the body relative to Fuji's summit">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={skyTop} />
            <stop offset="0.6" stopColor={skyMid} />
            <stop offset="1" stopColor={skyLow} />
          </linearGradient>
          <radialGradient id="sunDisk">
            <stop offset="0" stopColor="#fffffb" />
            <stop offset="0.8" stopColor="#fff7dc" />
            <stop offset="1" stopColor="#ffe09a" />
          </radialGradient>
          <radialGradient id="glow">
            <stop offset="0" stopColor="#fff6d8" stopOpacity="0.9" />
            <stop offset="0.35" stopColor="#ffd27f" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ffb35c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b3550" />
            <stop offset="1" stopColor="#151b2c" />
          </linearGradient>
        </defs>

        <rect width={W} height={H} fill="url(#sky)" />

        {horizonY < H && horizonY > 0 && (
          <g className="horizon">
            <line x1={0} x2={W} y1={horizonY} y2={horizonY} />
            <text x={8} y={horizonY - 6}>astronomical horizon 0°</text>
          </g>
        )}

        {/* Body, drawn behind the mountain. */}
        {body === 'sun' ? (
          <g>
            <circle cx={X(off.x)} cy={Y(off.y)} r={r * 3.2} fill="url(#glow)" />
            <circle cx={X(off.x)} cy={Y(off.y)} r={r} fill="url(#sunDisk)" />
          </g>
        ) : (
          <g transform={`translate(${X(off.x)} ${Y(off.y)}) rotate(${(limb * 180) / Math.PI})`}>
            <circle r={r * 2.2} fill="url(#glow)" opacity={0.25 * (phase?.illum ?? 0)} />
            <circle r={r} fill="#2a2f40" opacity={0.85} />
            <path d={moonLitPath(r, phase?.illum ?? 0)} fill="#f3efe1" />
          </g>
        )}

        {ridgePath && <path d={ridgePath} fill="url(#mtn)" stroke="#5a6684" strokeWidth={1} strokeLinejoin="round" />}

        {flareStrength > 0 && ridgeY !== null && (
          <Flare x={X(off.x)} y={Y(ridgeY)} size={Math.max(6, r * 0.45)} opacity={flareStrength} />
        )}

        {/* Track with minute ticks. */}
        <polyline
          className="track"
          points={track.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}
        />
        {ticks.map((k) => {
          const mm = Math.round(k.t.getTime() / 60000);
          const showLabel = mm % labelEvery === 0;
          const x = X(k.x);
          const y = Y(k.y);
          if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return null;
          return (
            <g key={k.t.getTime()} className="tick">
              <circle cx={x} cy={y} r={2.4} />
              {showLabel && (
                <text x={x + 7} y={y - 6}>
                  {fmtTime(k.t)}
                </text>
              )}
            </g>
          );
        })}

        {/* Summit marker. */}
        <g className="summit" transform={`translate(${X(0)} ${Y(0)})`}>
          <line x1={-9} x2={-3} y1={0} y2={0} />
          <line x1={3} x2={9} y1={0} y2={0} />
          <line x1={0} x2={0} y1={-9} y2={-3} />
          <line x1={0} x2={0} y1={3} y2={9} />
          <text x={12} y={18}>剣ヶ峰 3776 m{summitHidden ? ' (behind the near rim)' : ''}</text>
        </g>

        {/* Scale bar. */}
        <g className="scalebar" transform={`translate(${20} ${H - 22})`}>
          <line x1={0} x2={barDeg * scale} y1={0} y2={0} />
          <line x1={0} x2={0} y1={-4} y2={4} />
          <line x1={barDeg * scale} x2={barDeg * scale} y1={-4} y2={4} />
          <text x={(barDeg * scale) / 2} y={-8} textAnchor="middle">
            {barDeg}°
          </text>
        </g>

        <text className="scene-note" x={W - 12} y={H - 14} textAnchor="end">
          {ridgeSource === 'terrain' ? 'ridge from Google terrain data' : 'modelled ridge (no terrain data)'}
        </text>
      </svg>

      <div className="scrub">
        <button className="play" onClick={() => {
          if (!playing && offsetSec >= SCRUB) setOffsetSec(-SCRUB);
          setPlaying((p) => !p);
        }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={-SCRUB}
          max={SCRUB}
          step={1}
          value={offsetSec}
          onChange={(e) => {
            setPlaying(false);
            setOffsetSec(Number(e.target.value));
          }}
          aria-label="Time offset from best moment"
        />
        <button className="ghost" onClick={() => { setPlaying(false); setOffsetSec(0); }}>
          Best moment
        </button>
      </div>

      <dl className="readout">
        <div>
          <dt>Time (JST)</dt>
          <dd>
            {fmtTime(t, true)} <span className="muted">({offsetSec >= 0 ? '+' : '−'}{fmtDuration(Math.abs(offsetSec))})</span>
          </dd>
        </div>
        <div>
          <dt>{body === 'sun' ? 'Sun' : 'Moon'} az / alt</dt>
          <dd>
            {pos.az.toFixed(3)}° / {pos.alt.toFixed(3)}°
          </dd>
        </div>
        <div>
          <dt>From summit</dt>
          <dd>
            {fmtSigned(off.x)} horiz, {fmtSigned(off.y)} vert
          </dd>
        </div>
        <div>
          <dt>Centre ↔ summit</dt>
          <dd>
            {fmtArcmin(sep)} <span className="muted">(disk radius {fmtArcmin(pos.semidiameter)})</span>
          </dd>
        </div>
        {phase && (
          <div>
            <dt>Moon</dt>
            <dd>
              {(phase.illum * 100).toFixed(0)}% lit, {phase.waxing ? 'waxing' : 'waning'}
            </dd>
          </div>
        )}
        {body === 'moon' && (
          <div>
            <dt>Sun altitude</dt>
            <dd>{sun.alt.toFixed(2)}°</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function fmtSigned(deg: number): string {
  const m = deg * 60;
  return `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1)}′`;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.round(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** Lit part of the moon with the bright limb toward +x. */
function moonLitPath(r: number, illum: number): string {
  if (illum <= 0.005) return '';
  if (illum >= 0.995) return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
  const rx = Math.abs(r * (2 * illum - 1));
  const sweep = illum > 0.5 ? 1 : 0;
  return `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${rx} ${r} 0 0 ${sweep} 0 ${-r} Z`;
}

function Flare({ x, y, size, opacity }: { x: number; y: number; size: number; opacity: number }) {
  const long = size * 2.4;
  const short = size * 1.2;
  return (
    <g className="flare" transform={`translate(${x} ${y})`} opacity={opacity}>
      <circle r={size * 1.6} fill="url(#glow)" />
      <path
        d={`M 0 ${-long} L ${size * 0.12} 0 L 0 ${long} L ${-size * 0.12} 0 Z M ${-long} 0 L 0 ${size * 0.12} L ${long} 0 L 0 ${-size * 0.12} Z`}
        fill="#fffbe9"
        opacity={0.95}
      />
      <path
        d={`M ${-short} ${-short} L ${size * 0.08} ${-size * 0.08} L ${short} ${short} L ${-size * 0.08} ${size * 0.08} Z M ${short} ${-short} L ${size * 0.08} ${size * 0.08} L ${-short} ${short} L ${-size * 0.08} ${-size * 0.08} Z`}
        fill="#fff3c8"
        opacity={0.6}
      />
      <circle r={size * 0.3} fill="#ffffff" />
    </g>
  );
}
