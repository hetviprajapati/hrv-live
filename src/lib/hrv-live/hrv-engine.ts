/**
 * HRV.LIVE — RR interval artifact rejection + metrics engine
 * ---------------------------------------------------------
 *
 * Pure, framework-free. No React, no DOM, no timers. Everything here is
 * deterministic given the same input sequence, which is what makes it testable
 * against recorded device logs (see scripts/replay-hrv.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * A chest strap does not measure heart rate variability. It measures the time
 * between R-wave *detections*. When a detection slips — motion, a dry contact,
 * a T-wave mistaken for an R-wave — the recorded interval is wrong even though
 * the heartbeat itself was perfectly normal.
 *
 * RMSSD squares every successive difference, so a single slipped detection can
 * dominate the entire calculation. In a 40-beat window it stays there for the
 * next 40 beats. That is the whole bug: the formula was right, the Bluetooth
 * parsing was right, but nothing stood between the sensor and the arithmetic.
 *
 * THE KEY OBSERVATION
 * -------------------
 * In the recorded Polar H10 logs, artifacts arrive as PAIRS whose SUM IS
 * CONSERVED:
 *
 *     726, 965   -> sum 1691, half 845.5   (neighbours 836, 813)
 *     685, 1052  -> sum 1737, half 868.5   (neighbours 880, 870)
 *     625, 1022  -> sum 1647, half 823.5   (neighbours 870, 834)
 *     1200, 500  -> sum 1700, half 850     (neighbours 799, 795)
 *
 * That is the signature of a MISPLACED beat, not a missed or extra one. The
 * heartbeat happened; only its timestamp slipped. Total elapsed time is
 * preserved, which is exactly why the displayed heart rate looks clean while
 * the intervals look insane.
 *
 * This matters because it means the true value is RECOVERABLE. We do not have
 * to throw the beat away and punch a hole in the series — we can put it back
 * where it belongs.
 *
 * WHY NOT A SIMPLE "REJECT ANYTHING OVER 20%" RULE
 * ------------------------------------------------
 * Run that rule against the real data above. 726 against a previous beat of
 * 836 is a 13.2% deviation — it passes. Only the 965 gets caught. You are left
 * with 836, 726, 813, which injects two fabricated differences where the truth
 * is a difference of roughly zero. The number drops enough to look plausible
 * and stays wrong.
 *
 * Worse, a fixed percentage gate punishes exactly the users the product is for.
 * A relaxed person with genuinely high HRV shows beat-to-beat swings well past
 * 20% from normal respiratory sinus arrhythmia. A blunt filter would shave off
 * the real signal and systematically under-report calm states.
 *
 * So the threshold adapts to the person, following the published approach:
 * a robust (quartile-deviation) estimate of the subject's own beat-to-beat
 * spread, scaled by 5.2.
 *
 * REFERENCES
 * ----------
 * - Lipponen & Tarvainen (2019), "A robust algorithm for heart rate
 *   variability time series artefact correction using novel beat
 *   classification", J Med Eng Technol 43(3):173-181.
 *   https://pubmed.ncbi.nlm.nih.gov/31314618/
 * - Kubios HRV preprocessing documentation (threshold levels, missed/extra
 *   beat correction). https://www.kubios.com/blog/preprocessing-of-hrv-data/
 * - Task Force of the ESC and NASPE (1996), Heart rate variability: standards
 *   of measurement, physiological interpretation, and clinical use.
 */

/* ------------------------------------------------------------------ *
 * Robust statistics
 * ------------------------------------------------------------------ */

/** Median. Robust to the artifacts we are trying to find, unlike the mean. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolated quantile of an already-sorted array. */
function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];

  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);

  if (lo === hi) return sorted[lo];

  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Quartile deviation, (Q3 - Q1) / 2.
 *
 * This is the spread estimator Lipponen & Tarvainen use. Unlike a standard
 * deviation it is not inflated by the very outliers we are trying to detect,
 * so the threshold does not quietly widen to let artifacts through.
 */
export function quartileDeviation(values: readonly number[]): number {
  if (values.length < 4) return NaN;

  const sorted = [...values].sort((a, b) => a - b);

  return (quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25)) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type BeatDisposition =
  | 'accepted' // measured value, used as-is
  | 'corrected' // value reconstructed from a detected artifact
  | 'rejected'; // unusable, removed from the series

export type CorrectionKind =
  | 'none'
  | 'misplaced-pair' // long/short (or short/long) pair, sum conserved
  | 'missed-beat' // one interval spanning two real beats
  | 'extra-beat' // two intervals that are really one beat
  | 'out-of-range' // outside physiological limits
  | 'sensor-stuck' // identical value repeated — the strap stopped updating
  | 'unrepairable'; // flagged, no coherent reconstruction available

export type SignalQuality = 'acquiring' | 'excellent' | 'good' | 'fair' | 'poor';

/** One beat as it exists after cleaning, ready for metric calculation. */
export interface CleanBeat {
  /**
   * Interval in milliseconds, after any correction.
   *
   * The engine intentionally treats ECG RR and optical PPI the same here:
   * both are successive cardiac pulse intervals in milliseconds. Device-specific
   * parsing/quality checks happen before values reach this engine.
   */
  rr: number;
  disposition: 'accepted' | 'corrected';
  correction: CorrectionKind;
  /**
   * True when the difference between this beat and the previous one must NOT
   * be counted as a successive difference.
   *
   * This is the part that is easy to get wrong. RMSSD is built on *successive*
   * differences. If you delete a bad beat and let its two neighbours sit next
   * to each other, you have manufactured a difference across a gap that never
   * existed — reintroducing the bug you were trying to fix, just smaller.
   *
   * We set it in two situations:
   *   1. A beat was dropped, or a transmission gap was detected. The chain of
   *      succession is genuinely broken.
   *   2. Between the two halves of a reconstructed pair. Those halves are equal
   *      by construction, so their difference is exactly zero — a number we
   *      invented. Counting it would deflate RMSSD with fake stillness.
   *
   * The rule: never invent variability, and never invent calm either.
   */
  breakBefore: boolean;
}

/** What happened to one raw interval that came off the sensor. */
export interface BeatEvent {
  raw: number;
  disposition: BeatDisposition;
  correction: CorrectionKind;
  /** Values emitted into the clean series as a result (0, 1 or 2). */
  emitted: number[];
  /** Threshold that was in force when this beat was judged, for diagnostics. */
  threshold: number;
  localMedian: number;
  /**
   * What became of a beat that was held back on a previous call.
   *
   * A flagged beat waits one beat to see whether its partner arrives. If it is
   * resolved as part of a pair, this call's own `correction` says so. If it was
   * instead reconstructed alone or discarded, it is reported here — otherwise a
   * held beat would sit in the UI forever with no verdict.
   */
  pendingResolution?: PendingResolution;
}

export interface PendingResolution {
  raw: number;
  disposition: 'corrected' | 'rejected';
  correction: CorrectionKind;
  emitted: number[];
}

export interface HrvSnapshot {
  /** Heart rate derived from the cleaned intervals. */
  heartRate: number | null;
  rmssd: number | null;
  sdnn: number | null;
  pnn50: number | null;
  /** True rolling 60-second mean of RMSSD, not an average of averages. */
  avgRmssd60s: number | null;
  meanRr: number | null;

  quality: SignalQuality;
  /** Fraction of recent beats that needed correction or removal, 0..1. */
  artifactRate: number;

  beatsSeen: number;
  beatsClean: number;
  beatsCorrected: number;
  beatsRejected: number;

  /** Successive differences currently contributing to RMSSD. */
  validDiffs: number;
  windowSize: number;
  /** True when there is enough clean data to show a number honestly. */
  ready: boolean;
  cleanWindowSize: number;
}

export interface HrvEngineConfig {
  /** Beats retained for the rolling metric window. */
  windowBeats: number;
  /** Minimum valid successive differences before any value is published. */
  minDiffsToPublish: number;

  /** Hard physiological bounds. 300ms = 200bpm, 2000ms = 30bpm. */
  minRrMs: number;
  maxRrMs: number;

  /**
   * How many identical consecutive raw values before the sensor is treated as
   * stuck. Set to 0 to disable.
   *
   * A Polar H10 reports intervals in units of 1/1024 s, so two consecutive
   * beats landing on the exact same value is uncommon but real; three in a row
   * is not physiology, it is a strap that has stopped updating and is repeating
   * its last reading.
   *
   * The first two of a run are kept. The third and everything after it is
   * discarded with a chain break.
   *
   * A caveat worth knowing: discarding repeats removes zero-differences, which
   * are the SMALLEST possible contributions to RMSSD, so an over-eager setting
   * here biases the reading UPWARD. That is the opposite of the artifact
   * problem and just as dishonest. Three is deliberately conservative, and
   * every discarded repeat also counts toward the artifact rate, so a genuinely
   * frozen sensor degrades signal quality and suppresses the number rather than
   * quietly inflating it.
   */
  stuckRepeatLimit: number;

  /** Beats accepted unconditionally at session start, before stats exist. */
  warmupBeats: number;
  /** Beats used for the local level estimate. Short, so it tracks HR drift. */
  levelWindow: number;
  /** Successive differences used for the adaptive spread estimate. */
  spreadWindow: number;

  /** Lipponen & Tarvainen scaling factor on the quartile deviation. */
  thresholdScale: number;
  /** Floor/ceiling on the beat-to-beat threshold, milliseconds. */
  minDiffThresholdMs: number;
  maxDiffThresholdMs: number;
  /** Floor/ceiling on the deviation-from-local-level threshold. */
  minLevelThresholdMs: number;
  maxLevelThresholdMs: number;

  /** Tolerance bounds for the conserved-sum test on candidate pairs. */
  pairToleranceScale: number;
  minPairToleranceMs: number;
  maxPairToleranceMs: number;

  /**
   * Cold-start fallbacks, as a fraction of the local interval level, used only
   * until enough successive differences exist to estimate the subject's own
   * spread. This is the one place a percentage rule is the right tool: with
   * three beats of history there is nothing to adapt to yet.
   */
  warmupDiffFraction: number;
  warmupLevelFraction: number;

  /** Beats over which the artifact rate (and therefore quality) is measured. */
  qualityWindow: number;
  /** Artifact rate above which readings are suppressed entirely. */
  poorQualityRate: number;
  fairQualityRate: number;
  goodQualityRate: number;
}

export const DEFAULT_CONFIG: HrvEngineConfig = {
  windowBeats: 18,
  minDiffsToPublish: 17,

  minRrMs: 300,
  maxRrMs: 2000,

  stuckRepeatLimit: 5,

  // Short, because an artifact inside the warm-up window poisons the baseline
  // that everything afterwards is judged against. Three beats is the minimum
  // that gives a median at all.
  warmupBeats: 3,
  levelWindow: 5,
  spreadWindow: 40,

  thresholdScale: 5.2,
  minDiffThresholdMs: 50,
  maxDiffThresholdMs: 250,
  minLevelThresholdMs: 100,
  maxLevelThresholdMs: 350,

  pairToleranceScale: 1.5,
  minPairToleranceMs: 60,
  maxPairToleranceMs: 300,

  warmupDiffFraction: 0.2,
  warmupLevelFraction: 0.3,

  qualityWindow: 60,
  poorQualityRate: 0.15,
  fairQualityRate: 0.05,
  goodQualityRate: 0.02,
};

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export class HrvEngine {
  private readonly cfg: HrvEngineConfig;

  /** Rolling metric window of cleaned beats. */
  private window: CleanBeat[] = [];
  /** Recent clean RR values, for the local level estimate. */
  private levels: number[] = [];
  /** Recent valid successive differences, for the adaptive spread estimate. */
  private diffs: number[] = [];

  /** A flagged beat held back one beat, waiting to see its partner. */
  private pending: number | null = null;
  /** Verdict on the previously held beat, surfaced with the current one. */
  private pendingResolution: PendingResolution | undefined;
  /** Set when succession is broken; applied to the next emitted beat. */
  private breakNext = false;

  private lastCleanRr: number | null = null;

  /** Last raw value off the sensor, and how many times it has repeated. */
  private lastRawRr: number | null = null;
  private rawRepeatRun = 0;

  /**
   * Beats still to be accepted unconditionally while a baseline is
   * established. Non-zero at session start and again after any gap.
   */
  private warmupRemaining: number;

  /** Rolling record of whether each recent raw beat was an artifact. */
  private recentArtifacts: boolean[] = [];
  /** Timestamped RMSSD samples, for the true 60-second mean. */
  private rmssdSeries: { t: number; v: number }[] = [];

  private beatsSeen = 0;
  private beatsClean = 0;
  private beatsCorrected = 0;
  private beatsRejected = 0;

  constructor(config: Partial<HrvEngineConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.warmupRemaining = this.cfg.warmupBeats;
  }

  /* -------------------------------------------------------------- *
   * Public API
   * -------------------------------------------------------------- */

  /**
   * Wipe all state.
   *
   * Must be called on connect as well as on disconnect. A stale buffer from a
   * previous session — or from demo mode — creates one enormous fabricated
   * difference at the seam where the old data meets the new.
   */
  reset(): void {
    this.window = [];
    this.levels = [];
    this.diffs = [];
    this.pending = null;
    this.breakNext = false;
    this.lastCleanRr = null;
    this.lastRawRr = null;
    this.rawRepeatRun = 0;
    this.recentArtifacts = [];
    this.rmssdSeries = [];
    this.beatsSeen = 0;
    this.beatsClean = 0;
    this.beatsCorrected = 0;
    this.beatsRejected = 0;
    this.warmupRemaining = this.cfg.warmupBeats;
    this.pendingResolution = undefined;
  }

  /**
   * Declare a break in the data stream — a dropped Bluetooth packet, a
   * reconnection, a pause.
   *
   * Without this, the interval before the gap and the interval after it get
   * treated as successive when they may be seconds apart. The recorded logs
   * show real five-second holes, so this is not hypothetical.
   *
   * The interval level is also discarded, because heart rate on the far side
   * of a gap is genuinely unknown — in the recorded session it stepped from
   * ~745ms to ~805ms across one five-second hole. Holding on to the old
   * baseline would make the filter reject every good beat that follows until
   * it caught up. The subject's variability estimate is kept: their nervous
   * system did not change, only our knowledge of where the rate is now.
   */
  markGap(): PendingResolution | undefined {
    this.pendingResolution = undefined;
    this.discardPending();
    this.breakNext = true;
    this.levels = [];
    this.warmupRemaining = this.cfg.warmupBeats;
    this.lastRawRr = null;
    this.rawRepeatRun = 0;

    return this.pendingResolution;
  }

  /**
   * Feed one raw RR interval, in milliseconds, straight from the sensor.
   *
   * Returns what happened to it. Note that because a flagged beat is held for
   * one beat to see whether a partner arrives, the beat described in the
   * return value may not be the beat you just passed in.
   */
  push(rawRr: number, now: number = Date.now()): BeatEvent {
    this.beatsSeen += 1;
    this.pendingResolution = undefined;

    const localMedian = this.localLevel();
    const threshold = this.diffThreshold();

    // Stage 1 — hard physiological bounds.
    // Nothing outside these is a heartbeat, whatever else is going on.
    if (!Number.isFinite(rawRr) || rawRr < this.cfg.minRrMs || rawRr > this.cfg.maxRrMs) {
      this.discardPending();
      this.recordArtifact();
      this.beatsRejected += 1;
      this.breakNext = true;

      return {
        raw: rawRr,
        disposition: 'rejected',
        correction: 'out-of-range',
        emitted: [],
        threshold,
        localMedian,
        pendingResolution: this.pendingResolution,
      };
    }

    // Stage 1b — a sensor that has stopped updating.
    // Tracked on the RAW value, because a frozen strap repeats what it last
    // transmitted, whatever the filter did with it downstream.
    this.rawRepeatRun = rawRr === this.lastRawRr ? this.rawRepeatRun + 1 : 1;
    this.lastRawRr = rawRr;

    if (this.cfg.stuckRepeatLimit > 0 && this.rawRepeatRun >= this.cfg.stuckRepeatLimit) {
      this.discardPending();
      this.recordArtifact();
      this.beatsRejected += 1;
      this.breakNext = true;

      return {
        raw: rawRr,
        disposition: 'rejected',
        correction: 'sensor-stuck',
        emitted: [],
        threshold,
        localMedian,
        pendingResolution: this.pendingResolution,
      };
    }

    // Warm-up. With no baseline there is nothing to compare against, so accept
    // and stay quiet — nothing is published during warm-up anyway.
    if (this.warmupRemaining > 0) {
      this.warmupRemaining -= 1;
      this.discardPending();
      this.emit(rawRr, 'accepted', 'none', false);
      this.recordClean();
      this.sampleRmssd(now);

      return {
        raw: rawRr,
        disposition: 'accepted',
        correction: 'none',
        emitted: [rawRr],
        threshold,
        localMedian,
        pendingResolution: this.pendingResolution,
      };
    }

    // Stage 2/3 — a beat is already held back. Try to resolve the pair first.
    if (this.pending !== null) {
      const repaired = this.tryPairRepair(rawRr, now);
      if (repaired) return repaired;

      // No coherent pair. The held beat may still be a missed beat on its own,
      // otherwise it goes.
      this.resolveLonePending(now);
    }

    // Stage 3 — judge this beat against the subject's own recent behaviour.
    const level = this.localLevel();
    const diffTh = this.diffThreshold();
    const levelTh = this.levelThreshold();
    const prev = this.lastCleanRr;

    const jumps = prev !== null && Math.abs(rawRr - prev) > diffTh;
    const offLevel = Math.abs(rawRr - level) > levelTh;

    if (jumps || offLevel) {
      // Hold it. If the next beat completes a conserved-sum pair we can
      // reconstruct both; if not, we drop it then. One beat of latency buys a
      // correction instead of a hole.
      this.pending = rawRr;

      return {
        raw: rawRr,
        disposition: 'rejected',
        correction: 'none',
        emitted: [],
        threshold: diffTh,
        localMedian: level,
        pendingResolution: this.pendingResolution,
      };
    }

    this.emit(rawRr, 'accepted', 'none', false);
    this.recordClean();
    this.sampleRmssd(now);

    return {
      raw: rawRr,
      disposition: 'accepted',
      correction: 'none',
      emitted: [rawRr],
      threshold: diffTh,
      localMedian: level,
      pendingResolution: this.pendingResolution,
    };
  }

  /** Current metrics. Cheap enough to call on every beat. */
  snapshot(now: number = Date.now()): HrvSnapshot {
    const rmssd = this.computeRmssd();
    const validDiffs = this.countValidDiffs();
    const artifactRate = this.artifactRate();

    const enoughData = validDiffs >= this.cfg.minDiffsToPublish;
    const quality = this.quality(enoughData, artifactRate);

    // When the signal is this dirty, the honest answer is "I can't tell you".
    // A wrong number is worse than no number — a user who sees 150 once does
    // not come back.
    const publish = enoughData && quality !== 'poor';

    const meanRr = this.window.length > 0 ? this.window.reduce((s, b) => s + b.rr, 0) / this.window.length : null;

    const cleanWindowSize = this.window.filter((beat) => beat.disposition === 'accepted').length;

    return {
      heartRate: meanRr !== null && meanRr > 0 ? Math.round(60000 / meanRr) : null,
      rmssd: publish ? rmssd : null,
      sdnn: publish ? this.computeSdnn() : null,
      pnn50: publish ? this.computePnn50() : null,
      avgRmssd60s: publish ? this.computeAvgRmssd(now) : null,
      meanRr: publish ? meanRr : null,

      quality,
      artifactRate,

      beatsSeen: this.beatsSeen,
      beatsClean: this.beatsClean,
      beatsCorrected: this.beatsCorrected,
      beatsRejected: this.beatsRejected,

      validDiffs,
      windowSize: this.window.length,
      cleanWindowSize,
      ready: publish,
    };
  }

  /** The cleaned window, for charting or export. */
  cleanedWindow(): readonly CleanBeat[] {
    return this.window;
  }

  /* -------------------------------------------------------------- *
   * Artifact resolution
   * -------------------------------------------------------------- */

  /**
   * Try to explain the held beat and the incoming beat together.
   *
   * Three coherent explanations, in the order they occur in practice:
   *
   *   A. Misplaced beat — one R-wave detected early or late. The interval
   *      before it is short and the one after is long (or vice versa) and the
   *      two SUM to two normal beats. This is what the H10 logs actually show.
   *      Fix: split the sum in half. Elapsed time is preserved, so the halves
   *      are the true intervals.
   *
   *   B. Extra beat — a spurious detection between two real beats, splitting
   *      one interval into two shorts that sum to ONE normal beat.
   *      Fix: merge them back into one interval.
   */
  private tryPairRepair(rawRr: number, now: number): BeatEvent | null {
    const held = this.pending;
    if (held === null) return null;

    const level = this.localLevel();
    const diffTh = this.diffThreshold();
    const levelTh = this.levelThreshold();
    const tolerance = this.pairTolerance();

    const prev = this.lastCleanRr;
    const incomingDeviates = (prev !== null && Math.abs(rawRr - prev) > diffTh) || Math.abs(rawRr - level) > levelTh;

    if (!incomingDeviates) return null;

    const sum = held + rawRr;

    // A. Misplaced beat: the pair spans two real beats.
    if (Math.abs(sum - 2 * level) <= tolerance) {
      const half = sum / 2;

      this.pending = null;
      this.emit(half, 'corrected', 'misplaced-pair', false);
      // The two halves are identical by construction. Their difference is a
      // number we made up, so it must not enter RMSSD.
      this.emit(half, 'corrected', 'misplaced-pair', true);

      this.recordArtifact();
      this.recordArtifact();
      this.beatsCorrected += 2;
      this.sampleRmssd(now);

      return {
        raw: rawRr,
        disposition: 'corrected',
        correction: 'misplaced-pair',
        emitted: [half, half],
        threshold: diffTh,
        localMedian: level,
        pendingResolution: this.pendingResolution,
      };
    }

    // B. Extra beat: the pair is really a single interval.
    if (Math.abs(sum - level) <= tolerance) {
      this.pending = null;
      this.emit(sum, 'corrected', 'extra-beat', false);

      this.recordArtifact();
      this.recordArtifact();
      this.beatsCorrected += 2;
      this.sampleRmssd(now);

      return {
        raw: rawRr,
        disposition: 'corrected',
        correction: 'extra-beat',
        emitted: [sum],
        threshold: diffTh,
        localMedian: level,
        pendingResolution: this.pendingResolution,
      };
    }

    return null;
  }

  /**
   * The held beat has no partner.
   *
   * C. Missed beat — a detection was skipped entirely, so one recorded
   *    interval spans two real beats and measures about double.
   *    Fix: insert the missing beat by splitting it in half.
   *
   * Otherwise it is noise with no coherent reconstruction. Drop it and break
   * the chain, which is the only honest option left.
   */
  private resolveLonePending(now: number): void {
    const held = this.pending;
    if (held === null) return;

    const level = this.localLevel();
    const tolerance = this.pairTolerance();

    if (Math.abs(held - 2 * level) <= tolerance) {
      const half = held / 2;

      this.pending = null;
      this.emit(half, 'corrected', 'missed-beat', false);
      this.emit(half, 'corrected', 'missed-beat', true);

      this.recordArtifact();
      this.beatsCorrected += 1;
      this.sampleRmssd(now);

      this.pendingResolution = {
        raw: held,
        disposition: 'corrected',
        correction: 'missed-beat',
        emitted: [half, half],
      };

      return;
    }

    this.discardPending();
  }

  private discardPending(): void {
    if (this.pending === null) return;

    this.pendingResolution = {
      raw: this.pending,
      disposition: 'rejected',
      correction: 'unrepairable',
      emitted: [],
    };

    this.pending = null;
    this.recordArtifact();
    this.beatsRejected += 1;
    this.breakNext = true;
  }

  /* -------------------------------------------------------------- *
   * Adaptive thresholds
   * -------------------------------------------------------------- */

  /**
   * Local interval level — a short median, so it follows genuine heart rate
   * drift instead of fighting it. In the recorded logs the rate climbs from
   * ~740ms to ~840ms within twenty seconds; a long window would lag behind and
   * start flagging perfectly good beats.
   */
  private localLevel(): number {
    if (this.levels.length === 0) return NaN;

    return median(this.levels.slice(-this.cfg.levelWindow));
  }

  /**
   * Beat-to-beat threshold, adapted to this subject's own variability.
   *
   * Derived from the spread of recent successive differences rather than from
   * the intervals themselves, so a drifting heart rate does not inflate it.
   * This is the mechanism that lets a genuinely high-HRV user keep their real
   * variability while a low-HRV user still gets protected.
   */
  private diffThreshold(): number {
    const qd = this.diffs.length >= 4 ? quartileDeviation(this.diffs.slice(-this.cfg.spreadWindow)) : NaN;

    if (!Number.isFinite(qd)) {
      const level = this.localLevel();
      const fallback = Number.isFinite(level) ? this.cfg.warmupDiffFraction * level : this.cfg.maxDiffThresholdMs;

      return clamp(fallback, this.cfg.minDiffThresholdMs, this.cfg.maxDiffThresholdMs);
    }

    return clamp(this.cfg.thresholdScale * qd, this.cfg.minDiffThresholdMs, this.cfg.maxDiffThresholdMs);
  }

  /**
   * Deviation-from-level threshold. A wider safety net that catches intervals
   * which drift to an implausible level without a single dramatic jump.
   */
  private levelThreshold(): number {
    const qd = this.levels.length >= 4 ? quartileDeviation(this.levels.slice(-this.cfg.spreadWindow)) : NaN;

    if (!Number.isFinite(qd)) {
      const level = this.localLevel();
      const fallback = Number.isFinite(level) ? this.cfg.warmupLevelFraction * level : this.cfg.maxLevelThresholdMs;

      return clamp(fallback, this.cfg.minLevelThresholdMs, this.cfg.maxLevelThresholdMs);
    }

    return clamp(this.cfg.thresholdScale * qd, this.cfg.minLevelThresholdMs, this.cfg.maxLevelThresholdMs);
  }

  /**
   * How closely a candidate pair's sum must match the expected total.
   *
   * Two real consecutive beats do not sum to exactly twice the median — they
   * carry their own natural variation, and the median itself lags during drift.
   * Too tight and genuine artifacts go unrepaired; too loose and any two odd
   * beats get averaged together, smoothing away real events.
   */
  private pairTolerance(): number {
    // Scaled off the interval-level spread rather than the beat-to-beat
    // threshold, because what has to match here is a SUM of two intervals.
    // A high-variability subject's pair sums legitimately scatter more, and a
    // fixed tolerance would leave their artifacts unrepaired.
    return clamp(
      this.cfg.pairToleranceScale * this.levelThreshold(),
      this.cfg.minPairToleranceMs,
      this.cfg.maxPairToleranceMs,
    );
  }

  /* -------------------------------------------------------------- *
   * Bookkeeping
   * -------------------------------------------------------------- */

  private emit(rr: number, disposition: 'accepted' | 'corrected', correction: CorrectionKind, forceBreak: boolean): void {
    const breakBefore = this.breakNext || forceBreak;
    this.breakNext = false;

    this.window.push({ rr, disposition, correction, breakBefore });
    if (this.window.length > this.cfg.windowBeats) this.window.shift();

    this.levels.push(rr);
    if (this.levels.length > this.cfg.spreadWindow) this.levels.shift();

    // Only genuine, unbroken successions inform the threshold. Feeding the
    // fabricated zero from a reconstructed pair back into the spread estimate
    // would make the filter progressively more aggressive over time.
    if (this.lastCleanRr !== null && !breakBefore && disposition === 'accepted') {
      this.diffs.push(rr - this.lastCleanRr);
      if (this.diffs.length > this.cfg.spreadWindow) this.diffs.shift();
    }

    this.lastCleanRr = rr;
  }

  private recordClean(): void {
    this.beatsClean += 1;
    this.pushQuality(false);
  }

  private recordArtifact(): void {
    this.pushQuality(true);
  }

  private pushQuality(isArtifact: boolean): void {
    this.recentArtifacts.push(isArtifact);
    if (this.recentArtifacts.length > this.cfg.qualityWindow) this.recentArtifacts.shift();
  }

  private sampleRmssd(now: number): void {
    const value = this.computeRmssd();
    if (value === null) return;

    this.rmssdSeries.push({ t: now, v: value });

    // Keep a little more than a minute so the window is always fully covered.
    const cutoff = now - 75000;
    while (this.rmssdSeries.length > 0 && this.rmssdSeries[0].t < cutoff) {
      this.rmssdSeries.shift();
    }
  }

  /* -------------------------------------------------------------- *
   * Metrics
   * -------------------------------------------------------------- */

  private countValidDiffs(): number {
    let n = 0;

    for (let i = 1; i < this.window.length; i++) {
      if (!this.window[i].breakBefore) n += 1;
    }

    return n;
  }

  /**
   * RMSSD over valid successive differences only.
   *
   * Note the divisor: the count of differences actually used, not
   * `window.length - 1`. Once beats can be removed those two numbers diverge,
   * and using the wrong one quietly biases every reading.
   */
  private computeRmssd(): number | null {
    let sumSq = 0;
    let n = 0;

    for (let i = 1; i < this.window.length; i++) {
      if (this.window[i].breakBefore) continue;

      const d = this.window[i].rr - this.window[i - 1].rr;
      sumSq += d * d;
      n += 1;
    }

    if (n < this.cfg.minDiffsToPublish) return null;

    return Math.sqrt(sumSq / n);
  }

  /** SDNN — the actual standard deviation of the cleaned intervals. */
  private computeSdnn(): number | null {
    const values = this.window.map((b) => b.rr);
    if (values.length < this.cfg.minDiffsToPublish) return null;

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);

    return Math.sqrt(variance);
  }

  /** pNN50 — proportion of valid successive differences exceeding 50ms. */
  private computePnn50(): number | null {
    let over = 0;
    let n = 0;

    for (let i = 1; i < this.window.length; i++) {
      if (this.window[i].breakBefore) continue;

      if (Math.abs(this.window[i].rr - this.window[i - 1].rr) > 50) over += 1;
      n += 1;
    }

    if (n < this.cfg.minDiffsToPublish) return null;

    return (over / n) * 100;
  }

  /** Mean RMSSD over a true rolling 60 seconds of wall-clock time. */
  private computeAvgRmssd(now: number): number | null {
    const cutoff = now - 60000;
    const inWindow = this.rmssdSeries.filter((s) => s.t >= cutoff);

    if (inWindow.length === 0) return null;

    return inWindow.reduce((s, x) => s + x.v, 0) / inWindow.length;
  }

  private artifactRate(): number {
    if (this.recentArtifacts.length === 0) return 0;

    const bad = this.recentArtifacts.reduce((n, x) => n + (x ? 1 : 0), 0);

    return bad / this.recentArtifacts.length;
  }

  private quality(enoughData: boolean, rate: number): SignalQuality {
    if (!enoughData) return 'acquiring';
    if (rate > this.cfg.poorQualityRate) return 'poor';
    if (rate > this.cfg.fairQualityRate) return 'fair';
    if (rate > this.cfg.goodQualityRate) return 'good';

    return 'excellent';
  }
}

/* ------------------------------------------------------------------ *
 * Bluetooth parsing
 * ------------------------------------------------------------------ */

export interface HeartRateMeasurement {
  bpm: number;
  /** RR intervals in milliseconds, in the order transmitted. */
  rrIntervals: number[];
  sensorContact: 'supported-contact' | 'supported-no-contact' | 'unsupported';
}

/**
 * Parse a Bluetooth Heart Rate Measurement characteristic value.
 *
 * The bug this replaces: the previous version computed the RR offset from the
 * 16-bit flag alone and ignored the Energy Expended flag (bit 3). When that bit
 * is set the packet carries two extra bytes before the RR array, so every
 * interval after it is read from misaligned bytes — producing genuinely random
 * values that no downstream filter could ever repair. Rare on an H10, fatal
 * when it happens.
 *
 * Layout (Bluetooth SIG, org.bluetooth.characteristic.heart_rate_measurement):
 *   byte 0        flags
 *     bit 0       0 = uint8 heart rate, 1 = uint16
 *     bits 1-2    sensor contact status
 *     bit 3       energy expended present (uint16)
 *     bit 4       RR intervals present (uint16 array, units of 1/1024 s)
 *   byte 1..      heart rate
 *   then          energy expended, if present
 *   then          RR intervals, if present
 */
export function parseHeartRateMeasurement(view: DataView): HeartRateMeasurement {
  const flags = view.getUint8(0);

  const rateIs16Bit = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRrIntervals = (flags & 0x10) !== 0;

  let offset = 1;

  const bpm = rateIs16Bit ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += rateIs16Bit ? 2 : 1;

  if (hasEnergyExpended) offset += 2;

  const rrIntervals: number[] = [];

  if (hasRrIntervals) {
    for (let i = offset; i + 1 < view.byteLength; i += 2) {
      const raw = view.getUint16(i, true);

      // Transmitted in units of 1/1024 second.
      rrIntervals.push((raw / 1024) * 1000);
    }
  }

  return {
    bpm,
    rrIntervals,
    sensorContact: contactSupported
      ? contactDetected
        ? 'supported-contact'
        : 'supported-no-contact'
      : 'unsupported',
  };
}
