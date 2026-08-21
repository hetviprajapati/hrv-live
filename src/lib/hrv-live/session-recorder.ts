/**
 * HRV.LIVE — session recorder
 * ---------------------------
 *
 * Captures everything that happened during a live session so it can be replayed
 * offline, beat for beat, against a different filter configuration.
 *
 * The point is to stop guessing. When a user says "it freezes up a bit" or "the
 * number looks stuck", that is a description of a symptom. This produces the
 * evidence: every raw Bluetooth packet, every decision the filter made, and the
 * exact numbers that were on screen at the time.
 *
 * Three layers are recorded, deliberately redundant:
 *
 *   packets  — the raw Bluetooth bytes, in hex, with arrival timestamps. This
 *              is the ground truth. Everything else can be rederived from it,
 *              including re-parsing with a corrected parser if a parsing bug is
 *              ever suspected again.
 *   beats    — each RR interval and what the filter decided about it, with the
 *              threshold that was in force at that moment.
 *   samples  — what the screen actually displayed after each beat, so a
 *              "frozen" reading can be traced to a cause rather than described.
 *
 * Privacy: this contains heart rate data and timestamps. Nothing else. No name,
 * no location, no account identifier. It stays on the user's machine until they
 * choose to send the file.
 */

import type { HrvEngineConfig, HrvSnapshot, BeatEvent } from './hrv-engine';

export const RECORDING_FORMAT = 'hrv.live/session-recording';
export const RECORDING_VERSION = 1;

export interface RecordedPacket {
  /** Milliseconds since session start. */
  t: number;
  /**
   * Raw characteristic bytes, space-separated hex. The ground truth.
   * For Verity Sense this may be a Polar PMD/PPI packet rather than the
   * standard Heart Rate Measurement characteristic.
   */
  hex: string;
  bpm: number;
  /** Parsed RR intervals, milliseconds. */
  rr: number[];
  contact: string;
  /** True when a transmission gap was detected before this packet. */
  gapBefore: boolean;
  /** Milliseconds since the previous packet. */
  sincePrev: number | null;
}

export interface RecordedBeat {
  t: number;
  raw: number;
  disposition: string;
  correction: string;
  emitted: number[];
  threshold: number;
  localMedian: number;
}

export interface RecordedSample {
  t: number;
  hr: number | null;
  rmssd: number | null;
  sdnn: number | null;
  pnn50: number | null;
  avg60: number | null;
  quality: string;
  artifactRate: number;
  validDiffs: number;
  windowSize: number;
}

export interface SessionRecording {
  format: typeof RECORDING_FORMAT;
  version: number;
  appVersion: string;
  mode: 'live' | 'demo';
  device: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  userAgent: string;
  engineConfig: Partial<HrvEngineConfig>;
  summary: {
    packets: number;
    beats: number;
    accepted: number;
    corrected: number;
    /** Flagged and awaiting a partner. Resolved by the following beat. */
    held: number;
    rejected: number;
    gaps: number;
    /** Longest run of identical raw values seen. Diagnoses a frozen sensor. */
    longestRepeatRun: number;
    /** Longest interval between packets. Diagnoses a stalling connection. */
    longestPacketGapMs: number;
    /** How long the display showed no value at all. */
    blankSamples: number;
  };
  packets: RecordedPacket[];
  beats: RecordedBeat[];
  samples: RecordedSample[];
}

/** Bound memory. An hour at ~1 beat/second is ~3600 entries, so this is roomy. */
const MAX_ENTRIES = 40000;

export class SessionRecorder {
  private startedAt = 0;
  private packets: RecordedPacket[] = [];
  private beats: RecordedBeat[] = [];
  private samples: RecordedSample[] = [];

  private lastPacketAt: number | null = null;
  private longestPacketGapMs = 0;

  private lastRaw: number | null = null;
  private repeatRun = 0;
  private longestRepeatRun = 0;

  private gaps = 0;
  private accepted = 0;
  private corrected = 0;
  private held = 0;
  private rejected = 0;
  private blankSamples = 0;

  private mode: 'live' | 'demo' = 'live';
  private device = '';

  start(mode: 'live' | 'demo', device: string, now: number): void {
    this.reset();
    this.startedAt = now;
    this.mode = mode;
    this.device = device;
  }

  reset(): void {
    this.startedAt = 0;
    this.packets = [];
    this.beats = [];
    this.samples = [];
    this.lastPacketAt = null;
    this.longestPacketGapMs = 0;
    this.lastRaw = null;
    this.repeatRun = 0;
    this.longestRepeatRun = 0;
    this.gaps = 0;
    this.accepted = 0;
    this.corrected = 0;
    this.held = 0;
    this.rejected = 0;
    this.blankSamples = 0;
  }

  get beatCount(): number {
    return this.beats.length;
  }

  get isEmpty(): boolean {
    return this.beats.length === 0;
  }

  addPacket(view: DataView, bpm: number, rr: number[], contact: string, gapBefore: boolean, now: number): void {
    if (this.packets.length >= MAX_ENTRIES) return;

    const bytes: string[] = [];
    for (let i = 0; i < view.byteLength; i++) {
      bytes.push(view.getUint8(i).toString(16).padStart(2, '0'));
    }

    const sincePrev = this.lastPacketAt === null ? null : now - this.lastPacketAt;
    if (sincePrev !== null && sincePrev > this.longestPacketGapMs) {
      this.longestPacketGapMs = sincePrev;
    }
    this.lastPacketAt = now;

    if (gapBefore) this.gaps += 1;

    this.packets.push({
      t: now - this.startedAt,
      hex: bytes.join(' '),
      bpm,
      rr: rr.map((value) => Math.round(value * 100) / 100),
      contact,
      gapBefore,
      sincePrev,
    });
  }

  addBeat(event: BeatEvent, now: number): void {
    if (this.beats.length >= MAX_ENTRIES) return;

    // Track repeated raw values independently of the engine, so the recording
    // can answer "is the strap freezing?" even if the rule is switched off.
    this.repeatRun = event.raw === this.lastRaw ? this.repeatRun + 1 : 1;
    this.lastRaw = event.raw;
    if (this.repeatRun > this.longestRepeatRun) this.longestRepeatRun = this.repeatRun;

    // A beat reported as rejected with no correction reason is not discarded —
    // it is being HELD for one beat to see whether its partner arrives. Calling
    // that "rejected" in the summary overstates how much data is being thrown
    // away, since most held beats are then reconstructed rather than dropped.
    const held = event.disposition === 'rejected' && event.correction === 'none';
    const disposition = held ? 'held' : event.disposition;

    if (disposition === 'accepted') this.accepted += 1;
    else if (disposition === 'corrected') this.corrected += 1;
    else if (disposition === 'held') this.held += 1;
    else this.rejected += 1;

    this.beats.push({
      t: now - this.startedAt,
      raw: Math.round(event.raw * 100) / 100,
      disposition,
      correction: event.correction,
      emitted: event.emitted.map((value) => Math.round(value * 100) / 100),
      threshold: Math.round(event.threshold * 10) / 10,
      localMedian: Number.isFinite(event.localMedian) ? Math.round(event.localMedian * 10) / 10 : 0,
    });
  }

  addSample(snapshot: HrvSnapshot, now: number): void {
    if (this.samples.length >= MAX_ENTRIES) return;

    if (snapshot.rmssd === null) this.blankSamples += 1;

    const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

    this.samples.push({
      t: now - this.startedAt,
      hr: snapshot.heartRate,
      rmssd: round(snapshot.rmssd),
      sdnn: round(snapshot.sdnn),
      pnn50: round(snapshot.pnn50),
      avg60: round(snapshot.avgRmssd60s),
      quality: snapshot.quality,
      artifactRate: Math.round(snapshot.artifactRate * 1000) / 1000,
      validDiffs: snapshot.validDiffs,
      windowSize: snapshot.windowSize,
    });
  }

  build(appVersion: string, engineConfig: Partial<HrvEngineConfig>, now: number): SessionRecording {
    return {
      format: RECORDING_FORMAT,
      version: RECORDING_VERSION,
      appVersion,
      mode: this.mode,
      device: this.device,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: now - this.startedAt,
      userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
      engineConfig,
      summary: {
        packets: this.packets.length,
        beats: this.beats.length,
        accepted: this.accepted,
        corrected: this.corrected,
        held: this.held,
        rejected: this.rejected,
        gaps: this.gaps,
        longestRepeatRun: this.longestRepeatRun,
        longestPacketGapMs: this.longestPacketGapMs,
        blankSamples: this.blankSamples,
      },
      packets: this.packets,
      beats: this.beats,
      samples: this.samples,
    };
  }
}

/**
 * How the recording actually left the app.
 *
 * There is no single save mechanism that works everywhere. On iPadOS the app
 * runs inside Bluefy (a WKWebView browser), because neither Safari nor Chrome
 * on iOS implements Web Bluetooth at all — so any user with a live feed on an
 * iPad is in a WKWebView, and in a WKWebView an `<a download>` pointing at a
 * blob URL does nothing whatsoever. No error, no file, no clue.
 */
export type SaveOutcome =
  | { method: 'share'; filename: string; bytes: number }
  | { method: 'download'; filename: string; bytes: number }
  | { method: 'clipboard'; filename: string; bytes: number }
  | { method: 'cancelled'; filename: string; bytes: number }
  | { method: 'failed'; filename: string; bytes: number; reason: string };

function recordingFilename(recording: SessionRecording): string {
  const stamp = recording.startedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

  return `hrv-session_${recording.mode}_${stamp}.json`;
}

/** Compact, not pretty-printed. Halves the size, and nobody reads it by eye. */
function recordingJson(recording: SessionRecording): string {
  return JSON.stringify(recording);
}

/**
 * Save the recording to wherever this device can put it.
 *
 * IMPORTANT: call this synchronously from the click handler. iOS only allows
 * the share sheet to open while a user gesture is still live, and any `await`
 * before `navigator.share()` forfeits that gesture.
 */
export async function saveRecording(recording: SessionRecording): Promise<SaveOutcome> {
  const filename = recordingFilename(recording);
  const json = recordingJson(recording);
  const bytes = json.length;
  const blob = new Blob([json], { type: 'application/json' });

  const nav = navigator as any;

  /* 1. Share sheet — the only thing that reliably works on iPad. */
  if (typeof File === 'function' && nav.share && nav.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/json' });

      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: filename });

        return { method: 'share', filename, bytes };
      }
    } catch (error) {
      // A user who taps Cancel has not hit a bug. Falling through to a silent
      // download here would be worse than stopping.
      if (error instanceof Error && error.name === 'AbortError') {
        return { method: 'cancelled', filename, bytes };
      }
    }
  }

  /* 2. Anchor download — desktop Chrome, Edge, Firefox, Android Chrome. */
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(url), 30000);

    return { method: 'download', filename, bytes };
  } catch (error) {
    // Fall through.
  }

  /* 3. Clipboard — last resort, but it always leaves the user with the data. */
  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(json);

      return { method: 'clipboard', filename, bytes };
    }
  } catch (error) {
    // Fall through.
  }

  return {
    method: 'failed',
    filename,
    bytes,
    reason: 'No save mechanism available in this browser',
  };
}

/** Copy the recording as text. Offered as an explicit escape hatch. */
export async function copyRecordingToClipboard(recording: SessionRecording): Promise<boolean> {
  try {
    await (navigator as any).clipboard.writeText(recordingJson(recording));

    return true;
  } catch {
    return false;
  }
}

/**
 * Legacy name, kept so existing call sites do not break.
 *
 * @deprecated Use `saveRecording`, which handles iPadOS.
 */
export function downloadRecording(recording: SessionRecording): string {
  void saveRecording(recording);

  return recordingFilename(recording);
}
