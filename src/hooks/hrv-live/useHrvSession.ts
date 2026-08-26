import { useCallback, useRef, useState } from 'react';
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
import { formatTimestamp } from '@/utils/hrv-live/hrv-display';
import { PACKET_GAP_MS, parsePpiMeasurement } from '@/utils/hrv-live/polar';
import type { LogEntry } from '@/app/types';

const BEAT_CLOCK_RESYNC_MS = 1500;
const MAX_TRACE_POINTS = 60;
const APP_VERSION = '3.0.0';
const VISIBLE_LOG_ROWS = HRV_CONFIG.windowBeats;

export function useHrvSession() {
  const hrvRef = useRef<HrvState>(createHrvState());
  const recorderRef = useRef<SessionRecorder>(new SessionRecorder());
  const lastPacketAtRef = useRef<number | null>(null);
  const lastPpiPacketAtRef = useRef<number | null>(null);
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

      if (gapDetected) beatClockRef.current = null;
      lastPacketAtRef.current = now;

      recorderRef.current.addPacket(
        view,
        measurement.bpm,
        measurement.rrIntervals,
        measurement.sensorContact,
        gapDetected,
        now,
      );

      if (measurement.rrIntervals.length === 0) {
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

      if (gapDetected) beatClockRef.current = null;
      lastPpiPacketAtRef.current = now;

      const usable = samples.filter(
        (sample) => !sample.blocker && !(sample.skinContactSupported && !sample.skinContact),
      );

      const hasSupportedContact = samples.some((sample) => sample.skinContactSupported);
      const hasNoContact = samples.some(
        (sample) => sample.skinContactSupported && !sample.skinContact,
      );
      setContactWarning(hasSupportedContact && hasNoContact);

      const withHr = usable.filter((sample) => sample.heartRate > 0);
      const averageHr =
        withHr.length > 0
          ? Math.round(withHr.reduce((sum, sample) => sum + sample.heartRate, 0) / withHr.length)
          : 0;

      if (averageHr > 0) {
        setSnapshot((current) => ({ ...current, heartRate: averageHr }));
      }

      recorderRef.current.addPacket(
        view,
        averageHr,
        samples.map((sample) => sample.ppIntervalMs),
        hasNoContact
          ? 'supported-no-contact'
          : hasSupportedContact
            ? 'supported-contact'
            : 'unsupported',
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

  const exportRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (recorder.isEmpty) {
      setExportNote('NOTHING RECORDED YET — CONNECT AND WEAR THE SENSOR FIRST');
      return;
    }

    const recording = recorder.build(APP_VERSION, HRV_CONFIG, Date.now());
    const stats =
      `${recording.summary.beats} BEATS, ${Math.round(recording.durationMs / 1000)}s, ` +
      `${recording.summary.flagged} FLAGGED`;

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

  return {
    connected,
    demoMode,
    deviceName,
    errorMessage,
    contactWarning,
    exportNote,
    recordedBeats,
    snapshot,
    delta,
    traceData,
    logs,
    setConnected,
    setDemoMode,
    setDeviceName,
    setErrorMessage,
    recorderRef,
    resetSession,
    teardownConnection,
    ingestIntervals,
    handleHeartRateMeasurement,
    handlePpiMeasurement,
    exportRecording,
  };
}
