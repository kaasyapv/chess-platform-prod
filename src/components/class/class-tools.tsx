"use client";

/* Small classroom tools: a screen recorder and a live network meter.
 * Plain browser APIs, no libraries. Simple and direct. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Square, Wifi } from "lucide-react";

/** Pick a video type the browser can actually record. Prefer mp4, fall back
 *  to webm (Chrome/Firefox record webm). The file extension always matches. */
function pickMime(): { mime: string; ext: string } {
  const R = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  if (R?.isTypeSupported?.("video/mp4")) return { mime: "video/mp4", ext: "mp4" };
  if (R?.isTypeSupported?.("video/webm;codecs=vp9")) return { mime: "video/webm;codecs=vp9", ext: "webm" };
  return { mime: "video/webm", ext: "webm" };
}

/** Screen recorder. Start → captures the screen; Stop → downloads the file to
 *  the machine right away. Exposed as a hook so the classroom toolbar can
 *  drive it from an icon button and still share one implementation. */
export function useScreenRecorder() {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const { mime, ext } = pickMime();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `class-recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setRecording(false);
      };
      // If the user stops sharing from the browser bar, stop cleanly too.
      stream.getVideoTracks()[0].addEventListener("ended", () => rec.state !== "inactive" && rec.stop());
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      // User cancelled the screen picker - nothing to do.
    }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  return { recording, start, stop, toggle: () => (recording ? stop() : void start()) };
}

/** The labelled Start/Stop pill used under the board. */
export function RecordButton() {
  const { recording, start, stop } = useScreenRecorder();

  return recording ? (
    <button
      onClick={stop}
      className="flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-sm font-medium bg-destructive/15 text-destructive border border-destructive hover:bg-destructive/25 transition-colors"
    >
      <Square size={14} className="fill-current" /> Stop
    </button>
  ) : (
    <button
      onClick={start}
      className="flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-sm font-medium border border-border hover:bg-surface-3 transition-colors"
    >
      <Circle size={14} className="text-destructive fill-current" /> Record class
    </button>
  );
}

/** Live network meter - pings a tiny endpoint and shows 1-4 bars by latency. */
export function NetworkMeter() {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const t0 = performance.now();
      try {
        await fetch("/api/health", { cache: "no-store" });
        if (alive) setMs(Math.round(performance.now() - t0));
      } catch {
        if (alive) setMs(null); // offline
      }
    };
    ping();
    const id = setInterval(ping, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Fewer ms = stronger. Map latency to a 0-4 bar count.
  const bars = ms == null ? 0 : ms < 80 ? 4 : ms < 160 ? 3 : ms < 320 ? 2 : 1;
  const color = bars >= 3 ? "var(--success, #22C55E)" : bars === 2 ? "#FACC15" : "#EF4444";
  const label = ms == null ? "Offline" : `${ms} ms`;

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Network: ${label}`}>
      <Wifi size={14} />
      <span className="flex items-end gap-0.5 h-4" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className="w-1 rounded-sm transition-all duration-300"
            style={{
              height: `${n * 25}%`,
              background: n <= bars ? color : "var(--border, #3a3a3a)",
            }}
          />
        ))}
      </span>
      <span className="tabular-nums">{label}</span>
    </span>
  );
}
