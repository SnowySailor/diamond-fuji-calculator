import type { Alignment, AlignmentKind, YearResult } from '../lib/events';
import { NEAR_TOLERANCE_DEG, seasons } from '../lib/events';
import { fmtArcmin, fmtDateShort, fmtTime } from '../format';

interface Props {
  result: YearResult;
  year: number;
  minIllum: number;
  selected: Alignment | null;
  onSelect: (a: Alignment) => void;
}

const BADGE: Record<AlignmentKind, string> = {
  center: 'Dead centre',
  disk: 'On summit',
  near: 'Near miss',
  far: 'Miss',
};

function skyLabel(sunAlt: number | undefined): string {
  if (sunAlt === undefined) return '';
  if (sunAlt > 0) return 'daylight';
  if (sunAlt > -6) return 'twilight';
  if (sunAlt > -18) return 'dusk/dawn';
  return 'night';
}

export function filterForBody(result: YearResult, minIllum: number): Alignment[] {
  return result.body === 'moon'
    ? result.crossings.filter((c) => (c.illum ?? 0) >= minIllum)
    : result.crossings;
}

export function ResultsTable({ result, year, minIllum, selected, onSelect }: Props) {
  const body = result.body;
  const pool = filterForBody(result, minIllum);
  const groups = seasons(pool, NEAR_TOLERANCE_DEG, body === 'sun' ? 3 : 0.5);
  const now = Date.now();

  if (!groups.length) {
    const closest = pool.reduce<Alignment | null>((a, b) => (!a || b.missDeg < a.missDeg ? b : a), null);
    const offs = result.crossings.map((c) => c.offsetDeg);
    return (
      <div className="empty">
        <p>
          <strong>No {body === 'sun' ? 'Diamond' : 'Pearl'} Fuji from here in {year}.</strong>{' '}
          {offs.length ? (
            <>
              The {body} crosses the summit’s altitude {sideRange(offs)}
              {body === 'moon' && minIllum > 0 ? ` (on nights at least ${Math.round(minIllum * 100)}% lit)` : ''}, never within
              1° of it.
            </>
          ) : (
            <>The {body} never reaches the summit’s altitude on that side of the sky.</>
          )}
        </p>
        {closest && (
          <button className="ghost" onClick={() => onSelect(closest)}>
            Show the closest pass: {fmtDateShort(closest.bestTime)}, {fmtArcmin(closest.missDeg)} away
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="results">
      {groups.map((g) => (
        <table key={g.events[0].crossTime.getTime()} className="season">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time JST</th>
              <th title="Closest distance between the disk's centre and the summit">Miss</th>
              <th />
              {body === 'moon' && <th>Moon</th>}
            </tr>
          </thead>
          <tbody>
            {g.events.map((e) => {
              const isSel = selected?.crossTime.getTime() === e.crossTime.getTime();
              const past = e.bestTime.getTime() < now;
              return (
                <tr
                  key={e.crossTime.getTime()}
                  className={[isSel ? 'sel' : '', past ? 'past' : '', e === g.best ? 'best' : ''].join(' ')}
                  onClick={() => onSelect(e)}
                  tabIndex={0}
                  onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && onSelect(e)}
                >
                  <td>
                    {fmtDateShort(e.bestTime)}
                    {e === g.best && <span className="star" title="Best day of this run">best</span>}
                  </td>
                  <td className="num">{fmtTime(e.bestTime, true)}</td>
                  <td className="num">{fmtArcmin(e.missDeg)}</td>
                  <td>
                    <span className={`badge ${e.kind}`}>{BADGE[e.kind]}</span>
                  </td>
                  {body === 'moon' && (
                    <td className="muted">
                      {Math.round((e.illum ?? 0) * 100)}% · {skyLabel(e.sunAlt)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      <p className="muted small">
        {result.direction === 'setting' ? 'Setting' : 'Rising'} {body}. “On summit” means the summit point is inside the
        disk; “dead centre” within 3′. Times are when the centre passes closest to the summit.
      </p>
    </div>
  );
}

/** "between 32.6° and 91.4° to the left of it", or a signed range if it straddles. */
function sideRange(offs: number[]): string {
  const lo = Math.min(...offs);
  const hi = Math.max(...offs);
  if (hi < 0) return `between ${(-hi).toFixed(1)}° and ${(-lo).toFixed(1)}° to the left of it`;
  if (lo > 0) return `between ${lo.toFixed(1)}° and ${hi.toFixed(1)}° to the right of it`;
  return `between ${(-lo).toFixed(1)}° left and ${hi.toFixed(1)}° right of it`;
}
