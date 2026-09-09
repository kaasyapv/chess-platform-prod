"use client";

/* PDF → board. Render a chess book / worksheet page to a canvas, drag a box
 * around one diagram, send just that crop to the FEN recognizer.
 *
 * Recognizer target, in order of preference:
 *   1. NEXT_PUBLIC_FEN_RECOGNIZER_URL  → the Python service in
 *      services/fen-recognizer (OpenCV/CNN board reader)
 *   2. /api/knowledge/snap             → the built-in AI vision fallback
 * Both take { base64, mediaType } and return { fen, confidence } | { error }.
 *
 * pdf.js renders the page; everything else is a positioned <div> over the
 * canvas. The worker is copied to /public/pdf.worker.min.mjs at install time.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { Button } from "@/components/ui";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const RECOGNIZER_URL = process.env.NEXT_PUBLIC_FEN_RECOGNIZER_URL;

type Box = { x: number; y: number; w: number; h: number };

export function PdfCropper({
  file, onFen, onClose,
}: {
  file: File;
  onFen: (fen: string, confidence: number) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);

  // The doc lives in state, not a ref: a single-page PDF leaves `page` and
  // `pageCount` both at 1, so a ref-based render effect keyed on those never
  // re-runs once the doc loads and the cropper hangs on "Rendering page…".
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [box, setBox] = useState<Box>({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }); // fractions of the canvas
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    file.arrayBuffer().then(async (buf) => {
      try {
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        loadingTaskRef.current = task;
        const doc = await task.promise;
        if (cancelled) return;
        setPdf(doc);
        setPageCount(doc.numPages);
        setPage(1);
      } catch {
        if (!cancelled) setErr("Could not open this PDF.");
      }
    });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      setPdf(null);
    };
  }, [file]);

  // Render the current page whenever it (or the loaded doc) changes.
  useEffect(() => {
    const doc = pdf;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    setRendering(true);
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled) return;
      const wrapW = wrapRef.current?.clientWidth ?? 640;
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(2, wrapW / base.width);
      const viewport = p.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTaskRef.current?.cancel();
      const task = p.render({ canvas, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled render - fine */
      }
      if (!cancelled) setRendering(false);
    })();
    return () => { cancelled = true; };
  }, [pdf, page]);

  // Drag the box body / a corner handle. Deltas are in canvas fractions so the
  // box tracks the page at any render scale.
  const drag = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const start = { px: e.clientX, py: e.clientY, ...box };
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - start.px) / rect.width;
        const dy = (ev.clientY - start.py) / rect.height;
        setBox(() => {
          if (mode === "move") {
            return {
              ...start,
              x: Math.min(Math.max(0, start.x + dx), 1 - start.w),
              y: Math.min(Math.max(0, start.y + dy), 1 - start.h),
            };
          }
          return {
            ...start,
            w: Math.min(Math.max(0.08, start.w + dx), 1 - start.x),
            h: Math.min(Math.max(0.08, start.h + dy), 1 - start.y),
          };
        });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [box],
  );

  async function recognize() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setErr(null);
    try {
      const sx = Math.round(box.x * canvas.width);
      const sy = Math.round(box.y * canvas.height);
      const sw = Math.round(box.w * canvas.width);
      const sh = Math.round(box.h * canvas.height);
      const crop = document.createElement("canvas");
      crop.width = sw;
      crop.height = sh;
      crop.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = crop.toDataURL("image/png");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

      const res = await fetch(RECOGNIZER_URL ?? "/api/knowledge/snap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base64, mediaType: "image/png" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fen?: string; confidence?: number; error?: string;
      };
      if (!res.ok || !body.fen) {
        setErr(body.error ?? "Could not read a position from that crop.");
        return;
      }
      onFen(body.fen, Number(body.confidence ?? 0));
    } catch {
      setErr("Recognizer request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Drag the box over one diagram, then read it onto the board.
          {RECOGNIZER_URL ? " (OpenCV recognizer)" : " (AI vision)"}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-btn border border-border px-2 py-1 text-xs disabled:opacity-30"
          >
            ‹
          </button>
          <span className="tabular-nums text-xs text-muted-foreground">
            {page} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="rounded-btn border border-border px-2 py-1 text-xs disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative max-h-[60vh] overflow-auto rounded-card border border-border bg-surface-2"
      >
        <div className="relative w-fit">
          <canvas ref={canvasRef} className="block max-w-full" />
          {!rendering && (
            <div
              onPointerDown={drag("move")}
              className="absolute cursor-move rounded-sm border-2 border-primary bg-primary/10"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            >
              <span
                onPointerDown={drag("resize")}
                className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize rounded-full border-2 border-white bg-primary"
              />
            </div>
          )}
          {rendering && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Rendering page…
            </div>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void recognize()} disabled={busy || rendering}>
          {busy ? "Reading…" : "Read position → board"}
        </Button>
      </div>
    </div>
  );
}
