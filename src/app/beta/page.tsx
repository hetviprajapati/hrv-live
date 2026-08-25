'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './beta.css';
import {
  EMPTY_SNAPSHOT,
  HRV_CONFIG,
  createHrvState,
  getSnapshot,
  parseHeartRateMeasurement,
  pushBeat,
  resetHrvState,
  type Beat,
  type HrvSnapshot,
  type HrvState,
} from '@/lib/hrv-live/hrv-engine';
import { SessionRecorder, saveRecording } from '@/lib/hrv-live/session-recorder';
import { useRouter } from 'next/navigation';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type LogEntry = {
  id: number;
  timestamp: string;
  /** Exactly what the sensor reported. Never altered. */
  rr: number;
  /** True = flagged by the rule. Shown in red, not counted. */
  bad: boolean;
  reason: string;
  demo?: boolean;
};

/**
 * A Polar H10 notifies roughly once per second. Anything much beyond that means
 * packets were lost, and the beats either side of the hole are not successive.
 */
const PACKET_GAP_MS = 2500;
const BEAT_CLOCK_RESYNC_MS = 1500;
const APP_VERSION = '3.0.0';

/**
 * One number drives both the log panel and the score, so the rows on screen
 * are exactly the beats the reading was calculated from.
 */
const VISIBLE_LOG_ROWS = HRV_CONFIG.windowBeats;
const MAX_TRACE_POINTS = 60;

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

/**
 * A label for the flagged share of the window. It is only ever a label — it
 * never hides or changes the number.
 */
function qualityLabel(rate: number, ready: boolean): string {
  if (!ready) return 'ACQUIRING';
  if (rate > 0.15) return 'NOISY';
  if (rate > 0.05) return 'FAIR';

  return 'CLEAN';
}

function qualityClass(rate: number, ready: boolean): string {
  if (!ready) return 'tk-yellow';
  if (rate > 0.15) return 'tk-red';
  if (rate > 0.05) return 'tk-yellow';

  return 'tk-green';
}

function formatTimestamp(date: Date): string {
  return `${date.toTimeString().split(' ')[0]}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** Round a chart ceiling up to something a human would choose. */
function niceCeiling(value: number): number {
  const candidates = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500];

  for (const candidate of candidates) {
    if (value <= candidate) return candidate;
  }

  return Math.ceil(value / 100) * 100;
}

/* ------------------------------------------------------------------ *
 * Polar Verity Sense / PMD
 * ------------------------------------------------------------------ */

const POLAR_PMD_SERVICE_UUID = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8';
const POLAR_PMD_CONTROL_UUID = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8';
const POLAR_PMD_DATA_UUID = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8';

const PMD_REQUEST_MEASUREMENT_START = 0x02;
const PMD_MEASUREMENT_PPI = 0x03;

type PpiSample = {
  heartRate: number;
  ppIntervalMs: number;
  errorEstimate: number;
  blocker: boolean;
  skinContact: boolean;
  skinContactSupported: boolean;
};

function isVeritySenseDevice(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes('verity sense') || normalized.includes('polar sense');
}

/**
 * Polar PMD PPI frames:
 *   byte 0      measurement type (0x03 = PPI)
 *   bytes 1..8  device timestamp
 *   byte 9      frame type (0 = normal PPI frame)
 *   byte 10..   repeated 6-byte PPI samples
 */
function parsePpiMeasurement(view: DataView): PpiSample[] {
  if (view.byteLength < 16) return [];
  if (view.getUint8(0) !== PMD_MEASUREMENT_PPI) return [];

  const frameType = view.getUint8(9) & 0x7f;
  if (frameType !== 0) return [];

  const contentLength = view.byteLength - 10;
  if (contentLength < 6 || contentLength % 6 !== 0) return [];

  const samples: PpiSample[] = [];

  for (let offset = 10; offset + 6 <= view.byteLength; offset += 6) {
    const flags = view.getUint8(offset + 5);

    samples.push({
      heartRate: view.getUint8(offset),
      ppIntervalMs: view.getUint16(offset + 1, true),
      errorEstimate: view.getUint16(offset + 3, true),
      blocker: (flags & 0x01) !== 0,
      skinContact: (flags & 0x02) !== 0,
      skinContactSupported: (flags & 0x04) !== 0,
    });
  }

  return samples;
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function HrvLivePage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bluetoothDeviceRef = useRef<any | null>(null);
  const characteristicRef = useRef<any | null>(null);
  const pmdControlRef = useRef<any | null>(null);
  const pmdDataRef = useRef<any | null>(null);
  const lastPpiPacketAtRef = useRef<number | null>(null);

  /**
   * All the filtering lives here — a plain object, not a class instance.
   * The component only renders what `getSnapshot` returns.
   */
  const hrvRef = useRef<HrvState>(createHrvState());

  const recorderRef = useRef<SessionRecorder>(new SessionRecorder());
  const lastPacketAtRef = useRef<number | null>(null);

  /**
   * When the most recent beat actually happened. Packet arrival is not beat
   * time — the sensor notifies on its own schedule — so beat times are chained
   * forward from the intervals themselves and only re-anchored when they drift.
   */
  const beatClockRef = useRef<number | null>(null);
  const logIdRef = useRef(0);
  const lastRmssdRef = useRef<number | null>(null);

  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [deviceName, setDeviceName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [contactWarning, setContactWarning] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [recordedBeats, setRecordedBeats] = useState(0);

  const [snapshot, setSnapshot] = useState<HrvSnapshot>(EMPTY_SNAPSHOT);
  const [delta, setDelta] = useState<number | null>(null);
  const [traceData, setTraceData] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  /* ---------------------------------------------------------------- *
   * Session lifecycle
   * ---------------------------------------------------------------- */

  const resetSession = useCallback(() => {
    resetHrvState(hrvRef.current);
    lastPacketAtRef.current = null;
    lastPpiPacketAtRef.current = null;
    beatClockRef.current = null;
    lastRmssdRef.current = null;

    setSnapshot(EMPTY_SNAPSHOT);
    setDelta(null);
    setTraceData([]);
    setLogs([]);
    setContactWarning(false);
    setExportNote('');
    setRecordedBeats(0);
  }, []);

  const teardownConnection = useCallback(() => {
    setConnected(false);
    setDeviceName('');
    resetSession();
  }, [resetSession]);

  /* ---------------------------------------------------------------- *
   * Beat handling
   * ---------------------------------------------------------------- */

  const appendLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    logIdRef.current += 1;
    const withId: LogEntry = { ...entry, id: logIdRef.current };

    setLogs((previous) => [withId, ...previous].slice(0, VISIBLE_LOG_ROWS));
  }, []);

  const publish = useCallback((now: number) => {
    const next = getSnapshot(hrvRef.current, now);
    recorderRef.current.addSample(next, now);
    setSnapshot(next);

    if (next.rmssd !== null) {
      const previous = lastRmssdRef.current;
      setDelta(previous === null ? null : next.rmssd - previous);
      lastRmssdRef.current = next.rmssd;

      setTraceData((current) => [...current, next.rmssd as number].slice(-MAX_TRACE_POINTS));
    }
  }, []);

  /**
   * One interval in, one row out. No holding, no lookahead, no latency —
   * every beat is judged the moment it arrives and shown immediately.
   */
  const ingestBeat = useCallback(
    (rr: number, at: number, demo: boolean) => {
      const beat: Beat = pushBeat(hrvRef.current, rr, at);

      recorderRef.current.addBeat(beat, at);
      setRecordedBeats(recorderRef.current.beatCount);

      appendLog({
        timestamp: formatTimestamp(new Date(at)),
        rr: Math.round(beat.rr),
        bad: beat.bad,
        reason: beat.reason,
        demo,
      });

      publish(at);
    },
    [appendLog, publish],
  );

  /**
   * Give every beat its own timestamp, spaced by its own interval.
   *
   * A packet can carry several intervals, and packet arrival is up to half a
   * second away from the beat it describes. Chain forward from the last beat
   * and re-anchor only when the running clock has drifted; the re-anchor may
   * never move backwards, which keeps the series strictly increasing.
   */
  const ingestIntervals = useCallback(
    (intervals: number[], now: number, demo: boolean) => {
      if (intervals.length === 0) return;

      const spanMs = intervals.reduce((sum, value) => sum + value, 0);
      const clock = beatClockRef.current;

      let beatAt: number;

      if (clock === null) {
        beatAt = now - spanMs;
      } else if (Math.abs(clock + spanMs - now) > BEAT_CLOCK_RESYNC_MS) {
        beatAt = Math.max(now - spanMs, clock);
      } else {
        beatAt = clock;
      }

      for (const interval of intervals) {
        beatAt += interval;
        ingestBeat(interval, beatAt, demo);
      }

      beatClockRef.current = beatAt;
    },
    [ingestBeat],
  );

  const handleHeartRateMeasurement = useCallback(
    (event: Event) => {
      const view = (event.target as any)?.value as DataView | undefined;
      if (!view || view.byteLength === 0) return;

      const now = Date.now();

      let measurement;
      try {
        measurement = parseHeartRateMeasurement(view);
      } catch {
        return;
      }

      setContactWarning(measurement.sensorContact === 'supported-no-contact');

      const lastPacketAt = lastPacketAtRef.current;
      const gapDetected = lastPacketAt !== null && now - lastPacketAt > PACKET_GAP_MS;

      if (gapDetected) {
        beatClockRef.current = null;
      }
      lastPacketAtRef.current = now;

      recorderRef.current.addPacket(view, measurement.bpm, measurement.rrIntervals, measurement.sensorContact, gapDetected, now);

      if (measurement.rrIntervals.length === 0) {
        // Heart rate with no RR data — nothing to score, but worth showing.
        setSnapshot((current) => ({ ...current, heartRate: measurement.bpm }));
        return;
      }

      ingestIntervals(measurement.rrIntervals, now, false);
    },
    [ingestIntervals],
  );

  const handlePpiMeasurement = useCallback(
    (event: Event) => {
      const view = (event.target as any)?.value as DataView | undefined;
      if (!view || view.byteLength === 0) return;

      const samples = parsePpiMeasurement(view);
      if (samples.length === 0) return;

      const now = Date.now();
      const lastPacketAt = lastPpiPacketAtRef.current;
      const gapDetected = lastPacketAt !== null && now - lastPacketAt > PACKET_GAP_MS;

      if (gapDetected) {
        beatClockRef.current = null;
      }
      lastPpiPacketAtRef.current = now;

      // Polar's own quality bits: blocker means movement was detected during
      // the sample, and no-contact means the optical sensor was off the skin.
      // These are the sensor's own verdict, not our rule, so they are applied
      // before the interval ever reaches the filter.
      const usable = samples.filter((sample) => !sample.blocker && !(sample.skinContactSupported && !sample.skinContact));

      const hasSupportedContact = samples.some((sample) => sample.skinContactSupported);
      const hasNoContact = samples.some((sample) => sample.skinContactSupported && !sample.skinContact);
      setContactWarning(hasSupportedContact && hasNoContact);

      const withHr = usable.filter((sample) => sample.heartRate > 0);
      const averageHr = withHr.length > 0 ? Math.round(withHr.reduce((sum, sample) => sum + sample.heartRate, 0) / withHr.length) : 0;

      if (averageHr > 0) {
        setSnapshot((current) => ({ ...current, heartRate: averageHr }));
      }

      recorderRef.current.addPacket(
        view,
        averageHr,
        samples.map((sample) => sample.ppIntervalMs),
        hasNoContact ? 'supported-no-contact' : hasSupportedContact ? 'supported-contact' : 'unsupported',
        gapDetected,
        now,
      );

      ingestIntervals(
        usable.map((sample) => sample.ppIntervalMs),
        now,
        false,
      );
    },
    [ingestIntervals],
  );

  /* ---------------------------------------------------------------- *
   * Demo mode
   * ---------------------------------------------------------------- */

  const demoStateRef = useRef({ phase: 0, beatsUntilArtifact: 25 });

  const pushSimulatedReading = useCallback(() => {
    const state = demoStateRef.current;
    const now = Date.now();

    const baseRr = 880 + Math.sin(now / 12000) * 40;
    state.phase += (2 * Math.PI * baseRr) / 5000; // ~5s breathing cycle

    const rsa = Math.sin(state.phase) * 34;
    const noise = (Math.random() - 0.5) * 16;
    const rr = baseRr + rsa + noise;

    state.beatsUntilArtifact -= 1;

    if (state.beatsUntilArtifact <= 0) {
      state.beatsUntilArtifact = 20 + Math.floor(Math.random() * 25);

      // A misplaced detection: one beat too short, the next too long, total
      // elapsed time preserved — the shape the real sensors actually produce.
      const shift = 180 + Math.random() * 120;
      ingestIntervals([rr - shift, rr + shift], now, true);
      return;
    }

    ingestIntervals([rr], now, true);
  }, [ingestIntervals]);

  const startDemo = useCallback(() => {
    if (simulationRef.current) clearInterval(simulationRef.current);

    resetSession();
    demoStateRef.current = { phase: 0, beatsUntilArtifact: 25 };
    recorderRef.current.start('demo', 'SIMULATED DEVICE', Date.now());

    setDemoMode(true);
    setConnected(true);
    setDeviceName('DEMO — SIMULATED DEVICE');
    setErrorMessage('');

    pushSimulatedReading();
    simulationRef.current = setInterval(pushSimulatedReading, 900);
  }, [pushSimulatedReading, resetSession]);

  const stopDemo = useCallback(() => {
    if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
    setDemoMode(false);
  }, []);

  const handleDeviceDisconnected = useCallback(
    (event?: Event) => {
      console.error('[Polar] GATT DISCONNECTED at', new Date().toISOString());

      const device = (event?.target as any) ?? bluetoothDeviceRef.current;
      if (device) device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);

      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;

      teardownConnection();
      startDemo();
      setErrorMessage('POLAR DISCONNECTED — DEMO MODE ACTIVE');
    },
    [startDemo, teardownConnection],
  );

  /* ---------------------------------------------------------------- *
   * Bluetooth
   * ---------------------------------------------------------------- */

  const connectPolar = async () => {
    setErrorMessage('');
    stopDemo();

    if (!(navigator as any).bluetooth) {
      setErrorMessage('WEB BLUETOOTH UNAVAILABLE — USE CHROME ON DESKTOP/ANDROID, OR BLUEFY ON iOS');
      return;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'Polar' }],
        optionalServices: ['heart_rate', 'battery_service', 'device_information', POLAR_PMD_SERVICE_UUID],
      });

      resetSession();

      bluetoothDeviceRef.current = device;
      device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('GATT connect failed');

      const name = device.name || 'POLAR DEVICE';
      const isVerity = isVeritySenseDevice(name);

      if (!isVerity) {
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
        characteristicRef.current = characteristic;
      }

      recorderRef.current.start('live', name, Date.now());

      if (isVerity) {
        const pmdService = await server.getPrimaryService(POLAR_PMD_SERVICE_UUID);
        const pmdControl = await pmdService.getCharacteristic(POLAR_PMD_CONTROL_UUID);
        const pmdData = await pmdService.getCharacteristic(POLAR_PMD_DATA_UUID);

        pmdControlRef.current = pmdControl;
        pmdDataRef.current = pmdData;

        await pmdData.startNotifications();
        pmdData.addEventListener('characteristicvaluechanged', handlePpiMeasurement);

        await pmdControl.startNotifications();
        pmdControl.addEventListener('characteristicvaluechanged', (controlEvent: Event) => {
          const controlView = (controlEvent.target as any)?.value as DataView | undefined;
          if (!controlView || controlView.byteLength === 0) return;

          const bytes = new Uint8Array(controlView.buffer, controlView.byteOffset, controlView.byteLength);
          console.debug(
            '[Verity Sense] PMD CONTROL RESPONSE:',
            Array.from(bytes)
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join(' '),
          );
        });

        await pmdControl.writeValue(new Uint8Array([PMD_REQUEST_MEASUREMENT_START, PMD_MEASUREMENT_PPI]));
        console.debug('[Verity Sense] PPI start command sent — first data can take ~25s');
      }

      setConnected(true);
      setDemoMode(false);
      setDeviceName(name);
    } catch (error) {
      console.error(error);

      const device = bluetoothDeviceRef.current;
      if (device) device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
      if (characteristicRef.current) {
        characteristicRef.current.removeEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
      }
      if (pmdDataRef.current) {
        pmdDataRef.current.removeEventListener('characteristicvaluechanged', handlePpiMeasurement);
      }
      if (device?.gatt?.connected) {
        try {
          device.gatt.disconnect();
        } catch {
          // Best-effort cleanup; the original error is more useful.
        }
      }

      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;
      resetSession();

      setConnected(false);
      setErrorMessage(
        error instanceof Error && error.name === 'NotFoundError'
          ? 'NO DEVICE SELECTED'
          : 'CONNECTION FAILED — CHECK THE POLAR DEVICE IS ON, WORN, AND NOT CONNECTED TO ANOTHER APP',
      );
      startDemo();
    }
  };

  const disconnectPolar = () => {
    const device = bluetoothDeviceRef.current;

    try {
      if (characteristicRef.current) {
        characteristicRef.current.removeEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
      }
      if (pmdDataRef.current) {
        pmdDataRef.current.removeEventListener('characteristicvaluechanged', handlePpiMeasurement);
      }
      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
        if (device.gatt?.connected) device.gatt.disconnect();
      }
    } catch (error) {
      console.error('Bluetooth disconnect error:', error);
    } finally {
      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;
      teardownConnection();
      startDemo();
    }
  };

  useEffect(() => {
    startDemo();

    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
    };
    // Deliberately once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- *
   * Session export
   * ---------------------------------------------------------------- */

  const exportRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (recorder.isEmpty) {
      setExportNote('NOTHING RECORDED YET — CONNECT AND WEAR THE SENSOR FIRST');
      return;
    }

    // Build synchronously. On iPadOS the share sheet only opens while the tap
    // is still the live user gesture; any await before it forfeits that.
    const recording = recorder.build(APP_VERSION, HRV_CONFIG, Date.now());
    const stats =
      `${recording.summary.beats} BEATS, ${Math.round(recording.durationMs / 1000)}s, ` + `${recording.summary.flagged} FLAGGED`;

    setExportNote('PREPARING SESSION LOG...');

    saveRecording(recording)
      .then((outcome) => {
        const kb = Math.round(outcome.bytes / 1024);

        switch (outcome.method) {
          case 'share':
            setExportNote(`SHARED ${outcome.filename} (${kb} KB) — ${stats}`);
            break;
          case 'download':
            setExportNote(`SAVED TO DOWNLOADS: ${outcome.filename} (${kb} KB) — ${stats}`);
            break;
          case 'clipboard':
            setExportNote(`COPIED TO CLIPBOARD (${kb} KB) — PASTE INTO A MESSAGE OR NOTE`);
            break;
          case 'cancelled':
            setExportNote('SAVE CANCELLED');
            break;
          default:
            setExportNote(`COULD NOT SAVE — ${outcome.reason}`);
        }
      })
      .catch((error) => {
        console.error(error);
        setExportNote('EXPORT FAILED — SEE BROWSER CONSOLE');
      });
  }, []);

  /* ---------------------------------------------------------------- *
   * Chart
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const padTop = 14;
      const padBottom = 14;
      const usableHeight = height - padTop - padBottom;

      const peak = traceData.length > 0 ? Math.max(...traceData) : 0;
      const scaleMax = niceCeiling(Math.max(peak * 1.15, 50));

      const yFor = (value: number) => padTop + usableHeight - (Math.max(0, Math.min(scaleMax, value)) / scaleMax) * usableHeight;

      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.font = '9px monospace';
      ctx.fillStyle = '#4a4a4a';

      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        const mark = scaleMax * fraction;
        const y = yFor(mark);

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${Math.round(mark)}`, 2, y - 2);
      }

      if (!connected || traceData.length === 0) {
        ctx.strokeStyle = '#3a2a10';
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      const points = traceData.map((value, index) => ({
        x: (index / Math.max(1, traceData.length - 1)) * width,
        y: yFor(value),
        value,
      }));

      const latest = points[points.length - 1].value;
      const lineColor = latest < 20 ? '#ff2a2a' : latest < 40 ? '#ffe14d' : '#3dff6e';

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      points.forEach((point, index) => {
        const isLatest = index === points.length - 1;

        ctx.beginPath();
        ctx.arc(point.x, point.y, isLatest ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isLatest ? '#fff' : lineColor;
        ctx.fill();
      });
    };

    draw();

    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(parent);

    return () => resizeObserver.disconnect();
  }, [traceData, connected]);

  /* ---------------------------------------------------------------- *
   * Cleanup
   * ---------------------------------------------------------------- */

  useEffect(() => {
    return () => {
      const device = bluetoothDeviceRef.current;

      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
        if (device.gatt?.connected) device.gatt.disconnect();
        bluetoothDeviceRef.current = null;
      }
    };
  }, [handleDeviceDisconnected]);

  /* ---------------------------------------------------------------- *
   * Derived display state
   * ---------------------------------------------------------------- */

  const { rmssd, sdnn, pnn50, avgRmssd60s, heartRate, artifactRate, ready } = snapshot;

  const signalLabel = qualityLabel(artifactRate, ready);
  const signalClass = qualityClass(artifactRate, ready);

  // Fixed set of visible rows, so nothing is inserted into or removed from the
  // DOM as beats arrive.
  const visibleLogs = Array.from({ length: VISIBLE_LOG_ROWS }, (_, index) => logs[index] ?? null);

  const status = (() => {
    if (!connected) return 'AWAITING SIGNAL';
    if (contactWarning) return 'NO SKIN CONTACT — CHECK THE SENSOR';
    if (rmssd === null) return 'ACQUIRING CLEAN BEATS...';
    if (rmssd < 20) return 'LOW HRV — ELEVATED STRESS';
    if (rmssd < 40) return 'NOMINAL';
    return 'STRONG RECOVERY';
  })();

  const statusClass = (() => {
    if (!connected || rmssd === null) return 'tk-yellow';
    if (contactWarning) return 'tk-red';
    if (rmssd < 20) return 'tk-red';
    if (rmssd < 40) return 'tk-yellow';
    return 'tk-green';
  })();

  const num = (value: number | null, digits = 1) => (value !== null ? value.toFixed(digits) : '--');

  const handleNavigateToAbout = () => {
    router.push('/beta/about');
  };

  const handleNavigateToDevices = () => {
    router.push('/beta/devices');
  };

  const handleNavigateToPoincare = () => {
    router.push('/beta/poincare-live');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        handleNavigateToAbout();
      }
      if (event.key === 'F2') {
        event.preventDefault();
        handleNavigateToDevices();
      }
      if (event.key === 'F3') {
        event.preventDefault();
        handleNavigateToPoincare();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [router]);

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  return (
    <main className="hrv-live">
      <div className="terminal-header">
        <div>HRV.LIVE // BIOMETRIC FEED</div>

        <div>
          DEVICE SYNC:{' '}
          <b className={demoMode ? 'demo-mode' : connected ? 'device-connected' : 'device-offline'}>
            {demoMode ? 'DEMO MODE' : connected ? 'CONNECTED' : 'OFFLINE'}
          </b>
        </div>

        <div>SYS_VER: {APP_VERSION} &nbsp;&nbsp; ACCESS: FREE</div>
      </div>

      <div className="ticker-tape">
        <div className="ticker-tape-inner">
          HR &lt;GO&gt; <span className="tk-white">{heartRate ?? '--'} BPM</span>
          &nbsp;|&nbsp; RMSSD &lt;GO&gt; <span className="tk-white">{num(rmssd)} MS</span>
          &nbsp;|&nbsp; SDNN &lt;GO&gt; <span className="tk-cyan">{num(sdnn)} MS</span>
          &nbsp;|&nbsp; pNN50 &lt;GO&gt; <span className="tk-cyan">{num(pnn50)} %</span>
          &nbsp;|&nbsp; SIGNAL &lt;GO&gt; <span className={signalClass}>{signalLabel}</span>
          &nbsp;|&nbsp; STATUS &lt;GO&gt; <span className={statusClass}>{status}</span>
          &nbsp;|&nbsp; HR &lt;GO&gt; <span className="tk-white">{heartRate ?? '--'} BPM</span>
          &nbsp;|&nbsp; RMSSD &lt;GO&gt; <span className="tk-white">{num(rmssd)} MS</span>
          &nbsp;|&nbsp; SDNN &lt;GO&gt; <span className="tk-cyan">{num(sdnn)} MS</span>
          &nbsp;|&nbsp; pNN50 &lt;GO&gt; <span className="tk-cyan">{num(pnn50)} %</span>
        </div>
      </div>

      {errorMessage ? (
        <div className="log-line tk-red" style={{ padding: '4px 10px' }}>
          {errorMessage}
        </div>
      ) : null}

      {exportNote ? (
        <div className="log-line tk-green" style={{ padding: '4px 10px' }}>
          {exportNote}
        </div>
      ) : null}

      <div className="workspace-scroll">
        <div className="workspace">
          <div className="panel vector-box">
            <div className="panel-title">SOURCE VECTOR</div>

            <svg
              className={`heart-wireframe ${connected ? 'active' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>

            <div className={`alert-text ${connected ? 'vector-connected' : 'vector-offline'}`}>
              {connected ? deviceName : 'CONNECT POLAR DEVICE'}
            </div>

            {connected ? (
              <div className="source-stats">
                SIGNAL <span className={signalClass}>{signalLabel}</span>
                <br />
                {snapshot.beatsFlagged} / {snapshot.beatsSeen} BEATS FLAGGED
                <br />
                <span className="tk-red">REC</span> {recordedBeats.toLocaleString()} LOGGED
              </div>
            ) : null}

            <button className="action-btn" onClick={connected && !demoMode ? disconnectPolar : connectPolar}>
              {connected && !demoMode ? '[ DISCONNECT FEED ]' : 'Connect Polar Heart Rate Sensor'}
            </button>

            <div className="other-device">
              <button type="button" onClick={handleNavigateToDevices} className="other-device-button">
                Other devices?
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">HRV LIVE MARKET DATA FEED</div>

            <div className="ticker-grid">
              <div className="gauge-block">
                <div className="gauge-label">HEART RATE</div>
                <div className="gauge-value">[ {heartRate ?? '--'} ]</div>
                <div className="gauge-label">BPM</div>
              </div>

              <div className="gauge-block">
                <div className="gauge-label">HRV (RMSSD)</div>
                <div className="gauge-value">[{rmssd !== null ? ` ${rmssd.toFixed(1)} ` : ' -- '}]</div>
                <div className="gauge-label">{rmssd !== null ? 'MILLISECONDS' : 'ACQUIRING'}</div>
              </div>
            </div>

            <div className="watchlist">
              <div>
                <div className="wl-row">
                  <span className="wl-label">SDNN</span>
                  <span className="wl-val tk-cyan">{sdnn !== null ? `${sdnn.toFixed(1)} ms` : '-- ms'}</span>
                </div>

                <div className="wl-row">
                  <span className="wl-label">pNN50</span>
                  <span className="wl-val tk-cyan">{pnn50 !== null ? `${pnn50.toFixed(1)} %` : '-- %'}</span>
                </div>

                <div className="wl-row">
                  <span className="wl-label">1MIN AVG RMSSD</span>
                  <span className="wl-val tk-yellow">{avgRmssd60s !== null ? `${avgRmssd60s.toFixed(1)} ms` : '-- ms'}</span>
                </div>
              </div>

              <div>
                <div className="wl-row">
                  <span className="wl-label">DELTA vs PREV</span>
                  <span className={`wl-val ${delta === null ? '' : delta >= 0 ? 'tk-green' : 'tk-red'}`}>
                    {delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ms` : '-- ms'}
                  </span>
                </div>

                <div className="wl-row">
                  <span className="wl-label">SIGNAL QUALITY</span>
                  <span className={`wl-val ${signalClass}`}>
                    {signalLabel} · {(artifactRate * 100).toFixed(0)}% FLAGGED
                  </span>
                </div>

                <div className="wl-row">
                  <span className="wl-label">GOOD BEATS</span>
                  <span className="wl-val tk-cyan">
                    {snapshot.goodBeats} / {snapshot.windowSize}
                  </span>
                </div>
              </div>
            </div>

            <div className="graph-area">
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="panel ledger-box">
            <div className="panel-title">RR INTERVAL HISTORY LOG</div>

            <div className="log-stream">
              {logs.length === 0 ? (
                <>
                  <div className="log-line">SYSTEM STATUS: IDLE...</div>
                  <div className="log-line">PORT SCAN OPEN: WEB_BLUETOOTH CHANNELS READY</div>
                  <div className="log-line">ARTIFACT FLAGGING: ARMED</div>
                  <div className="log-line">AWAITING POLAR PACKETS...</div>
                </>
              ) : (
                visibleLogs.map((log, index) => (
                  <div className="log-line" key={index}>
                    {log ? (
                      <>
                        <span>{log.timestamp}</span>
                        <span className={log.bad ? 'tk-red' : 'tk-green'}>
                          RR={log.rr}ms{log.bad ? '*' : ' '}
                        </span>
                      </>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="fkey-bar">
        {(
          [
            ['F1', 'ABOUT', handleNavigateToAbout],
            ['F2', 'DEVICES', handleNavigateToDevices],
            ['F3', 'POINCARE', handleNavigateToPoincare],
            ['F4', 'TREND', null],
            ['F5', 'LOG EXPORT', exportRecording],
            ['F6', 'GLUCOSELIVE', null],
            ['F7', 'SETTINGS', null],
            ['F8', 'PRO UPGRADE', null],
          ] as [string, string, (() => void) | null][]
        ).map(([key, label, action]) => (
          <div
            className="fkey"
            key={key}
            onClick={action ?? undefined}
            role={action ? 'button' : undefined}
            tabIndex={action ? 0 : undefined}
            onKeyDown={
              action
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') action();
                  }
                : undefined
            }
            style={action ? { cursor: 'pointer' } : undefined}
            title={action ? 'Download this session as a file you can send for analysis' : undefined}
          >
            <span className="fkey-num">{key}</span>
            {label}
          </div>
        ))}
      </div>
    </main>
  );
}
