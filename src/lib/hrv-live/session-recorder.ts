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
 
import type { Beat, HrvConfig, HrvSnapshot } from './hrv-engine';
 
export const RECORDING_FORMAT = 'hrv.live/session-recording';
export const RECORDING_VERSION = 1;

export interface RecordedPacket {
  /** Milliseconds since session start. */
  t: number;
  /** Raw characteristic bytes, space-separated hex. The ground truth. */
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
  /** Exactly what the sensor reported. */
  rr: number;
  /** True = flagged by the rule, shown but not counted. */
  bad: boolean;
  reason: string;
}

export interface RecordedSample {
  t: number;
  hr: number | null;
  rmssd: number | null;
  sdnn: number | null;
  pnn50: number | null;
  avg60: number | null;
  artifactRate: number;
  goodBeats: number;
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
  engineConfig: Partial<HrvConfig>;
  summary: {
    packets: number;
    beats: number;
    /** Beats that counted toward the score. */
    counted: number;
    /** Beats flagged by the rule. */
    flagged: number;
    /** Breakdown of why beats were excluded. */
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
  private counted = 0;
  private flagged = 0;
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
    this.counted = 0;
    this.flagged = 0;
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
 
  addBeat(beat: Beat, now: number): void {
    if (this.beats.length >= MAX_ENTRIES) return;
 
    // Track repeated raw values independently, so the recording can still
    // answer "is the sensor freezing?" even though the rule no longer looks
    // for that.
    this.repeatRun = beat.rr === this.lastRaw ? this.repeatRun + 1 : 1;
    this.lastRaw = beat.rr;
    if (this.repeatRun > this.longestRepeatRun) this.longestRepeatRun = this.repeatRun;
 
    if (beat.bad) this.flagged += 1;
    else this.counted += 1;
 
    this.beats.push({
      t: now - this.startedAt,
      rr: Math.round(beat.rr * 100) / 100,
      bad: beat.bad,
      reason: beat.reason,
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
      avg60: round(snapshot.avgRmssd),
      artifactRate: Math.round(snapshot.artifactRate * 1000) / 1000,
      goodBeats: snapshot.goodBeats,
      windowSize: snapshot.windowSize,
    });
  }
 
  build(appVersion: string, engineConfig: Partial<HrvConfig>, now: number): SessionRecording {
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
        counted: this.counted,
        flagged: this.flagged,
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
 *
 * So we try the mechanisms in order of how well they work on the device we are
 * actually on, and report back which one succeeded so the UI can tell the user
 * where to look for the file.
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
 * before `navigator.share()` forfeits that gesture. Everything up to the share
 * call here is synchronous for that reason.
 */
export async function saveRecording(recording: SessionRecording): Promise<SaveOutcome> {
  const filename = recordingFilename(recording);
  const json = recordingJson(recording);
  const bytes = json.length;
  const blob = new Blob([json], { type: 'application/json' });

  const nav = navigator as any;
 
  /* 1. Share sheet — the only thing that reliably works on iPad.
   *
   * Opens the native share sheet, from which the user can Save to Files, mail
   * it, AirDrop it, or send it through any messaging app. Requires iOS 15+ and
   * a live user gesture.
   */
  if (typeof File === 'function' && nav.share && nav.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/json' });

      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: filename });

        return { method: 'share', filename, bytes };
      }
    } catch (error) {
      // A user who taps Cancel on the share sheet has not hit a bug. Falling
      // through to a silent download here would be worse than stopping.
      if (error instanceof Error && error.name === 'AbortError') {
        return { method: 'cancelled', filename, bytes };
      }
      // Anything else: fall through and try the next mechanism.
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
