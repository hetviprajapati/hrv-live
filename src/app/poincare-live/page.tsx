'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './poincare.css';

type PlotPoint = {
  x: number;
  y: number;
  age: number;
};

export default function PoincarePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rrHistoryRef = useRef<number[]>([]);
  const plotPointsRef = useRef<PlotPoint[]>([]);

  const cleanCountRef = useRef(0);
  const totalCountRef = useRef(0);

  const lastAcceptedRRRef = useRef<number | null>(null);

  const [sd1, setSd1] = useState<number | null>(null);
  const [sd2, setSd2] = useState<number | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  const [cleanCount, setCleanCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [status, setStatus] = useState('Not connected');

  const [connected, setConnected] = useState(false);

  /*
   * ---------------------------------------------------------
   * MEDIAN
   * ---------------------------------------------------------
   */

  const median = useCallback((values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);

    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }, []);

  /*
   * ---------------------------------------------------------
   * ARTIFACT DETECTION
   * ---------------------------------------------------------
   */

  const isArtifact = useCallback(
    (newRR: number) => {
      const history = rrHistoryRef.current;

      if (history.length < 3) {
        return false;
      }

      const recentMedian = median(history.slice(-5));

      const deviation = Math.abs(newRR - recentMedian) / recentMedian;

      return deviation > 0.2;
    },
    [median],
  );

  /*
   * ---------------------------------------------------------
   * SD1 / SD2
   * ---------------------------------------------------------
   */

  const computeSD1SD2 = useCallback(() => {
    const history = rrHistoryRef.current;

    if (history.length < 4) {
      return {
        sd1: 0,
        sd2: 0,
      };
    }

    /*
     * SDNN / variance
     */

    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;

    const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;

    /*
     * Successive differences
     */

    const differences: number[] = [];

    for (let i = 1; i < history.length; i++) {
      differences.push(history[i] - history[i - 1]);
    }

    const differenceMean = differences.reduce((sum, value) => sum + value, 0) / differences.length;

    const differenceVariance = differences.reduce((sum, value) => sum + (value - differenceMean) ** 2, 0) / differences.length;

    const sdsd = Math.sqrt(differenceVariance);

    /*
     * SD1
     */

    const calculatedSd1 = sdsd / Math.sqrt(2);

    /*
     * SD2
     */

    const sd2Squared = 2 * variance - calculatedSd1 ** 2;

    const calculatedSd2 = sd2Squared > 0 ? Math.sqrt(sd2Squared) : 0;

    return {
      sd1: calculatedSd1,
      sd2: calculatedSd2,
    };
  }, []);

  /*
   * ---------------------------------------------------------
   * DRAW POINCARÉ PLOT
   * ---------------------------------------------------------
   */

  const drawPlot = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const parent = canvas.parentElement;

    if (!parent) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const width = parent.clientWidth;

    const height = parent.clientWidth;

    if (width <= 0 || height <= 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    const targetWidth = Math.round(width * dpr);

    const targetHeight = Math.round(height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;

      canvas.height = targetHeight;
    }

    canvas.style.width = `${width}px`;

    canvas.style.height = `${height}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    context.clearRect(0, 0, width, height);

    const plotPoints = plotPointsRef.current;

    /*
     * Waiting state
     */

    if (plotPoints.length < 2) {
      context.fillStyle = '#444';

      context.font = '13px monospace';

      context.fillText('Waiting for beats...', 16, height / 2);

      return;
    }

    /*
     * Determine plot range
     */

    const allValues = plotPoints.flatMap((point) => [point.x, point.y]);

    const min = Math.min(...allValues) - 20;

    const max = Math.max(...allValues) + 20;

    const range = Math.max(1, max - min);

    /*
     * Identity line
     *
     * x = y
     */

    context.strokeStyle = '#222';

    context.lineWidth = 1;

    context.beginPath();

    context.moveTo(0, height);

    context.lineTo(width, 0);

    context.stroke();

    /*
     * Plot points
     */

    plotPoints.forEach((point) => {
      const x = ((point.x - min) / range) * width;

      const y = height - ((point.y - min) / range) * height;

      const alpha = Math.max(0.15, 1 - point.age / 200);

      context.fillStyle = `rgba(255, 174, 92, ${alpha})`;

      context.beginPath();

      context.arc(x, y, 2.5, 0, Math.PI * 2);

      context.fill();

      point.age++;
    });

    /*
     * Keep maximum 200 points
     */

    if (plotPoints.length > 200) {
      plotPointsRef.current = plotPoints.slice(-200);
    }
  }, []);

  /*
   * ---------------------------------------------------------
   * POLAR H10 CONNECTION
   * ---------------------------------------------------------
   */

  const connectPolar = async () => {
    if (!(navigator as any).bluetooth) {
      setStatus('Web Bluetooth unavailable — use Chrome on desktop/Android, or Bluefy on iOS.');

      return;
    }

    try {
      setStatus('Pairing...');

      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          {
            services: ['heart_rate'],
          },
        ],
        optionalServices: ['heart_rate'],
      });

      if (!device.gatt) {
        throw new Error('Bluetooth GATT unavailable.');
      }

      const server = await device.gatt.connect();

      const service = await server.getPrimaryService('heart_rate');

      const characteristic = await service.getCharacteristic('heart_rate_measurement');

      await characteristic.startNotifications();

      setConnected(true);

      setStatus(`Connected: ${device.name || 'chest strap'}`);

      /*
       * Receive heart-rate packets
       */

      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const target = event.target as any;

        const payload = target.value;

        if (!payload) {
          return;
        }

        const flags = payload.getUint8(0);

        const is16Bit = Boolean(flags & 0x01);

        const offset = is16Bit ? 3 : 2;

        /*
         * Packet doesn't contain RR
         * intervals.
         */

        if (!(flags & 0x10)) {
          return;
        }

        /*
         * There can be multiple RR
         * intervals in one packet.
         */

        for (let i = offset; i < payload.byteLength; i += 2) {
          const rawRr = payload.getUint16(i, true);

          const rrMilliseconds = Math.round((rawRr / 1024) * 1000);

          totalCountRef.current++;

          const currentTotal = totalCountRef.current;

          /*
           * Artifact rejection
           */

          if (isArtifact(rrMilliseconds)) {
            setTotalCount(currentTotal);

            setCleanCount(cleanCountRef.current);

            return;
          }

          /*
           * Accept RR
           */

          cleanCountRef.current++;

          const currentClean = cleanCountRef.current;

          /*
           * Create Poincaré point
           *
           * X = RRn
           * Y = RRn+1
           */

          const lastAccepted = lastAcceptedRRRef.current;

          if (lastAccepted !== null) {
            plotPointsRef.current.push({
              x: lastAccepted,
              y: rrMilliseconds,
              age: 0,
            });
          }

          lastAcceptedRRRef.current = rrMilliseconds;

          /*
           * Store RR history
           */

          rrHistoryRef.current.push(rrMilliseconds);

          if (rrHistoryRef.current.length > 200) {
            rrHistoryRef.current.shift();
          }

          /*
           * Calculate SD1 / SD2
           */

          const { sd1: calculatedSd1, sd2: calculatedSd2 } = computeSD1SD2();

          setSd1(calculatedSd1);

          setSd2(calculatedSd2);

          setRatio(calculatedSd2 > 0 ? calculatedSd1 / calculatedSd2 : null);

          /*
           * Update signal quality
           */

          setTotalCount(currentTotal);

          setCleanCount(currentClean);
        }
      });
    } catch (error) {
      console.error(error);

      setStatus('Connection failed or cancelled.');

      setConnected(false);
    }
  };

  /*
   * ---------------------------------------------------------
   * CANVAS RENDER LOOP
   * ---------------------------------------------------------
   */

  useEffect(() => {
    let animationFrame = 0;

    const render = () => {
      drawPlot();

      animationFrame = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [drawPlot]);

  /*
   * ---------------------------------------------------------
   * RESIZE
   * ---------------------------------------------------------
   */

  useEffect(() => {
    const handleResize = () => {
      drawPlot();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [drawPlot]);

  /*
   * ---------------------------------------------------------
   * SIGNAL QUALITY
   * ---------------------------------------------------------
   */

  const signalQuality = totalCount > 0 ? `${Math.round((cleanCount / totalCount) * 100)}%` : '--';

  return (
    <main className="poincare-page">
      <div className="poincare-wrap">
        {/* HEADER */}

        <header className="poincare-header">
          <div className="poincare-brand">POINCARE.LIVE</div>

          <nav>
            <a href="https://hrv.live" target="_blank" rel="noopener noreferrer">
              HRV.live
            </a>

            <a href="https://breathingrate.live" target="_blank" rel="noopener noreferrer">
              BreathingRate.live
            </a>

            <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
              rmssd.com
            </a>
          </nav>
        </header>

        {/* HERO */}

        <div className="poincare-hero">
          <h1>Watch your Poincaré plot build, beat by beat.</h1>

          <p className="poincare-sub">
            Each heartbeat plots one dot — this RR interval against the next. The shape of the cloud is your autonomic state, live: tight
            and narrow under stress, wide and open when relaxed.
          </p>
        </div>

        {/* STAGE */}

        <div className="poincare-stage">
          {/* PLOT */}

          <div className="poincare-panel">
            <div className="poincare-panel-title">LIVE POINCARÉ PLOT — RRₙ vs RRₙ₊₁</div>

            <div className="plot-wrapper">
              <canvas ref={canvasRef} />
            </div>

            <div className="axis-label">X: RRₙ (ms) &nbsp;·&nbsp; Y: RRₙ₊₁ (ms)</div>
          </div>

          {/* STATS */}

          <div className="stats-col">
            <div className="stat-block">
              <div className="stat-label">SD1 (SHORT-TERM, MS)</div>

              <div className="stat-value">{sd1 !== null ? sd1.toFixed(1) : '--'}</div>
            </div>

            <div className="stat-block">
              <div className="stat-label">SD2 (LONG-TERM, MS)</div>

              <div className="stat-value">{sd2 !== null ? sd2.toFixed(1) : '--'}</div>
            </div>

            <div className="stat-block">
              <div className="stat-label">SD1/SD2 RATIO</div>

              <div className="stat-value">{ratio !== null ? ratio.toFixed(2) : '--'}</div>
            </div>

            <div className="stat-block">
              <div className="stat-label">SIGNAL QUALITY</div>

              <div className="stat-value">{signalQuality}</div>

              <div className="quality-row">
                <span>{cleanCount}</span>/<span>{totalCount}</span> beats clean
              </div>
            </div>

            <button className="poincare-btn" onClick={connectPolar} disabled={connected}>
              {connected ? 'Connected' : 'Connect Polar H10'}
            </button>

            <div className="status-line">{status}</div>
          </div>
        </div>

        {/* EXPLAINER */}

        <div className="explainer">
          <b>What SD1 and SD2 mean:</b> SD1 is the width of the cloud — beat-to-beat variability, closely related to RMSSD and
          parasympathetic tone. SD2 is the length of the cloud — longer-term variability across the whole session. A tight, narrow cloud
          (low SD1) generally reflects sympathetic dominance — stress, load. A wide, open cloud (higher SD1) generally reflects
          parasympathetic recovery.
        </div>

        {/* CROSS SELL */}

        <div className="cross-sell">
          This is the same live RR feed as{' '}
          <a href="https://hrv.live" target="_blank" rel="noopener noreferrer">
            hrv.live
          </a>
          , plotted a different way. See the single-number RMSSD dial instead, or run both side by side.
        </div>

        {/* FOOTER */}

        <footer>
          poincare.live is an educational and informational tool, not a medical device. Not FDA cleared or approved. Not intended to
          diagnose, treat, or prevent any condition. Consult a physician for medical concerns.
          <br />
          <br />
          Part of the Live Health Platform:{' '}
          <a href="https://hrv.live" target="_blank" rel="noopener noreferrer">
            hrv.live
          </a>{' '}
          ·{' '}
          <a href="https://breathingrate.live" target="_blank" rel="noopener noreferrer">
            breathingrate.live
          </a>{' '}
          ·{' '}
          <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
            rmssd.com
          </a>
        </footer>
      </div>
    </main>
  );
}
