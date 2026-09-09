/* Connection quality from real WebRTC statistics.
 *
 * Pure scoring logic, deliberately separated from the React/peer-connection
 * plumbing in mesh-video-room.tsx so it can be unit-tested without a browser
 * (see tests/net-quality.test.mjs). Nothing here invents numbers: every input
 * comes from RTCPeerConnection.getStats() or the connection state itself.
 *
 * Thresholds follow the usual conferencing rules of thumb - ~150ms RTT and
 * ~2% loss are where a call starts to feel worse, ~300ms/5% is where it hurts.
 */

export type Quality = "excellent" | "good" | "fair" | "poor" | "reconnecting" | "disconnected";

export type NetSample = {
  /** Round-trip time in ms, from candidate-pair currentRoundTripTime. */
  rttMs: number | null;
  /** 0..1 fraction of packets lost since the previous sample. */
  loss: number | null;
  /** Jitter in ms, from the inbound-rtp report. */
  jitterMs: number | null;
  /** Receive bitrate in kbps since the previous sample. */
  kbps: number | null;
  /** True when the link is up but no new packets arrived since the previous
   *  sample - the direct "connected, nothing flowing" signal. */
  stalled: boolean;
};

export const QUALITY_LABEL: Record<Quality, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

/** Tailwind-ish token per level; kept next to the labels so the two can't drift. */
export const QUALITY_COLOR: Record<Quality, string> = {
  excellent: "#22c55e",
  good: "#84cc16",
  fair: "#eab308",
  poor: "#ef4444",
  reconnecting: "#f97316",
  disconnected: "#6b7280",
};

/** Bars filled out of 4 - the little signal-strength glyph. */
export const QUALITY_BARS: Record<Quality, number> = {
  excellent: 4, good: 3, fair: 2, poor: 1, reconnecting: 1, disconnected: 0,
};

/**
 * Map a connection state + one stats sample onto a quality level.
 *
 * Connection state wins outright: a peer that is reconnecting or gone is not
 * "excellent" just because its last sample looked fine. Otherwise the worst of
 * the three signals decides, because a call is only as good as its weakest
 * dimension - 20ms RTT doesn't rescue 10% packet loss.
 */
export function scoreQuality(
  state: RTCPeerConnectionState | "unknown",
  s: NetSample,
): Quality {
  if (state === "failed" || state === "closed") return "disconnected";
  if (state === "disconnected" || state === "connecting" || state === "new") return "reconnecting";

  const levels: Quality[] = [];

  if (s.rttMs != null) {
    levels.push(s.rttMs < 100 ? "excellent" : s.rttMs < 200 ? "good" : s.rttMs < 350 ? "fair" : "poor");
  }
  if (s.loss != null) {
    levels.push(s.loss < 0.01 ? "excellent" : s.loss < 0.03 ? "good" : s.loss < 0.08 ? "fair" : "poor");
  }
  if (s.jitterMs != null) {
    levels.push(s.jitterMs < 20 ? "excellent" : s.jitterMs < 40 ? "good" : s.jitterMs < 80 ? "fair" : "poor");
  }
  /* A connected peer sending nothing is not a healthy link - but judge that on
   * packets actually arriving, not on a bitrate threshold.
   *
   * This used to be `kbps < 15`, which rated a real peer connection carrying a
   * low-motion 320x240 stream as "poor" while RTT was 1ms with zero loss and
   * zero jitter (caught by running the real thing in Chrome, not by the unit
   * tests, which only ever fed it 0 kbps). Video bitrate legitimately collapses
   * on a static scene, so it says nothing about link health; "no new packets
   * since the last tick" is the thing actually worth reacting to. */
  if (s.stalled) levels.push("poor");

  if (levels.length === 0) return "good"; // connected, nothing measured yet

  const order: Quality[] = ["excellent", "good", "fair", "poor"];
  return levels.reduce((worst, l) => (order.indexOf(l) > order.indexOf(worst) ? l : worst), "excellent");
}

export type RawReport = {
  type: string;
  nominated?: boolean;
  state?: string;
  currentRoundTripTime?: number;
  jitter?: number;
  packetsLost?: number;
  packetsReceived?: number;
  bytesReceived?: number;
  timestamp?: number;
  kind?: string;
};

/**
 * Reduce an RTCStatsReport into a NetSample, differencing the cumulative
 * counters against the previous reading.
 *
 * packetsLost/bytesReceived from getStats are totals for the whole session, so
 * using them raw would average a hiccup away over minutes and never recover.
 * The deltas are what make the meter actually track *current* conditions.
 */
export function sampleFromStats(
  reports: Iterable<RawReport>,
  prev: { packetsLost: number; packetsReceived: number; bytesReceived: number; timestamp: number } | null,
): { sample: NetSample; cursor: { packetsLost: number; packetsReceived: number; bytesReceived: number; timestamp: number } } {
  let rttMs: number | null = null;
  let jitterMs: number | null = null;
  let packetsLost = 0, packetsReceived = 0, bytesReceived = 0, timestamp = 0;

  for (const r of reports) {
    if (r.type === "candidate-pair" && (r.nominated || r.state === "succeeded")) {
      if (typeof r.currentRoundTripTime === "number") rttMs = r.currentRoundTripTime * 1000;
    }
    if (r.type === "inbound-rtp") {
      if (typeof r.jitter === "number") {
        const j = r.jitter * 1000;
        // Several inbound streams (audio + video): report the worst.
        jitterMs = jitterMs == null ? j : Math.max(jitterMs, j);
      }
      packetsLost += r.packetsLost ?? 0;
      packetsReceived += r.packetsReceived ?? 0;
      bytesReceived += r.bytesReceived ?? 0;
      timestamp = Math.max(timestamp, r.timestamp ?? 0);
    }
  }

  const cursor = { packetsLost, packetsReceived, bytesReceived, timestamp };

  let loss: number | null = null;
  let kbps: number | null = null;
  let stalled = false;
  if (prev) {
    const dLost = packetsLost - prev.packetsLost;
    const dRecv = packetsReceived - prev.packetsReceived;
    const denom = dLost + dRecv;
    if (denom > 0) loss = Math.min(1, Math.max(0, dLost / denom));
    const dMs = timestamp - prev.timestamp;
    if (dMs > 0) kbps = ((bytesReceived - prev.bytesReceived) * 8) / dMs; // bytes/ms*8 == kbit/s
    // Time moved on and not a single packet arrived: the media has stopped,
    // whatever the connection state claims.
    stalled = dMs > 0 && dRecv === 0 && dLost === 0;
  }

  return { sample: { rttMs, loss, jitterMs, kbps, stalled }, cursor };
}
