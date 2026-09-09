"use client";

/* Sandbox: a perfectly symmetric wooden frame around a 1:1 dummy board.
 *
 * Why the old approach produced a thicker right edge: composing the frame from
 * layout TRACKS (grid columns / flex children) makes the browser distribute
 * the container's fractional remainder pixels across tracks, and the last
 * track eats the rounding difference - so one side of the "frame" renders a
 * device pixel wider. The fix is to never let layout math near the frame:
 *
 *   1. The frame is ONE box: `background` + uniform `padding`. The CSS box
 *      model guarantees the four padding edges are the same used length -
 *      there is nothing to distribute and nothing to round unevenly.
 *   2. The board inside is ONE undivided element with an 8×8 SVG painted as
 *      `background-size: 100% 100%`. The squares come from image scaling, not
 *      from 64 layout boxes, so no per-square rounding seams either.
 *   3. The outer box is snapped to a whole device pixel (see useEffect), so
 *      `aspect-ratio: 1/1` can't leave a fractional-pixel edge for the
 *      compositor to render as a hairline on one side only.
 *
 * This is exactly how the reference builds it (playmate `.chessboard-inner`:
 * a #8B4513 div with flat 6px padding around a single board element).
 */

import { useEffect, useRef, useState } from "react";

const FRAME = "#8B4513";
const LIGHT = "#EFD9B4";
const DARK = "#B58763";

const BOARD_SVG = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="${LIGHT}"/>${
    Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) =>
        (r + c) % 2 === 1 ? `<rect x="${c}" y="${r}" width="1" height="1" fill="${DARK}"/>` : ""
      ).join("")
    ).join("")
  }</svg>`
)}")`;

/** Measured thickness of each frame side, in CSS px - the component's own
 *  proof of symmetry, shown under the board. */
type Sides = { top: number; right: number; bottom: number; left: number };

export function SymmetricBoard({ size = 480, frameWidth = 6 }: { size?: number; frameWidth?: number }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [snapped, setSnapped] = useState(size);
  const [sides, setSides] = useState<Sides | null>(null);

  useEffect(() => {
    // Snap the outer edge to a whole device pixel so the box can't end on a
    // fraction (a fractional edge antialiases as a one-sided hairline).
    const dpr = window.devicePixelRatio || 1;
    setSnapped(Math.round(size * dpr) / dpr);
  }, [size]);

  useEffect(() => {
    const f = frameRef.current?.getBoundingClientRect();
    const b = boardRef.current?.getBoundingClientRect();
    if (!f || !b) return;
    setSides({
      top: b.top - f.top,
      right: f.right - b.right,
      bottom: f.bottom - b.bottom,
      left: b.left - f.left,
    });
  }, [snapped, frameWidth]);

  const symmetric =
    sides && new Set(Object.values(sides).map((v) => v.toFixed(2))).size === 1;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div
        ref={frameRef}
        style={{
          width: snapped,
          aspectRatio: "1 / 1",
          background: FRAME,
          padding: frameWidth,
          boxSizing: "border-box",
        }}
      >
        <div
          ref={boardRef}
          style={{
            width: "100%",
            height: "100%",
            backgroundImage: BOARD_SVG,
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
          }}
        />
      </div>
      {sides && (
        <p className={`text-xs font-mono ${symmetric ? "text-green-600" : "text-red-600"}`}>
          {symmetric ? "Symmetric" : "Asymmetric"}: T {sides.top.toFixed(2)} · R{" "}
          {sides.right.toFixed(2)} · B {sides.bottom.toFixed(2)} · L {sides.left.toFixed(2)} px
        </p>
      )}
    </div>
  );
}
