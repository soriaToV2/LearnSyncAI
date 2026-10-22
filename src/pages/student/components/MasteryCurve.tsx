import { masteryPercent } from '../../../lib/mastery';
import type { CurvePoint } from '../../../lib/dashboard';

/**
 * EQ(4) mastery over the student's history, as hand-rolled SVG.
 * X is a learning-opportunity index, not time (sessions share timestamps; BKT has no forgetting).
 * Y is fixed 0–100: auto-scaling would exaggerate small gains.
 */

interface MasteryCurveProps {
  points: CurvePoint[];
  /** Tailwind text colour class; the stroke inherits it via `currentColor`. */
  toneClass: string;
  /** Tier boundaries, drawn faintly so the line has something to be read against. */
  thresholds?: number[];
}

const W = 100;
const H = 40;

export default function MasteryCurve({
  points,
  toneClass,
  thresholds = [50, 85],
}: MasteryCurveProps) {
  if (points.length < 2) return null;

  const y = (mDoc: number) => H - Math.min(Math.max(mDoc, 0), 1) * H;
  const x = (i: number) => (i / (points.length - 1)) * W;

  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.m_doc).toFixed(2)}`).join(' ');
  // Closed along the baseline so the area under the line can be tinted.
  const area = `0,${H} ${line} ${W},${H}`;

  const first = masteryPercent(points[0].m_doc);
  const last = masteryPercent(points[points.length - 1].m_doc);

  return (
    // Threshold labels are HTML in a gutter, not SVG text: preserveAspectRatio="none" would stretch them,
    // and they'd collide with the end points. Positioned from the threshold value.
    <div className="relative">
      <div className="pr-8">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={`w-full h-24 sm:h-28 ${toneClass}`}
          role="img"
          aria-label={`Mastery went from ${first}% to ${last}% over ${points.length - 1} learning opportunities.`}
        >
          <defs>
            {/* currentColor in a stop inherits the svg's toneClass, so the fill tracks the tier. */}
            <linearGradient id="masteryCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Axis lines in white, not currentColor, so they don't read as data. */}
          {thresholds.map((t) => (
            <line
              key={t}
              x1="0"
              x2={W}
              y1={H - (t / 100) * H}
              y2={H - (t / 100) * H}
              stroke="#ffffff"
              strokeOpacity="0.10"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <polygon points={area} fill="url(#masteryCurveFill)" />

          {/* vectorEffect keeps the stroke width unscaled under preserveAspectRatio="none". */}
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          <circle
            cx={W}
            cy={y(points[points.length - 1].m_doc)}
            r="2"
            fill="currentColor"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* aria-hidden: the SVG's label already states the range. */}
      <div aria-hidden="true">
        {thresholds.map((t) => (
          <span
            key={t}
            style={{ top: `${100 - t}%` }}
            className="absolute right-0 -translate-y-1/2 font-sans text-[11px] text-slate-600 tabular-nums"
          >
            {t}%
          </span>
        ))}
      </div>
    </div>
  );
}
