import type { HrvSnapshot } from '@/lib/hrv-live/hrv-engine';
import { Button } from './shared/Button/Button';
import Link from 'next/link';

export function SourceVectorPanel({
  connected,
  demoMode,
  deviceName,
  snapshot,
  recordedBeats,
  signalLabel,
  signalClass,
  onConnect,
  onDisconnect,
}: {
  connected: boolean;
  demoMode: boolean;
  deviceName: string;
  snapshot: HrvSnapshot;
  recordedBeats: number;
  signalLabel: string;
  signalClass: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
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

      <Button onClick={connected && !demoMode ? onDisconnect : onConnect} className="connect-btn">
        {connected && !demoMode ? '[ DISCONNECT FEED ]' : 'Connect Polar Heart Rate Sensor'}
      </Button>

      <div className="other-device">
        <Link href="/devices" className="other-device-button">
          Other devices?
        </Link>
      </div>
    </div>
  );
}
