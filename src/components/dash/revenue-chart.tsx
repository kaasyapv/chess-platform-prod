"use client";

/* Revenue over the last twelve months - one measure, so one series, one axis,
 * and no legend (the title names it).
 *
 * The line moves: every few seconds the newest month drifts a little, the way a
 * running total does while payments land. The movement is eased in the browser,
 * stops when the tab is hidden, and is switched off for anyone who asked for
 * reduced motion. The SVG uses a fixed viewBox and scales with its box, so a
 * resize never causes a layout shift. */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { inr, inrShort, lerpAll, nudge, type MonthPoint } from "@/lib/finance";

const W = 1000;      // viewBox units - the SVG scales to whatever width it gets
const H = 300;
// left has to fit "₹12.34L" without clipping the rupee sign
const PAD = { top: 20, right: 24, bottom: 30, left: 92 };

const TICK_MS = 2600;   // how often a fresh reading arrives
const EASE_MS = 700;    // how long it takes to slide there

/** Catmull-Rom through the points, emitted as a cubic bezier path. Smooth
 *  without the overshoot a plain bezier gives you. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function RevenueChartImpl({ months, live = true }: { months: MonthPoint[]; live?: boolean }) {
  const base = useMemo(() => months.map((m) => m.revenue), [months]);
  const [values, setValues] = useState<number[]>(base);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Read inside the interval without making it a dependency.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => setValues(base), [base]);

  /* The live feed. Nudges the last three months by a fraction of a percent and
   * eases into the new shape. Cheap: one rAF loop per tick, no re-layout. */
  useEffect(() => {
    if (!live || base.length < 2) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (document.hidden) { timer = setTimeout(tick, TICK_MS); return; }
      const from = valuesRef.current;
      const to = nudge(from);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / EASE_MS);
        setValues(lerpAll(from, to, t));
        if (t < 1) raf = requestAnimationFrame(step);
        else timer = setTimeout(tick, TICK_MS);
      };
      raf = requestAnimationFrame(step);
    };

    timer = setTimeout(tick, TICK_MS);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [live, base]);

  const geom = useMemo(() => {
    const max = Math.max(...values, 1) * 1.12;
    const min = 0;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (innerW * i) / Math.max(1, values.length - 1);
    const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;
    const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
    const line = smoothPath(pts);
    const area = line ? `${line} L ${pts.at(-1)!.x} ${PAD.top + innerH} L ${pts[0].x} ${PAD.top + innerH} Z` : "";
    const ticks = Array.from({ length: 4 }, (_, i) => {
      const v = (max / 3) * i;
      return { v, y: y(v) };
    });
    return { pts, line, area, ticks, innerH };
  }, [values]);

  // Nearest point to the pointer, in viewBox units.
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < geom.pts.length; i++) {
      if (Math.abs(geom.pts[i].x - vx) < Math.abs(geom.pts[best].x - vx)) best = i;
    }
    setHover(best);
  }

  const last = geom.pts.at(-1);

  return (
    <div className="relative w-full">
      {/* No preserveAspectRatio override: the SVG keeps its 1000x300 ratio, so
          the axis text never stretches and the height follows the width. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block touch-none"
        role="img"
        aria-label="Revenue for the last twelve months"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary-hover)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--primary-hover)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* recessive grid + value axis */}
        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
              stroke="var(--border)" strokeWidth="1" />
            <text x={PAD.left - 10} y={t.y + 4} textAnchor="end"
              fill="var(--muted-foreground)" fontSize="16">{inrShort(t.v)}</text>
          </g>
        ))}

        {/* month labels */}
        {months.map((m, i) => (
          <text key={m.month + i} x={geom.pts[i]?.x ?? 0} y={H - 8} textAnchor="middle"
            fill="var(--muted-foreground)" fontSize="16">{m.month}</text>
        ))}

        <path d={geom.area} fill="url(#rev-fill)" />
        <path d={geom.line} fill="none" stroke="var(--primary-hover)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

        {/* the newest reading, pulsing quietly */}
        {last && (
          <>
            <circle cx={last.x} cy={last.y} r="12" fill="var(--primary-hover)" opacity="0.18">
              <animate attributeName="r" values="8;16;8" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.28;0.04;0.28" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={last.x} cy={last.y} r="4.5" fill="var(--primary-hover)"
              stroke="var(--surface-2)" strokeWidth="2" />
          </>
        )}

        {/* crosshair */}
        {hover !== null && geom.pts[hover] && (
          <>
            <line x1={geom.pts[hover].x} x2={geom.pts[hover].x} y1={PAD.top} y2={PAD.top + geom.innerH}
              stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={geom.pts[hover].x} cy={geom.pts[hover].y} r="5"
              fill="var(--primary-hover)" stroke="var(--surface-2)" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* tooltip - plain HTML, so the text stays crisp at any width */}
      {hover !== null && months[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-btn border border-border bg-surface-3 px-3 py-1.5 shadow-lg"
          style={{
            left: `${(geom.pts[hover].x / W) * 100}%`,
            top: `calc(${(geom.pts[hover].y / H) * 100}% - 8px)`,
          }}
        >
          <p className="text-[11px] text-muted-foreground">{months[hover].month}</p>
          <p className="text-sm font-semibold tabular-nums">{inr(values[hover])}</p>
        </div>
      )}
    </div>
  );
}

export const RevenueChart = memo(RevenueChartImpl);
