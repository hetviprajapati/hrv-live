import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { SessionRecorder } from '@/lib/hrv-live/session-recorder';

export function useDemoMode({
  ingestIntervals,
  resetSession,
  recorderRef,
  setDemoMode,
  setConnected,
  setDeviceName,
  setErrorMessage,
}: {
  ingestIntervals: (intervals: number[], now: number, demo: boolean) => void;
  resetSession: () => void;
  recorderRef: MutableRefObject<SessionRecorder>;
  setDemoMode: Dispatch<SetStateAction<boolean>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setDeviceName: Dispatch<SetStateAction<string>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
}) {
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoStateRef = useRef({ phase: 0, beatsUntilArtifact: 25 });

  const pushSimulatedReading = useCallback(() => {
    const state = demoStateRef.current;
    const now = Date.now();

    const baseRr = 880 + Math.sin(now / 12000) * 40;
    state.phase += (2 * Math.PI * baseRr) / 5000;

    const rsa = Math.sin(state.phase) * 34;
    const noise = (Math.random() - 0.5) * 16;
    const rr = baseRr + rsa + noise;

    state.beatsUntilArtifact -= 1;

    if (state.beatsUntilArtifact <= 0) {
      state.beatsUntilArtifact = 20 + Math.floor(Math.random() * 25);
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
  }, [ingestIntervals, pushSimulatedReading, recorderRef, resetSession, setConnected, setDeviceName, setDemoMode, setErrorMessage]);

  const stopDemo = useCallback(() => {
    if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
    setDemoMode(false);
  }, [setDemoMode]);

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

  return { startDemo, stopDemo };
}
