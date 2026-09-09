/** Peak amplitude of one Web Audio time-domain frame, normalised 0..1.
 *
 *  `getByteTimeDomainData` gives a waveform in bytes where digital silence sits
 *  at 128. We take the largest deviation from centre over the frame (peak, not
 *  RMS) and divide by 128 — matching the reference pre-flight meter
 *  (MICRO_INTERACTIONS_AND_INTEGRATIONS.md §1.2: `Math.abs` present in the
 *  bundle, `Math.sqrt` / `getByteFrequencyData` are not).
 *
 *  Kept pure and React-free so it is unit-testable on its own. */
export function peakLevel(buf: Uint8Array | number[]): number {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const dev = Math.abs(buf[i] - 128);
    if (dev > peak) peak = dev;
  }
  return peak / 128;
}
