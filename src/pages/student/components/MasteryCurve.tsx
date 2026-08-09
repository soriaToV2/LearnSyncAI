import { masteryPercent } from '../../../lib/mastery';
import type { CurvePoint } from '../../../lib/dashboard';

/**
 * The mastery curve — EQ(4) document mastery over the student's history.
 *
 * Hand-rolled SVG. This codebase has no chart library and does not want one; the
 * precedent is the progress `Ring` in `cognitiveShared.tsx`.
 *
 * ══ THE X AXIS IS AN EVENT INDEX, NOT TIME ══
 * Each point is one learning opportunity, evenly spaced. Two reasons, and the
 * first is fatal on its own:
 *
 *   1. Every BKT update inside one study session shares a timestamp to the
 *      millisecond, so a real study day plots as a VERTICAL LINE on a time axis.
 *   2. BKT has no forgetting term. A two-week gap is a perfectly flat segment,
 *      which reads to a student as "you stalled" when the model is incapable of
 *      moving without evidence. That is the chart lying about the model.
 *
 * The paper's own time index is the learning opportunity `t`. Dates go under the
 * axis as text, where they inform without positioning anything.
 *
 * ══ THE Y AXIS IS FIXED 0–100 AND MUST STAY THAT WAY ══
 * Auto-scaling to the data's own range is the single most common way a chart
 * lies: a 10% → 24% climb would fill the box and read as mastery of everything.
 * Fixed bounds also make the 50 and 85 tier lines meaningful, so the shape is
 * read against the same thresholds as the number and the tier label beside it.
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
  // Closed back along the baseline so the area can be tinted under the line.
  const area = `0,${H} ${line} ${W},${H}`;

  const first = masteryPercent(points[0].m_doc);
  const last = masteryPercent(points[points.length - 1].m_doc);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`w-full h-24 ${toneClass}`}
      role="img"
      aria-label={`Mastery went from ${first}% to ${last}% over ${points.length - 1} learning opportunities.`}
    >
      {/* Drawn in white rather than `currentColor`: these are the axis, not the
          data. Tinting them with the tier colour made them read as part of the
          line, and at the opacity that suited a mid-tone they vanished entirely
          against a foundational one. */}
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

      <polygon points={area} fill="currentColor" fillOpacity="0.08" />

      {/* `vectorEffect` is required: preserveAspectRatio="none" scales x and y by
          different factors, which would otherwise squash the stroke width too. */}
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
  );
}
