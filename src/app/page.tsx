'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './page.css';
import {
  DEFAULT_CONFIG,
  HrvEngine,
  parseHeartRateMeasurement,
  type CorrectionKind,
  type HrvSnapshot,
  type PendingResolution,
  type SignalQuality,
} from '@/lib/hrv-live/hrv-engine';
import { SessionRecorder, saveRecording, copyRecordingToClipboard } from '@/lib/hrv-live/session-recorder';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type BeatStatus = 'ok' | 'held' | 'corrected' | 'rejected';

type LogEntry = {
  id: number;
  timestamp: string;
  /** The value the sensor actually reported. Always shown, never hidden. */
  raw: number;
  /** The value used in the calculation, when it differs from the raw one. */
  used: number | null;
  status: BeatStatus;
  note: string;
  demo?: boolean;
};

const EMPTY_SNAPSHOT: HrvSnapshot = {
  heartRate: null,
  rmssd: null,
  sdnn: null,
  pnn50: null,
  avgRmssd60s: null,
  meanRr: null,
  quality: 'acquiring',
  artifactRate: 0,
  beatsSeen: 0,
  beatsClean: 0,
  beatsCorrected: 0,
  beatsRejected: 0,
  validDiffs: 0,
  windowSize: 0,
  ready: false,
};

/**
 * A Polar H10 notifies roughly once per second. Anything much beyond that means
 * packets were lost, and the beats either side of the hole are not successive.
 */
const PACKET_GAP_MS = 2500;
const BEAT_CLOCK_RESYNC_MS = 1500;
const APP_VERSION = '2.1.0';

const MAX_LOG_ROWS = 40;
const VISIBLE_LOG_ROWS = 24;
const MAX_TRACE_POINTS = 60;

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

const QUALITY_LABEL: Record<SignalQuality, string> = {
  acquiring: 'ACQUIRING',
  excellent: 'EXCELLENT',
  good: 'GOOD',
  fair: 'FAIR',
  poor: 'POOR',
};

const QUALITY_CLASS: Record<SignalQuality, string> = {
  acquiring: 'tk-yellow',
  excellent: 'tk-green',
  good: 'tk-green',
  fair: 'tk-yellow',
  poor: 'tk-red',
};

const STATUS_CLASS: Record<BeatStatus, string> = {
  ok: 'tk-green',
  held: 'tk-yellow',
  corrected: 'tk-yellow',
  rejected: 'tk-red',
};

const STATUS_MARK: Record<BeatStatus, string> = {
  ok: ' ',
  held: '?',
  corrected: '*',
  rejected: 'x',
};

function correctionNote(event: { correction: CorrectionKind }): string {
  switch (event.correction) {
    case 'misplaced-pair':
      return 'MISPLACED BEAT — TIMING REBUILT';
    case 'missed-beat':
      return 'MISSED BEAT — INSERTED';
    case 'extra-beat':
      return 'EXTRA DETECTION — MERGED';
    case 'out-of-range':
      return 'OUTSIDE PHYSIOLOGICAL RANGE';
    case 'sensor-stuck':
      return 'SENSOR REPEATING — VALUE FROZEN';
    case 'unrepairable':
      return 'NOISE — DISCARDED';
    default:
      return '';
  }
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

const PMD_GET_MEASUREMENT_SETTINGS = 0x01;
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
 *
 * Each PPI sample:
 *   byte 0      HR
 *   bytes 1..2  pulse-to-pulse interval in ms, little-endian
 *   bytes 3..4  error estimate
 *   byte 5      blocker / skin-contact flags
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bluetoothDeviceRef = useRef<any | null>(null);
  const characteristicRef = useRef<any | null>(null);
  const pmdControlRef = useRef<any | null>(null);
  const pmdDataRef = useRef<any | null>(null);
  const lastPpiPacketAtRef = useRef<number | null>(null);
  const ppiPacketCountRef = useRef(0);
  const ppiSampleCountRef = useRef(0);
  const ppiStartedAtRef = useRef<number | null>(null);

  /**
   * All signal processing lives here. The component only renders what the
   * engine reports — it does no arithmetic on RR intervals of its own.
   */
  const engineRef = useRef<HrvEngine>(new HrvEngine());

  /**
   * Records the whole session so it can be replayed offline. Always on — a
   * user who has just watched the number misbehave should not have to
   * reproduce it with recording enabled.
   */
  const recorderRef = useRef<SessionRecorder>(new SessionRecorder());
  const lastPacketAtRef = useRef<number | null>(null);
  const beatClockRef = useRef<number | null>(null);
  const logIdRef = useRef(0);
  const lastRmssdRef = useRef<number | null>(null);

  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
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

  /**
   * Clear everything that could carry across a session boundary.
   *
   * The previous version never emptied the RR buffer on connect, so beats from
   * an earlier session — or from demo mode — stayed in the window and produced
   * one enormous fabricated difference at the seam. Called on connect as well
   * as on disconnect, deliberately.
   */
  const resetSession = useCallback(() => {
    engineRef.current.reset();
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

  const handleDeviceDisconnected = useCallback(
    (event?: Event) => {
      console.error('[Polar] GATT DISCONNECTED at', new Date().toISOString());

      console.error('[Polar] Device:', bluetoothDeviceRef.current?.name);

      console.error('[Polar] GATT connected:', bluetoothDeviceRef.current?.gatt?.connected);

      const device = (event?.target as any) ?? bluetoothDeviceRef.current;

      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
      }

      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;

      teardownConnection();
      setErrorMessage('DEVICE DISCONNECTED — FEED CLOSED');
    },
    [teardownConnection],
  );

  /* ---------------------------------------------------------------- *
   * Beat handling
   * ---------------------------------------------------------------- */

  const appendLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    logIdRef.current += 1;
    const withId: LogEntry = { ...entry, id: logIdRef.current };

    setLogs((previous) => [withId, ...previous].slice(0, MAX_LOG_ROWS));
  }, []);

  /**
   * A pair correction resolves a beat that was logged one beat ago as "held".
   * Reach back and relabel it so the log tells the truth about what happened.
   */
  const relabelHeldEntry = useCallback((status: 'corrected' | 'rejected', used: number | null, note: string) => {
    setLogs((previous) => {
      const index = previous.findIndex((entry) => entry.status === 'held');
      if (index === -1) return previous;

      const next = [...previous];
      next[index] = { ...next[index], status, used, note };

      return next;
    });
  }, []);

  const applyPendingResolution = useCallback(
    (resolution: PendingResolution) => {
      const resolvedTo = resolution.emitted[0];

      relabelHeldEntry(resolution.disposition, resolvedTo === undefined ? null : Math.round(resolvedTo), correctionNote(resolution));
    },
    [relabelHeldEntry],
  );

  const publish = useCallback((now: number) => {
    const next = engineRef.current.snapshot(now);
    recorderRef.current.addSample(next, now);
    setSnapshot(next);

    if (next.rmssd !== null) {
      const previous = lastRmssdRef.current;
      setDelta(previous === null ? null : next.rmssd - previous);
      lastRmssdRef.current = next.rmssd;

      setTraceData((current) => [...current, next.rmssd as number].slice(-MAX_TRACE_POINTS));
    }
  }, []);

  const ingestBeat = useCallback(
    (rawRr: number, now: number, demo: boolean) => {
      const event = engineRef.current.push(rawRr, now);
      recorderRef.current.addBeat(event, now);
      setRecordedBeats(recorderRef.current.beatCount);

      const stamp = formatTimestamp(new Date(now));
      const rounded = Math.round(rawRr);

      // A beat held on a previous call has now been judged one way or another.
      // Reach back and give it its verdict so nothing sits at "held" forever.
      if (event.pendingResolution) {
        applyPendingResolution(event.pendingResolution);
      }

      if (event.disposition === 'corrected') {
        const used = event.emitted[0] ?? null;

        // A pair correction consumes the beat that was held last time round.
        if (event.correction === 'misplaced-pair' || event.correction === 'extra-beat') {
          relabelHeldEntry('corrected', used === null ? rounded : Math.round(used), correctionNote(event));
        }

        appendLog({
          timestamp: stamp,
          raw: rounded,
          used: used === null ? null : Math.round(used),
          status: 'corrected',
          note: correctionNote(event),
          demo,
        });
      } else if (event.disposition === 'rejected') {
        // correction 'none' means the beat is being held for one beat to see
        // whether its partner arrives and completes a repairable pair.
        const held = event.correction === 'none';

        appendLog({
          timestamp: stamp,
          raw: rounded,
          used: null,
          status: held ? 'held' : 'rejected',
          note: held ? 'FLAGGED — AWAITING NEXT BEAT' : correctionNote(event),
          demo,
        });
      } else {
        appendLog({
          timestamp: stamp,
          raw: rounded,
          used: null,
          status: 'ok',
          note: '',
          demo,
        });
      }

      publish(now);
    },
    [appendLog, applyPendingResolution, publish, relabelHeldEntry],
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

      // Packet-level gap detection. The recorded sessions contain real
      // five-second holes; without this the beats either side of one get
      // treated as consecutive.
      const lastPacketAt = lastPacketAtRef.current;
      const gapDetected = lastPacketAt !== null && now - lastPacketAt > PACKET_GAP_MS;

      if (gapDetected) {
        beatClockRef.current = null;
        const resolution = engineRef.current.markGap();
        if (resolution) applyPendingResolution(resolution);
      }
      lastPacketAtRef.current = now;

      recorderRef.current.addPacket(view, measurement.bpm, measurement.rrIntervals, measurement.sensorContact, gapDetected, now);

      if (measurement.rrIntervals.length === 0) {
        // Heart rate without RR data — nothing to feed the engine, but the
        // rate itself is still worth showing.
        setSnapshot((current) => ({ ...current, heartRate: measurement.bpm }));
        return;
      }

      /*
       * Give every beat its OWN timestamp.
       *
       * The intervals themselves say when each beat happened. The last one
       * ended at `now`; the one before it ended one interval earlier; and so
       * on. Walking backwards from the packet's arrival reconstructs the true
       * beat times, which are then strictly increasing and unique.
       */
      const intervals = measurement.rrIntervals;
      const spanMs = intervals.reduce((sum, rr) => sum + rr, 0);

      const clock = beatClockRef.current;
      let beatAt: number;

      if (clock === null) {
        beatAt = now - spanMs;
      } else if (Math.abs(clock + spanMs - now) > BEAT_CLOCK_RESYNC_MS) {
        beatAt = Math.max(now - spanMs, clock); // re-anchor, never rewind
      } else {
        beatAt = clock;
      }

      for (const rr of intervals) {
        beatAt += rr;
        ingestBeat(rr, beatAt, false);
      }

      beatClockRef.current = beatAt;
    },
    [applyPendingResolution, ingestBeat],
  );

  const handlePpiMeasurement = useCallback(
    (event: Event) => {
      const view = (event.target as any)?.value as DataView | undefined;

      if (!view || view.byteLength === 0) return;

      ppiPacketCountRef.current += 1;

      const elapsed = ppiStartedAtRef.current === null ? null : Date.now() - ppiStartedAtRef.current;

      console.debug('[Verity Sense] PPI PACKET', {
        packet: ppiPacketCountRef.current,
        elapsedMs: elapsed,
        size: view.byteLength,
      });

      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

      console.debug(
        '[Verity Sense] RAW PPI DATA:',
        Array.from(bytes)
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(' '),
      );

      const samples = parsePpiMeasurement(view);

      ppiSampleCountRef.current += samples.length;

      console.debug('[Verity Sense] PPI TOTAL SAMPLES', {
        packets: ppiPacketCountRef.current,
        samples: ppiSampleCountRef.current,
      });

      console.debug('[Verity Sense] PARSED PPI SAMPLES:', samples.length, samples);

      if (samples.length === 0) return;

      const now = Date.now();
      const lastPacketAt = lastPpiPacketAtRef.current;
      const gapDetected = lastPacketAt !== null && now - lastPacketAt > PACKET_GAP_MS;

      if (gapDetected) {
        beatClockRef.current = null;
        const resolution = engineRef.current.markGap();
        if (resolution) applyPendingResolution(resolution);
      }

      lastPpiPacketAtRef.current = now;

      const validSamples = samples.filter((sample) => {
        // Polar explicitly says blocker=1 means movement was detected and the
        // sample must be discarded. If contact support is present, no-contact
        // samples must also be discarded.
        if (sample.blocker) return false;
        if (sample.skinContactSupported && !sample.skinContact) return false;
        if (!Number.isFinite(sample.ppIntervalMs)) return false;
        return sample.ppIntervalMs >= DEFAULT_CONFIG.minRrMs && sample.ppIntervalMs <= DEFAULT_CONFIG.maxRrMs;
      });

      const hasSupportedContact = samples.some((sample) => sample.skinContactSupported);
      const hasNoContact = samples.some((sample) => sample.skinContactSupported && !sample.skinContact);
      setContactWarning(hasSupportedContact && hasNoContact);

      const bpmSamples = validSamples.filter((sample) => sample.heartRate > 0);
      if (bpmSamples.length > 0) {
        const averageHr = bpmSamples.reduce((sum, sample) => sum + sample.heartRate, 0) / bpmSamples.length;
        setSnapshot((current) => ({
          ...current,
          heartRate: Math.round(averageHr),
        }));
      }

      recorderRef.current.addPacket(
        view,
        bpmSamples.length > 0 ? Math.round(bpmSamples.reduce((sum, sample) => sum + sample.heartRate, 0) / bpmSamples.length) : 0,
        samples.map((sample) => sample.ppIntervalMs),
        hasNoContact ? 'supported-no-contact' : hasSupportedContact ? 'supported-contact' : 'unsupported',
        gapDetected,
        now,
      );

      if (validSamples.length === 0) return;

      /*
       * PMD can batch several PPI samples into one notification. Reconstruct
       * the beat times from the pulse intervals just like we do for H10 RR
       * intervals. The last sample ends at `now`; earlier samples are walked
       * backwards from there.
       */
      const intervals = validSamples.map((sample) => sample.ppIntervalMs);
      const spanMs = intervals.reduce((sum, pp) => sum + pp, 0);

      const clock = beatClockRef.current;
      let beatAt: number;

      if (clock === null) {
        beatAt = now - spanMs;
      } else if (Math.abs(clock + spanMs - now) > BEAT_CLOCK_RESYNC_MS) {
        beatAt = Math.max(now - spanMs, clock);
      } else {
        beatAt = clock;
      }

      for (const pp of intervals) {
        beatAt += pp;
        ingestBeat(pp, beatAt, false);
      }

      beatClockRef.current = beatAt;
    },
    [applyPendingResolution, ingestBeat],
  );

  /* ---------------------------------------------------------------- *
   * Bluetooth
   * ---------------------------------------------------------------- */

  const connectPolar = async () => {
    setErrorMessage('');

    if (!(navigator as any).bluetooth) {
      setErrorMessage('WEB BLUETOOTH UNAVAILABLE — USE CHROME ON DESKTOP/ANDROID, OR BLUEFY ON iOS');
      return;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        // Use the device name for discovery. Verity Sense exposes the standard
        // heart-rate service, but its HRV/PPI stream lives in Polar PMD.
        filters: [{ namePrefix: 'Polar' }],
        optionalServices: ['heart_rate', 'battery_service', 'device_information', POLAR_PMD_SERVICE_UUID],
      });

      // Wipe first. Whatever was in the buffers belongs to a different session.
      resetSession();

      bluetoothDeviceRef.current = device;
      device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('GATT connect failed');

      const name = device.name || 'POLAR DEVICE';
      const isVerity = isVeritySenseDevice(name);

      /*
       * H10:
       *   Standard Heart Rate service -> RR intervals.
       *
       * Verity Sense:
       *   PMD PPI stream -> PPI intervals.
       *
       * Keep the two paths isolated while debugging Chrome/Verity Sense.
       * Do not enable the standard HR notification on Verity Sense because
       * its HRV source is the PMD PPI stream.
       */
      if (!isVerity) {
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');

        console.debug('[Polar] Enabling standard HR notifications...');

        await characteristic.startNotifications();

        console.debug('[Polar] Standard HR notifications enabled');

        characteristic.addEventListener('characteristicvaluechanged', handleHeartRateMeasurement);

        characteristicRef.current = characteristic;
      }

      // Start recording before enabling PMD so the first PPI notification can
      // never arrive before the recorder has a session start time.
      recorderRef.current.start('live', name, Date.now());

      if (isVerity) {
        console.debug('[Verity Sense] Starting PMD/PPI setup...');

        const pmdService = await server.getPrimaryService(POLAR_PMD_SERVICE_UUID);
        const pmdControl = await pmdService.getCharacteristic(POLAR_PMD_CONTROL_UUID);
        const pmdData = await pmdService.getCharacteristic(POLAR_PMD_DATA_UUID);

        console.debug('[Verity Sense] PMD characteristics found');
        pmdControlRef.current = pmdControl;
        pmdDataRef.current = pmdData;

        /*
         * PMD DATA
         *
         * Verity Sense sends PPI measurements here.
         */
        console.debug('[Verity Sense] Enabling PMD data notifications...');

        await pmdData.startNotifications();

        console.debug('[Verity Sense] PMD data notifications enabled');

        pmdData.addEventListener('characteristicvaluechanged', handlePpiMeasurement);

        /*
         * PMD CONTROL
         *
         * The control characteristic uses indications.
         */
        console.debug('[Verity Sense] Enabling PMD control indications...');

        await pmdControl.startNotifications();

        console.debug('[Verity Sense] PMD control indications enabled');

        const handlePmdControl = (event: Event) => {
          const controlView = (event.target as any)?.value as DataView | undefined;

          if (!controlView || controlView.byteLength === 0) {
            return;
          }

          const bytes = new Uint8Array(controlView.buffer, controlView.byteOffset, controlView.byteLength);

          const hex = Array.from(bytes)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(' ');

          console.debug('[Verity Sense] PMD CONTROL RESPONSE:', {
            length: controlView.byteLength,
            hex,
            bytes: Array.from(bytes),
          });
        };

        pmdControl.addEventListener('characteristicvaluechanged', handlePmdControl);

        try {
          /*
           * ---------------------------------------------------------
           * PPI START
           * ---------------------------------------------------------
           *
           * IMPORTANT:
           * PPI does NOT use the stream-settings payload.
           *
           * Polar's startPpiStreaming() API takes only the device ID.
           *
           * Raw PMD command:
           *
           *   0x02 = REQUEST_MEASUREMENT_START
           *   0x03 = PPI
           */
          console.debug('[Verity Sense] Sending PPI start command...');

          const ppiStartCommand = new Uint8Array([PMD_REQUEST_MEASUREMENT_START, PMD_MEASUREMENT_PPI]);

          console.debug(
            '[Verity Sense] PPI START COMMAND:',
            Array.from(ppiStartCommand)
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join(' '),
          );

          /*
           * IMPORTANT:
           *
           * Use writeValue() here.
           *
           * This matches the raw BLE approach shown in Polar's
           * own GitHub discussion for PPI.
           */
          ppiPacketCountRef.current = 0;
          ppiSampleCountRef.current = 0;
          ppiStartedAtRef.current = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 300));

          // await pmdControl.writeValue(ppiStartCommand);

          console.debug('[Verity Sense] PPI start command sent successfully');

          console.debug('[Verity Sense] Connection immediately after PPI start:', device.gatt?.connected);

          /*
           * PPI has a startup delay.
           *
           * Do NOT assume "no PPI data yet" means failure.
           * We will let the notification listener remain active.
           */
        } catch (error) {
          console.error('[Verity Sense] PPI startup failed:', error);

          throw error;
        }
      }

      setConnected(true);
      setDemoMode(false);
      setDeviceName(name);

      if (isVerity) {
        setErrorMessage('');
      }
    } catch (error) {
      console.log('==Catch error', error);
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
          // Best-effort cleanup; the original connection error is more useful.
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
          : error instanceof Error && error.message.includes('Verity Sense')
            ? error.message
            : 'CONNECTION FAILED — CHECK THE POLAR DEVICE IS ON, WORN, AND NOT CONNECTED TO ANOTHER APP',
      );
    }
  };

  const disconnectPolar = () => {
    const device = bluetoothDeviceRef.current;
    const characteristic = characteristicRef.current;
    const pmdControl = pmdControlRef.current;
    const pmdData = pmdDataRef.current;

    try {
      if (characteristic) {
        characteristic.removeEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
      }

      if (pmdData) {
        pmdData.removeEventListener('characteristicvaluechanged', handlePpiMeasurement);
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
    }
  };

  /* ---------------------------------------------------------------- *
   * Demo mode
   *
   * Clearly labelled as simulated, and deliberately injects the same class of
   * artifact the real device produces so the filter can be seen working. Safe
   * to delete outright — nothing else depends on it.
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

      // A misplaced detection: elapsed time is preserved across the pair,
      // exactly as observed in the recorded H10 logs.
      const shift = 180 + Math.random() * 120;
      ingestBeat(rr - shift, now, true);
      ingestBeat(rr + shift, now, true);
      return;
    }

    ingestBeat(rr, now, true);
  }, [ingestBeat]);

  const toggleDemo = () => {
    if (demoMode) {
      if (simulationRef.current) clearInterval(simulationRef.current);
      simulationRef.current = null;

      setDemoMode(false);
      setConnected(false);
      setDeviceName('');
      resetSession();

      return;
    }

    resetSession();
    demoStateRef.current = { phase: 0, beatsUntilArtifact: 25 };
    recorderRef.current.start('demo', 'SIMULATED DEVICE', Date.now());

    setDemoMode(true);
    setConnected(true);
    setDeviceName('SIMULATED DEVICE');
    setErrorMessage('');

    simulationRef.current = setInterval(pushSimulatedReading, 900);
  };

  const exportRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (recorder.isEmpty) {
      setExportNote('NOTHING RECORDED YET — CONNECT AND WEAR THE STRAP FIRST');
      return;
    }

    // Build synchronously and hand straight to saveRecording. On iPadOS the
    // share sheet may only open while the tap that triggered it is still the
    // live user gesture, and any await before that point forfeits it.
    const recording = recorder.build(APP_VERSION, DEFAULT_CONFIG, Date.now());
    const stats =
      `${recording.summary.beats} BEATS, ${Math.round(recording.durationMs / 1000)}s, ` +
      `${recording.summary.corrected} CORRECTED, ${recording.summary.rejected} REJECTED`;

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
            setExportNote(`COULD NOT SAVE — ${outcome.reason}. TRY "COPY LOG" INSTEAD.`);
        }
      })
      .catch((error) => {
        console.error(error);
        setExportNote('EXPORT FAILED — SEE BROWSER CONSOLE');
      });
  }, []);

  /**
   * Explicit escape hatch. If a browser blocks both the share sheet and the
   * download, the data can still be got out by pasting it somewhere.
   */
  const copyRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (recorder.isEmpty) {
      setExportNote('NOTHING RECORDED YET — CONNECT AND WEAR THE STRAP FIRST');
      return;
    }

    const recording = recorder.build(APP_VERSION, DEFAULT_CONFIG, Date.now());

    copyRecordingToClipboard(recording).then((ok) => {
      setExportNote(ok ? `COPIED ${recording.summary.beats} BEATS TO CLIPBOARD — PASTE INTO A MESSAGE` : 'CLIPBOARD BLOCKED BY BROWSER');
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

      // Auto-scaled. The previous version was hard-capped at 100ms, so every
      // inflated reading drew as a flat line across the top of the panel —
      // which is what the straight green line in the screenshots actually was.
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
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }

      const device = bluetoothDeviceRef.current;
      const pmdData = pmdDataRef.current;

      if (pmdData) {
        pmdData.removeEventListener('characteristicvaluechanged', handlePpiMeasurement);
      }

      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
        if (device.gatt?.connected) device.gatt.disconnect();
        bluetoothDeviceRef.current = null;
      }

      pmdControlRef.current = null;
      pmdDataRef.current = null;
    };
  }, [handleDeviceDisconnected]);

  /* ---------------------------------------------------------------- *
   * Derived display state
   * ---------------------------------------------------------------- */

  const { rmssd, sdnn, pnn50, avgRmssd60s, heartRate, quality, artifactRate } = snapshot;

  // Keep a fixed set of visible DOM rows. This avoids continuously prepending
  // and removing DOM nodes, which can cause stale painting on iPadOS/Bluefy.
  const visibleLogs = Array.from({ length: VISIBLE_LOG_ROWS }, (_, index) => logs[index] ?? null);

  /**
   * What the headline reads.
   *
   * The old version reported "STRONG RECOVERY" for anything at or above 40ms,
   * which meant an artifact-inflated 134ms displayed as excellent recovery in
   * green — the screen was most confident exactly when it was most wrong.
   * Nothing is claimed here unless the engine says the data supports it.
   */
  const status = (() => {
    if (!connected) return 'AWAITING SIGNAL';
    if (contactWarning) return 'NO SKIN CONTACT — WET THE STRAP';
    if (quality === 'poor') return 'SIGNAL POOR — ADJUST STRAP, SIT STILL';
    if (rmssd === null) return 'ACQUIRING CLEAN BEATS...';
    if (rmssd < 20) return 'LOW HRV — ELEVATED STRESS';
    if (rmssd < 40) return 'NOMINAL';
    return 'STRONG RECOVERY';
  })();

  const statusClass = (() => {
    if (!connected || rmssd === null) return 'tk-yellow';
    if (contactWarning || quality === 'poor') return 'tk-red';
    if (rmssd < 20) return 'tk-red';
    if (rmssd < 40) return 'tk-yellow';
    return 'tk-green';
  })();

  const num = (value: number | null, digits = 1) => (value !== null ? value.toFixed(digits) : '--');
  const artifactsTouched = snapshot.beatsCorrected + snapshot.beatsRejected;

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  return (
    <main className="hrv-live">
      <div className="terminal-header">
        <div>HRV.LIVE // BIOMETRIC FEED</div>

        <div>
          DEVICE SYNC:{' '}
          <b className={connected ? 'device-connected' : 'device-offline'}>
            {demoMode ? 'DEMO MODE' : connected ? 'CONNECTED' : 'OFFLINE'}
          </b>
        </div>

        <div>SYS_VER: 2.0.0 &nbsp;&nbsp; ACCESS: FREE</div>
      </div>

      <div className="ticker-tape">
        <div className="ticker-tape-inner">
          HR &lt;GO&gt; <span className="tk-white">{heartRate ?? '--'} BPM</span>
          &nbsp;|&nbsp; RMSSD &lt;GO&gt; <span className="tk-white">{num(rmssd)} MS</span>
          &nbsp;|&nbsp; SDNN &lt;GO&gt; <span className="tk-cyan">{num(sdnn)} MS</span>
          &nbsp;|&nbsp; pNN50 &lt;GO&gt; <span className="tk-cyan">{num(pnn50)} %</span>
          &nbsp;|&nbsp; SIGNAL &lt;GO&gt; <span className={QUALITY_CLASS[quality]}>{QUALITY_LABEL[quality]}</span>
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
                SIGNAL <span className={QUALITY_CLASS[quality]}>{QUALITY_LABEL[quality]}</span>
                <br />
                {artifactsTouched} / {snapshot.beatsSeen} BEATS FILTERED
                <br />
                <span className="tk-red">REC</span> {recordedBeats.toLocaleString()} LOGGED
              </div>
            ) : null}
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
                <div className="gauge-label">{rmssd !== null ? 'MILLISECONDS' : quality === 'poor' ? 'SIGNAL TOO NOISY' : 'ACQUIRING'}</div>
              </div>
            </div>

            <div className="watchlist">
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

              <div className="wl-row">
                <span className="wl-label">DELTA vs PREV</span>
                <span className={`wl-val ${delta === null ? '' : delta >= 0 ? 'tk-green' : 'tk-red'}`}>
                  {delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ms` : '-- ms'}
                </span>
              </div>

              <div className="wl-row">
                <span className="wl-label">SIGNAL QUALITY</span>
                <span className={`wl-val ${QUALITY_CLASS[quality]}`}>
                  {QUALITY_LABEL[quality]} · {(artifactRate * 100).toFixed(1)}% FILTERED
                </span>
              </div>

              <div className="wl-row">
                <span className="wl-label">CLEAN INTERVALS</span>
                <span className="wl-val tk-cyan">
                  {snapshot.validDiffs} / {Math.max(0, snapshot.windowSize - 1)}
                </span>
              </div>
            </div>

            <div className="graph-area">
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="panel ledger-box">
            <div className="panel-title">RR INTERVAL HISTORY LOG</div>

            <div className="log-stream">
              {' '}
              {/* ref removed */}
              {logs.length === 0 ? (
                <>
                  <div className="log-line">SYSTEM STATUS: IDLE...</div>
                  <div className="log-line">PORT SCAN OPEN: WEB_BLUETOOTH CHANNELS READY</div>
                  <div className="log-line">ARTIFACT FILTER: ARMED</div>
                  <div className="log-line">AWAITING POLAR PACKETS...</div>
                </>
              ) : (
                visibleLogs.map((log, index) => (
                  <div className="log-line" key={index}>
                    {log ? (
                      <>
                        <span>{log.timestamp}</span>
                        <span className={STATUS_CLASS[log.status]}>
                          {STATUS_MARK[log.status]} RR={log.raw}ms
                          {log.used !== null && log.used !== log.raw ? ` -> ${log.used}ms` : ''}
                        </span>
                        {log.note ? <span className="tk-yellow"> {log.note}</span> : null}
                        {log.demo ? ' (demo)' : ''}
                      </>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="control-dock">
        <button className="action-btn" onClick={connected && !demoMode ? disconnectPolar : connectPolar}>
          {connected && !demoMode ? '[ DISCONNECT FEED ]' : 'Connect Polar Hardware'}
        </button>

        <button className={`action-btn demo-btn ${demoMode ? 'demo-active' : ''}`} onClick={toggleDemo}>
          {demoMode ? '■ Stop Demo' : '▶ Preview Demo Data'}
        </button>

        <button
          className="action-btn"
          onClick={exportRecording}
          disabled={recordedBeats === 0}
          title="Download this session as a file you can send for analysis"
        >
          ⤓ SAVE SESSION LOG{recordedBeats > 0 ? ` (${recordedBeats.toLocaleString()})` : ''}
        </button>
        <button
          className="action-btn"
          onClick={copyRecording}
          disabled={recordedBeats === 0}
          title="Copy the session log as text, if saving a file is blocked"
        >
          ⧉ COPY LOG
        </button>

        <input
          type="text"
          className="cmd-line"
          readOnly
          value={
            demoMode
              ? 'COMMAND >> /ANALYZE /TREND=DEMO /FILTER=ON /DEVICE=SIMULATED_PREVIEW'
              : connected
                ? `COMMAND >> /ANALYZE /TREND=LIVE /FILTER=ON /DEVICE=${deviceName.toUpperCase()}`
                : 'COMMAND >> /ANALYZE /TREND=REALTIME /DEVICE=PENDING...'
          }
        />
      </div>

      <div className="fkey-bar">
        {(
          [
            ['F1', 'HELP', null],
            ['F2', 'ANALYZE', null],
            ['F3', 'ALERT SET', null],
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
