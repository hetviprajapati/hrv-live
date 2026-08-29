/**
 * HRV.LIVE — beat filter + metrics
 * ================================
 *
 * Plain functions and one plain object. No classes.
 *
 * THE RULE (this is the whole thing)
 * ----------------------------------
 * A beat is BAD if either:
 *
 *   1. the jump from the previous beat is more than 20% AND more than 150 ms
 *   2. the jump from the previous beat is more than 300 ms, whatever the %
 *
 * A bad beat is marked in red, shown in the log, and left out of the score.
 * Nothing is repaired. Nothing is interpolated. Nothing is hidden.
 *
 * Worked example (the one the client wrote):
 *
 *   878
 *   953   +75  /  8.5%   ok
 *   899   -54  /  5.7%   ok
 *   925   +26  /  2.9%   ok
 *   1200  +275 / 29.7%   BAD   (over 20% and over 150 ms)
 *   400   -800 / 66.7%   BAD   (over 300 ms)
 *   895   +495 / 123.8%  BAD   (over 300 ms)
 *   965   +70  /  7.8%   ok
 *   899   -66  /  6.8%   ok
 *
 *   shown:   878, 953, 899, 925, 1200*, 400*, 895*, 965, 899
 *   scored:  878, 953, 899, 925, 965, 899
 *
 * Two details worth knowing, both taken straight from that example:
 *
 *   - Each beat is compared to the PREVIOUS RAW BEAT, bad or not. The 400 is
 *     judged against 1200, not against the last good beat 925.
 *
 *   - The score is the good beats, in order, with the bad ones taken out. So
 *     925 -> 965 is a counted difference even though three bad beats sat
 *     between them. That is what the example says to do.
 */
 
/* ------------------------------------------------------------------ *
 * The numbers
 * ------------------------------------------------------------------ */
 
export const HRV_CONFIG = {
  /** Rule 1: jump bigger than this share of the previous beat... */
  pctJump: 0.2,
  /** ...AND bigger than this many milliseconds. */
  absWithPctMs: 150,
  /** Rule 2: jump bigger than this many ms, on its own. */
  absAloneMs: 300,
 
  /**
   * The rolling score covers the last 18 beats — the same 18 beats the log
   * panel shows. One number drives both, so what you see is what is counted.
   */
  windowBeats: 18,
};
 
export type HrvConfig = typeof HRV_CONFIG;
 
/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */
 
export type Beat = {
  /** Exactly what the sensor sent. Never changed. */
  rr: number;
  /** When it arrived, ms since epoch. */
  at: number;
  /** True = flagged, shown in red, not counted. */
  bad: boolean;
  /** Why it was flagged. Empty string when it is a good beat. */
  reason: string;
};
 
export type HrvState = {
  /** The last 18 beats, oldest first. Bad ones included. */
  beats: Beat[];
  /** RMSSD readings kept for the 60-second average. */
  rmssdSamples: { t: number; v: number }[];
  /** Session totals, for the header line. */
  beatsSeen: number;
  beatsFlagged: number;
};
 
export type HrvSnapshot = {
  heartRate: number | null;
  rmssd: number | null;
  sdnn: number | null;
  pnn50: number | null;
  avgRmssd: number | null;
 
  /** Good beats in the window, and total beats in the window. */
  goodBeats: number;
  windowSize: number;
  /** Flagged share of the window, 0..1. Display only. */
  artifactRate: number;
 
  beatsSeen: number;
  beatsFlagged: number;
 
  /** True once there is a number to show. */
  ready: boolean;
};
 
/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
 
export function createHrvState(): HrvState {
  return { beats: [], rmssdSamples: [], beatsSeen: 0, beatsFlagged: 0 };
}
 
/** Wipe everything. Call on connect and on disconnect. */
export function resetHrvState(state: HrvState): void {
  state.beats = [];
  state.rmssdSamples = [];
  state.beatsSeen = 0;
  state.beatsFlagged = 0;
}
 
/* ------------------------------------------------------------------ *
 * The rule
 * ------------------------------------------------------------------ */
 
/**
 * Judge one beat against the one before it.
 *
 * `prevRr` is the previous raw beat, whether or not it was flagged.
 * The very first beat of a session has no previous beat, so it is good.
 */
export function classifyBeat(
  rr: number,
  prevRr: number | null,
  cfg: HrvConfig = HRV_CONFIG,
): { bad: boolean; reason: string } {
  if (prevRr === null) return { bad: false, reason: '' };
 
  const delta = rr - prevRr;
  const abs = Math.abs(delta);
  const pct = abs / prevRr;
 
  // Rule 2: a big absolute jump, whatever the percentage.
  if (abs > cfg.absAloneMs) {
    return { bad: true, reason: `${sign(delta)}ms (over ${cfg.absAloneMs}ms)` };
  }
 
  // Rule 1: a big percentage jump that is also big in milliseconds.
  if (pct > cfg.pctJump && abs > cfg.absWithPctMs) {
    return { bad: true, reason: `${sign(delta)}ms / ${(pct * 100).toFixed(0)}%` };
  }
 
  return { bad: false, reason: '' };
}
 
function sign(delta: number): string {
  return (delta > 0 ? '+' : '') + Math.round(delta);
}
 
/**
 * Feed one interval in. Returns the beat as recorded, so the caller can
 * put it straight into the log.
 */
export function pushBeat(
  state: HrvState,
  rr: number,
  at: number,
  cfg: HrvConfig = HRV_CONFIG,
): Beat {
  const previous = state.beats.length > 0 ? state.beats[state.beats.length - 1].rr : null;
 
  const { bad, reason } = classifyBeat(rr, previous, cfg);
  const beat: Beat = { rr, at, bad, reason };
 
  state.beats.push(beat);
  state.beatsSeen += 1;
  if (bad) state.beatsFlagged += 1;
 
  // Keep only the last 18 beats. The oldest one falls off the end.
  while (state.beats.length > cfg.windowBeats) state.beats.shift();
 
  recordRmssdSample(state, at);
 
  return beat;
}
 
/* ------------------------------------------------------------------ *
 * The maths
 * ------------------------------------------------------------------ */
 
/**
 * The good beats, in order, with the bad ones taken out — then the
 * differences between each neighbouring pair of what is left.
 *
 * For 925, 1200*, 400*, 895*, 965 this gives one difference: 965 - 925 = +40.
 */
function goodDifferences(beats: Beat[]): number[] {
  const good = beats.filter((b) => !b.bad).map((b) => b.rr);
  const diffs: number[] = [];
 
  for (let i = 1; i < good.length; i++) diffs.push(good[i] - good[i - 1]);
 
  return diffs;
}
 
function rootMeanSquare(values: number[]): number | null {
  if (values.length === 0) return null;
 
  const sumSquares = values.reduce((sum, v) => sum + v * v, 0);
 
  return Math.sqrt(sumSquares / values.length);
}
 
function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
 
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
 
  return Math.sqrt(variance);
}
 
/** Store the current RMSSD so the 60-second average has something to average. */
function recordRmssdSample(state: HrvState, at: number): void {
  const value = rootMeanSquare(goodDifferences(state.beats));
  if (value === null) return;
 
  state.rmssdSamples.push({ t: at, v: value });
 
  const cutoff = at - 300000;
  while (state.rmssdSamples.length > 0 && state.rmssdSamples[0].t < cutoff) {
    state.rmssdSamples.shift();
  }
}
 
/** Everything the screen needs, worked out from the current window. */
export function getSnapshot(
  state: HrvState,
  now: number = Date.now(),
  _cfg: HrvConfig = HRV_CONFIG,
): HrvSnapshot {
  const beats = state.beats;
  const good = beats.filter((b) => !b.bad);
  const diffs = goodDifferences(beats);
 
  const meanRr = good.length > 0 ? good.reduce((s, b) => s + b.rr, 0) / good.length : null;
  const over50 = diffs.filter((d) => Math.abs(d) > 50).length;
 
  const recent = state.rmssdSamples.filter((s) => s.t >= now - 300000);
  const avg = recent.length > 0 ? recent.reduce((s, x) => s + x.v, 0) / recent.length : null;
 
  const rmssd = rootMeanSquare(diffs);
 
  return {
    heartRate: meanRr !== null && meanRr > 0 ? Math.round(60000 / meanRr) : null,
    rmssd,
    sdnn: standardDeviation(good.map((b) => b.rr)),
    pnn50: diffs.length > 0 ? (over50 / diffs.length) * 100 : null,
    avgRmssd: avg,
 
    goodBeats: good.length,
    windowSize: beats.length,
    artifactRate: beats.length === 0 ? 0 : (beats.length - good.length) / beats.length,
 
    beatsSeen: state.beatsSeen,
    beatsFlagged: state.beatsFlagged,
 
    ready: rmssd !== null,
  };
}
 
export const EMPTY_SNAPSHOT: HrvSnapshot = {
  heartRate: null,
  rmssd: null,
  sdnn: null,
  pnn50: null,
  avgRmssd: null,
  goodBeats: 0,
  windowSize: 0,
  artifactRate: 0,
  beatsSeen: 0,
  beatsFlagged: 0,
  ready: false,
};
 
/* ------------------------------------------------------------------ *
 * Bluetooth parsing (unchanged — this part was never the problem)
 * ------------------------------------------------------------------ */
 
export type HeartRateMeasurement = {
  bpm: number;
  /** RR intervals in milliseconds, in the order transmitted. */
  rrIntervals: number[];
  sensorContact: 'supported-contact' | 'supported-no-contact' | 'unsupported';
};
 
/**
 * Parse a Bluetooth Heart Rate Measurement value.
 *
 * The Energy Expended flag (bit 3) inserts two bytes before the RR array.
 * Miss it and every interval after it is read from misaligned bytes.
 */
export function parseHeartRateMeasurement(view: DataView): HeartRateMeasurement {
  const flags = view.getUint8(0);
 
  const rateIs16Bit = (flags & 0x01) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRrIntervals = (flags & 0x10) !== 0;
 
  let offset = 1;
 
  const bpm = rateIs16Bit ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += rateIs16Bit ? 2 : 1;
 
  if (hasEnergyExpended) offset += 2;
 
  const rrIntervals: number[] = [];
 
  if (hasRrIntervals) {
    while (offset + 1 < view.byteLength) {
      // Sent in units of 1/1024 second.
      const raw = view.getUint16(offset, true);
      rrIntervals.push((raw * 1000) / 1024);
      offset += 2;
    }
  }
 
  return {
    bpm,
    rrIntervals,
    sensorContact: !contactSupported
      ? 'unsupported'
      : contactDetected
        ? 'supported-contact'
        : 'supported-no-contact',
  };
}
