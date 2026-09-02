'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import './page.css';
import { HRV_CONFIG } from '@/lib/hrv-live/hrv-engine';
import { TerminalHeader } from './components/TerminalHeader';
import { TickerTape } from './components/TickerTape';
import { SourceVectorPanel } from './components/SourceVectorPanel';
import { HrvMarketPanel } from './components/HrvMarketPanel';
import { RrHistoryLog } from './components/RrHistoryLog';
import { FunctionKeyBar } from './components/FunctionKeyBar';
import { useHrvSession } from '@/hooks/hrv-live/useHrvSession';
import { useDemoMode } from './../hooks/hrv-live/useDemoMode';
import { usePolarBluetooth } from './../hooks/hrv-live/usePolarBluetooth';
import { useHrvChart } from '@/hooks/hrv-live/useHrvChart';
import { qualityClass, qualityLabel } from './../utils/hrv-live/hrv-display';
import { SiteHeader } from './components/shared/SiteHeader/SiteHeader';
import { Hero } from './components/shared/HeroSection/Hero';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',

  name: 'HRV.live',

  url: 'https://hrv.live',

  description:
    'A browser-based live heart rate variability measurement tool providing real-time RMSSD, SDNN, pNN50, heart rate, and RR interval data.',

  applicationCategory: 'HealthApplication',

  operatingSystem: 'Web Browser',

  browserRequirements: 'Requires a browser with Web Bluetooth support and a compatible heart rate sensor.',

  isPartOf: {
    '@type': 'WebSite',
    name: 'HRV.live',
    url: 'https://hrv.live',
  },
};

const VISIBLE_LOG_ROWS = HRV_CONFIG.windowBeats;

export default function HrvLivePage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const session = useHrvSession();

  const {
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
  } = session;

  const { startDemo, stopDemo } = useDemoMode({
    ingestIntervals,
    resetSession,
    recorderRef,
    setDemoMode,
    setConnected,
    setDeviceName,
    setErrorMessage,
  });

  const { connectPolar, disconnectPolar } = usePolarBluetooth({
    resetSession,
    teardownConnection,
    startDemo,
    stopDemo,
    handleHeartRateMeasurement,
    handlePpiMeasurement,
    recorderRef,
    setConnected,
    setDemoMode,
    setDeviceName,
    setErrorMessage,
  });

  useHrvChart({ canvasRef, traceData, connected });

  const { rmssd, sdnn, pnn50, heartRate, artifactRate, ready } = snapshot;

  const signalLabel = qualityLabel(artifactRate, ready);
  const signalClass = qualityClass(artifactRate, ready);
  const visibleLogs = Array.from({ length: VISIBLE_LOG_ROWS }, (_, index) => logs[index] ?? null);

  const status = (() => {
    if (!connected) return 'AWAITING SIGNAL';
    if (contactWarning) return 'NO SKIN CONTACT — CHECK THE SENSOR';
    if (rmssd === null) return 'ACQUIRING CLEAN BEATS...';
    if (rmssd < 20) return 'LOW HRV';
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

  const handleNavigateToAbout = () => router.push('/about');
  const handleNavigateToDevices = () => router.push('/devices');
  const handleNavigateToPoincare = () => router.push('/poincare-live');
  const handleNavigateToBreathingRate = () => router.push('/hrv-breathing-live');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        handleNavigateToAbout();
      } else if (event.key === 'F2') {
        event.preventDefault();
        handleNavigateToDevices();
      } else if (event.key === 'F3') {
        event.preventDefault();
        handleNavigateToPoincare();
      } else if (event.key === 'F4') {
        event.preventDefault();
        handleNavigateToBreathingRate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  return (
    <main className="hrv-main">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <div className="hrv-info-section">
        <SiteHeader activePage="hrv" />

        <Hero
          title="Watch your nervous system, live."
          description="Connect a Bluetooth chest strap to see your heart rhythm, heart rate, and RMSSD update beat-by-beat. A calmer, more recovered
          state is generally associated with higher, more variable rhythm"
        />
      </div>

      <div className="hrv-live">
        <TerminalHeader connected={connected} demoMode={demoMode} />

        <TickerTape
          heartRate={heartRate}
          rmssd={rmssd}
          sdnn={sdnn}
          pnn50={pnn50}
          signalLabel={signalLabel}
          signalClass={signalClass}
          status={status}
          statusClass={statusClass}
        />

        {exportNote ? (
          <div className="log-line tk-green" style={{ padding: '4px 10px' }}>
            {exportNote}
          </div>
        ) : null}

        <div className="workspace-scroll">
          <div className="workspace">
            <SourceVectorPanel
              connected={connected}
              demoMode={demoMode}
              deviceName={deviceName}
              snapshot={snapshot}
              recordedBeats={recordedBeats}
              signalLabel={signalLabel}
              signalClass={signalClass}
              onConnect={connectPolar}
              onDisconnect={disconnectPolar}
              onDevices={handleNavigateToDevices}
            />

            <HrvMarketPanel
              snapshot={snapshot}
              delta={delta}
              signalLabel={signalLabel}
              signalClass={signalClass}
              canvasRef={canvasRef}
              errorMessage={errorMessage}
            />

            <RrHistoryLog logs={logs} visibleLogs={visibleLogs} />
          </div>
        </div>

        <FunctionKeyBar
          onAbout={handleNavigateToAbout}
          onDevices={handleNavigateToDevices}
          onPoincare={handleNavigateToPoincare}
          onBreathingRate={handleNavigateToBreathingRate}
          onExport={exportRecording}
        />
      </div>
    </main>
  );
}
