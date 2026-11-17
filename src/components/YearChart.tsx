import type { MouseEvent } from 'react';
import { JST_OFFSET_MS } from '../lib/constants';
import type { Alignment } from '../lib/events';

interface Props {
  crossings: Alignment[];
  year: number;
  selected: Alignment | null;
  onSelect: (a: Alignment) => void;
  minIllum: number;
}

const W = 900;
const H = 150;
const PAD = { l: 34, r: 10, t: 10, b: 22 };
const RANGE = 6; // degrees either side of the summit
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function YearChart({ crossings, year, selected, onSelect, minIllum }: Props) {
  const start = Date.UTC(year, 0, 1) - JST_OFFSET_MS;
  const end = Date.UTC(year + 1, 0, 1) - JST_OFFSET_MS;
  const X = (t: number) => PAD.l + ((t - start) / (end - start)) * (W - PAD.l - PAD.r);
  const Y = (d: number) => PAD.t + ((RANGE - d) / (2 * RANGE)) * (H - PAD.t - PAD.b);
  const isMoon = crossings[0]?.body === 'moon';
  const sd = crossings[0]?.semidiameter ?? 0.27;

  // Sun: break the line where it leaves the plotted range.
  const segments: string[] = [];
  if (!isMoon) {
    let cur: string[] = [];
    for (const c of crossings) {
      if (Math.abs(c.offsetDeg) > RANGE * 1.5) {
        if (cur.length > 1) segments.push(cur.join(' '));
        cur = [];
        continue;
      }
      cur.push(`${X(c.crossTime.getTime()).toFixed(1)},${Y(c.offsetDeg).toFixed(1)}`);
    }
    if (cur.length > 1) segments.push(cur.join(' '));
  }

  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const t = start + ((x - PAD.l) / (W - PAD.l - PAD.r)) * (end - start);
    const pool = isMoon ? crossings.filter((c) => (c.illum ?? 0) >= minIllum) : crossings;
    let best: Alignment | null = null;
    for (const c of pool) {
      if (Math.abs(c.offsetDeg) > RANGE) continue;
      if (!best || Math.abs(c.crossTime.getTime() - t) < Math.abs(best.crossTime.getTime() - t)) best = c;
    }
    if (best && Math.abs(best.crossTime.getTime() - t) < 6 * 86400_000) onSelect(best);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="yearchart" onClick={pick} role="img" aria-label="Offset from the summit at each crossing through the year">
      <defs>
        <clipPath id="plot">
          <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
        </clipPath>
      </defs>
      <rect className="yc-bg" x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
      <rect className="yc-band" x={PAD.l} y={Y(sd)} width={W - PAD.l - PAD.r} height={Y(-sd) - Y(sd)} />
      <line className="yc-zero" x1={PAD.l} x2={W - PAD.r} y1={Y(0)} y2={Y(0)} />
      {[-RANGE, -3, 3, RANGE].map((d) => (
        <text key={d} className="yc-axis" x={PAD.l - 6} y={Y(d) + 4} textAnchor="end">
          {d > 0 ? `+${d}` : d}°
        </text>
      ))}
      <text className="yc-axis" x={PAD.l - 6} y={Y(0) + 4} textAnchor="end">
        Fuji
      </text>
      {MONTHS.map((m, i) => {
        const t = Date.UTC(year, i, 1) - JST_OFFSET_MS;
        return (
          <g key={i}>
            <line className="yc-grid" x1={X(t)} x2={X(t)} y1={PAD.t} y2={H - PAD.b} />
            <text className="yc-axis" x={X(t) + (X(Date.UTC(year, i + 1, 1) - JST_OFFSET_MS) - X(t)) / 2} y={H - 6} textAnchor="middle">
              {m}
            </text>
          </g>
        );
      })}
      <g clipPath="url(#plot)">
        {segments.map((s, i) => (
          <polyline key={i} className="yc-line" points={s} />
        ))}
        {isMoon &&
          crossings.map((c) =>
            Math.abs(c.offsetDeg) <= RANGE * 1.2 ? (
              <circle
                key={c.crossTime.getTime()}
                className="yc-moon"
                cx={X(c.crossTime.getTime())}
                cy={Y(c.offsetDeg)}
                r={2 + 3 * (c.illum ?? 0)}
                opacity={(c.illum ?? 0) >= minIllum ? 0.95 : 0.25}
              />
            ) : null,
          )}
        {selected && (
          <circle className="yc-sel" cx={X(selected.crossTime.getTime())} cy={Y(Math.max(-RANGE, Math.min(RANGE, selected.offsetDeg)))} r={6} />
        )}
      </g>
    </svg>
  );
}
