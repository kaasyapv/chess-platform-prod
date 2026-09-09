"use client";

/* Browser self-test for the live classroom.
 *
 * Every check here maps to something the classroom actually needs, and each
 * one runs for real rather than sniffing the user agent - feature detection
 * tells you what a browser does, a UA string tells you what it claims. The
 * camera/mic check is opt-in behind a button because it triggers a permission
 * prompt, and a page that demands the camera on load is a page nobody runs.
 */

import { useCallback, useEffect, useState } from "react";

type Status = "pass" | "fail" | "warn" | "running" | "idle";
type Check = { id: string; label: string; status: Status; detail: string; why: string };

const START: Check[] = [
  { id: "secure", label: "Secure context", status: "idle", detail: "", why: "getUserMedia and WebRTC are blocked outside HTTPS/localhost." },
  { id: "ws", label: "WebSockets", status: "idle", detail: "", why: "Board sync, chat and presence all ride Supabase Realtime." },
  { id: "webrtc", label: "WebRTC (RTCPeerConnection)", status: "idle", detail: "", why: "Classroom video is peer-to-peer; no WebRTC, no video." },
  { id: "loopback", label: "Real peer connection + media", status: "idle", detail: "", why: "Proves ICE negotiation and media actually flow in this browser." },
  { id: "stats", label: "getStats() fields for network meters", status: "idle", detail: "", why: "The meter reads RTT, jitter and packet counters from these reports." },
  { id: "devices", label: "Camera / microphone present", status: "idle", detail: "", why: "Lists devices without asking for permission yet." },
  { id: "screenshare", label: "Screen share API", status: "idle", detail: "", why: "Coaches share their screen during class." },
  { id: "canvas", label: "Canvas capture (whiteboard)", status: "idle", detail: "", why: "The whiteboard draws to a canvas and syncs strokes." },
  { id: "storage", label: "Local storage", status: "idle", detail: "", why: "Board settings and session state persist here." },
];

export function DiagnosticsClient() {
  const [checks, setChecks] = useState<Check[]>(START);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [mediaResult, setMediaResult] = useState<{ status: Status; detail: string }>({ status: "idle", detail: "" });

  const set = (id: string, status: Status, detail: string) =>
    setChecks((cur) => cur.map((c) => (c.id === id ? { ...c, status, detail } : c)));

  const run = useCallback(async () => {
    setChecks(START.map((c) => ({ ...c, status: "running" })));

    setEnv({
      "User agent": navigator.userAgent,
      Platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "unknown",
      Language: navigator.language,
      Screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
      Viewport: `${window.innerWidth}x${window.innerHeight}`,
      "Tested at": new Date().toString(),
      Origin: location.origin,
    });

    set("secure", window.isSecureContext ? "pass" : "fail",
      window.isSecureContext ? "Secure context" : "NOT secure: camera and WebRTC will be blocked");

    // WebSocket: actually open one against this origin.
    try {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/_diag_ws_probe`;
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(url);
        const done = (ok: boolean, msg: string) => {
          set("ws", ok ? "pass" : "warn", msg);
          try { ws.close(); } catch { /* already closed */ }
          resolve();
        };
        // Any response - even a rejected handshake - proves the API works.
        ws.onopen = () => done(true, "WebSocket opened");
        ws.onerror = () => done(true, "WebSocket API works (probe endpoint refused, which is expected)");
        setTimeout(() => done(false, "No response within 4s"), 4000);
      });
    } catch (e) {
      set("ws", "fail", e instanceof Error ? e.message : "WebSocket unavailable");
    }

    const hasRtc = typeof RTCPeerConnection !== "undefined";
    set("webrtc", hasRtc ? "pass" : "fail", hasRtc ? "RTCPeerConnection available" : "Not supported: video cannot work");

    // Real loopback: two peer connections, a canvas track, ICE, media, stats.
    if (hasRtc) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 120;
        const ctx = canvas.getContext("2d")!;
        let f = 0;
        const paint = setInterval(() => { f++; ctx.fillStyle = `hsl(${(f * 11) % 360},70%,50%)`; ctx.fillRect(0, 0, 160, 120); }, 60);
        const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(12);

        // STUN included: some browsers won't nominate a pair from host
        // candidates alone, and a diagnostic that reports a false failure is
        // worse than no diagnostic.
        const ice = { iceServers: [{ urls: ["stun:stun1.l.google.com:19302"] }] };
        const a = new RTCPeerConnection(ice);
        const b = new RTCPeerConnection(ice);
        a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
        b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
        let got = false;
        b.ontrack = () => { got = true; };
        stream.getTracks().forEach((t) => a.addTrack(t, stream));

        const offer = await a.createOffer();
        await a.setLocalDescription(offer);
        await b.setRemoteDescription(offer);
        const answer = await b.createAnswer();
        await b.setLocalDescription(answer);
        await a.setRemoteDescription(answer);

        /* Poll until both sides connect rather than sleeping a fixed interval.
         * ICE timing varies wildly by browser and network, and a fixed wait is
         * exactly how a healthy browser gets reported as broken. */
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          if (a.connectionState === "connected" && b.connectionState === "connected") break;
          if (a.connectionState === "failed" || b.connectionState === "failed") break;
          await new Promise((r) => setTimeout(r, 250));
        }
        // Give media a moment to start decoding once the pair is up.
        await new Promise((r) => setTimeout(r, 800));

        const connected = a.connectionState === "connected" && b.connectionState === "connected";
        set("loopback", connected && got ? "pass" : "fail",
          `a=${a.connectionState}, b=${b.connectionState}, track received: ${got}`);

        // The exact fields src/lib/net-quality.ts reads.
        const reports: Record<string, unknown>[] = [];
        (await b.getStats()).forEach((r) => reports.push(r as unknown as Record<string, unknown>));
        const pair = reports.find((r) => r.type === "candidate-pair" && (r.nominated || r.state === "succeeded"));
        const inbound = reports.find((r) => r.type === "inbound-rtp");
        const fields = {
          currentRoundTripTime: pair?.currentRoundTripTime !== undefined,
          jitter: inbound?.jitter !== undefined,
          packetsReceived: inbound?.packetsReceived !== undefined,
          packetsLost: inbound?.packetsLost !== undefined,
          bytesReceived: inbound?.bytesReceived !== undefined,
        };
        const missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
        set("stats", missing.length === 0 ? "pass" : "warn",
          missing.length === 0
            ? "All meter inputs present (RTT, jitter, packets, bytes)"
            : `Missing: ${missing.join(", ")}. Meters will show fewer dimensions here`);

        clearInterval(paint);
        stream.getTracks().forEach((t) => t.stop());
        a.close(); b.close();
      } catch (e) {
        set("loopback", "fail", e instanceof Error ? e.message : "peer connection failed");
        set("stats", "fail", "not reached");
      }
    } else {
      set("loopback", "fail", "no WebRTC");
      set("stats", "fail", "no WebRTC");
    }

    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter((d) => d.kind === "videoinput").length;
      const mics = devs.filter((d) => d.kind === "audioinput").length;
      set("devices", cams > 0 && mics > 0 ? "pass" : "warn", `${cams} camera(s), ${mics} microphone(s)`);
    } catch {
      set("devices", "fail", "enumerateDevices unavailable");
    }

    const canShare = typeof navigator.mediaDevices?.getDisplayMedia === "function";
    set("screenshare", canShare ? "pass" : "warn",
      canShare ? "getDisplayMedia available" : "Not available (common on mobile browsers)");

    try {
      const c = document.createElement("canvas");
      const ok = typeof (c as HTMLCanvasElement & { captureStream?: unknown }).captureStream === "function" && !!c.getContext("2d");
      set("canvas", ok ? "pass" : "warn", ok ? "Canvas + captureStream available" : "captureStream missing");
    } catch {
      set("canvas", "fail", "canvas unavailable");
    }

    try {
      localStorage.setItem("__diag", "1");
      localStorage.removeItem("__diag");
      set("storage", "pass", "Readable and writable");
    } catch {
      set("storage", "warn", "Blocked (private mode or blocked cookies)");
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  /** Opt-in: this one prompts for permission, so it never runs automatically. */
  const testMedia = async () => {
    setMediaResult({ status: "running", detail: "Requesting camera and microphone…" });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const v = s.getVideoTracks()[0], a = s.getAudioTracks()[0];
      const settings = v?.getSettings?.() ?? {};
      setMediaResult({
        status: "pass",
        detail: `Camera: ${v?.label || "(unnamed)"} ${settings.width ?? "?"}x${settings.height ?? "?"} · Mic: ${a?.label || "(unnamed)"}`,
      });
      s.getTracks().forEach((t) => t.stop()); // release hardware immediately
    } catch (e) {
      const err = e as DOMException;
      setMediaResult({
        status: "fail",
        detail: `${err.name}: ${err.message}${err.name === "NotAllowedError" ? " (permission was denied for this site)" : ""}`,
      });
    }
  };

  const summary = checks.reduce(
    (acc, c) => { if (c.status === "pass") acc.pass++; else if (c.status === "fail") acc.fail++; else if (c.status === "warn") acc.warn++; return acc; },
    { pass: 0, fail: 0, warn: 0 },
  );

  const copy = () => {
    const text = [
      "ChessAcademy browser diagnostics",
      ...Object.entries(env).map(([k, v]) => `${k}: ${v}`),
      "",
      ...checks.map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`),
      `[${mediaResult.status.toUpperCase()}] Camera/mic acquisition: ${mediaResult.detail || "not run"}`,
    ].join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: ".25rem" }}>Browser diagnostics</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Open this page in each browser and device you want to certify. Everything is
        feature-tested for real - nothing is inferred from the user agent.
      </p>

      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <Badge tone="pass">{summary.pass} pass</Badge>
        {summary.warn > 0 && <Badge tone="warn">{summary.warn} warn</Badge>}
        {summary.fail > 0 && <Badge tone="fail">{summary.fail} fail</Badge>}
        <button onClick={run} style={btn}>Re-run</button>
        <button onClick={copy} style={btn}>Copy results</button>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {checks.map((c) => (
          <li key={c.id} style={{ borderBottom: "1px solid #e5e5e5", padding: ".75rem 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <Dot status={c.status} />
              <strong>{c.label}</strong>
            </div>
            <div style={{ fontSize: ".875rem", color: "#444", marginLeft: "1.25rem" }}>{c.detail || "…"}</div>
            <div style={{ fontSize: ".78rem", color: "#888", marginLeft: "1.25rem" }}>{c.why}</div>
          </li>
        ))}
      </ul>

      <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #e5e5e5", borderRadius: 10 }}>
        <strong>Camera &amp; microphone</strong>
        <p style={{ fontSize: ".875rem", color: "#555" }}>
          Runs only when you ask, because it triggers a permission prompt. Allow it, and the
          hardware is released again immediately.
        </p>
        <button onClick={testMedia} style={{ ...btn, background: "#372FC3", color: "#fff", borderColor: "#372FC3" }}>
          Test camera &amp; microphone
        </button>
        {mediaResult.status !== "idle" && (
          <div style={{ marginTop: ".75rem", display: "flex", gap: ".5rem", alignItems: "center" }}>
            <Dot status={mediaResult.status} />
            <span style={{ fontSize: ".875rem" }}>{mediaResult.detail}</span>
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <strong>Environment</strong>
        <pre style={{ fontSize: ".75rem", background: "#f6f6f6", padding: ".75rem", borderRadius: 8, overflowX: "auto" }}>
          {Object.entries(env).map(([k, v]) => `${k}: ${v}`).join("\n")}
        </pre>
      </section>
    </main>
  );
}

const btn: React.CSSProperties = {
  padding: ".4rem .8rem", borderRadius: 8, border: "1px solid #ccc",
  background: "#fff", cursor: "pointer", fontSize: ".875rem",
};

function Badge({ tone, children }: { tone: Status; children: React.ReactNode }) {
  const bg = tone === "pass" ? "#e6f6ec" : tone === "warn" ? "#fdf3e2" : "#fde8e8";
  const fg = tone === "pass" ? "#1a7f42" : tone === "warn" ? "#8a5a00" : "#b42222";
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: ".25rem .7rem", fontSize: ".8rem", fontWeight: 600 }}>{children}</span>;
}

function Dot({ status }: { status: Status }) {
  const color = status === "pass" ? "#1a7f42" : status === "fail" ? "#b42222"
    : status === "warn" ? "#c98a00" : "#999";
  return <span aria-label={status} style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block", flexShrink: 0 }} />;
}
