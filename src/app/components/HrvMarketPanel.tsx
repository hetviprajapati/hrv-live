import type { RefObject } from 'react';
import type { HrvSnapshot } from '@/lib/hrv-live/hrv-engine';

export function HrvMarketPanel({
  snapshot,
  delta,
  signalLabel,
  signalClass,
  canvasRef,
}: {
  snapshot: HrvSnapshot;
  delta: number | null;
  signalLabel: string;
  signalClass: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const { rmssd, sdnn, pnn50, avgRmssd, heartRate, artifactRate } = snapshot;

  return (
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
            <span className="wl-label">5MIN AVG RMSSD</span>
            <span className="wl-val tk-yellow">{avgRmssd !== null ? `${avgRmssd.toFixed(1)} ms` : '-- ms'}</span>
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
      <span className="graph-area-declaimer">
        hrv.live, rmssd.com, and Time Domain Labs tools are for informational and educational purposes only. Not a medical device. Not FDA
        cleared or approved. No medical advice is provided.
      </span>
    </div>
  );
}
