'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './page.css';

type SeriesPoint = {
  t: number;
  v: number;
};

type LogState = {
  connected: boolean;
  deviceName: string;
};

export default function LiveHrvBreathingPage() {
  // ---------------------------------------------------------
  // SHARED TIMELINE
  // ---------------------------------------------------------

  const sessionStartRef = useRef<number | null>(null);

  const [hrvSeries, setHrvSeries] = useState<SeriesPoint[]>([]);
  const [breathSeries, setBreathSeries] = useState<SeriesPoint[]>([]);

  const ensureSessionStarted = useCallback(() => {
    if (sessionStartRef.current === null) {
      sessionStartRef.current = Date.now();
    }
  }, []);

  const elapsedSec = useCallback(() => {
    if (sessionStartRef.current === null) {
      return 0;
    }

    return (Date.now() - sessionStartRef.current) / 1000;
  }, []);

  // ---------------------------------------------------------
  // HRV / BLUETOOTH
  // ---------------------------------------------------------

  const [hrvState, setHrvState] = useState<LogState>({
    connected: false,
    deviceName: '',
  });

  const [heartRate, setHeartRate] = useState<number | null>(null);

  const [rmssd, setRmssd] = useState<number | null>(null);

  const [hrvStatus, setHrvStatus] = useState('Not connected');

  const rrHistoryRef = useRef<number[]>([]);

  const connectPolar = async () => {
    if (!(navigator as any).bluetooth) {
      setHrvStatus('Web Bluetooth unavailable — use Chrome on desktop/Android, or Bluefy on iOS.');

      return;
    }

    try {
      setHrvStatus('Pairing...');

      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          {
            services: ['heart_rate'],
          },
        ],
        optionalServices: ['heart_rate'],
      });

      if (!device.gatt) {
        throw new Error('Bluetooth GATT is unavailable.');
      }

      const server = await device.gatt.connect();

      const service = await server.getPrimaryService('heart_rate');

      const characteristic = await service.getCharacteristic('heart_rate_measurement');

      await characteristic.startNotifications();

      ensureSessionStarted();

      const name = device.name || 'chest strap';

      setHrvState({
        connected: true,
        deviceName: name,
      });

      setHrvStatus(`Connected: ${name}`);

      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const target = event.target as any;

        const payload = target.value;

        if (!payload) {
          return;
        }

        const flags = payload.getUint8(0);

        const is16Bit = Boolean(flags & 0x01);

        const offset = is16Bit ? 3 : 2;

        const bpm = is16Bit ? payload.getUint16(1, true) : payload.getUint8(1);

        setHeartRate(bpm);

        /*
         * RR interval is present.
         */

        if (!(flags & 0x10)) {
          return;
        }

        for (let i = offset; i < payload.byteLength; i += 2) {
          const rawRr = payload.getUint16(i, true);

          const rrMs = Math.round((rawRr / 1024) * 1000);

          rrHistoryRef.current.push(rrMs);

          if (rrHistoryRef.current.length > 40) {
            rrHistoryRef.current.shift();
          }

          /*
           * Calculate RMSSD.
           */

          let sumSq = 0;
          let count = 0;

          for (let k = 1; k < rrHistoryRef.current.length; k++) {
            const diff = rrHistoryRef.current[k] - rrHistoryRef.current[k - 1];

            sumSq += diff * diff;
            count++;
          }

          const calculatedRmssd = count > 0 ? Math.sqrt(sumSq / count) : 0;

          setRmssd(calculatedRmssd);

          /*
           * Add to shared timeline.
           */

          const point = {
            t: elapsedSec(),
            v: calculatedRmssd,
          };

          setHrvSeries((previous) => {
            const next = [...previous, point];

            if (next.length > 600) {
              next.shift();
            }

            return next;
          });
        }
      });
    } catch (error) {
      console.error(error);

      setHrvStatus('Connection failed or cancelled.');
    }
  };

  // ---------------------------------------------------------
  // BREATHING / CAMERA
  // ---------------------------------------------------------

  const videoRef = useRef<HTMLVideoElement>(null);

  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const camStreamRef = useRef<MediaStream | null>(null);

  const camStartTimeRef = useRef<number | null>(null);

  const luminanceBufferRef = useRef<SeriesPoint[]>([]);

  const breathCountRef = useRef(0);

  const lastCrossTimeRef = useRef(0);

  const lastSignRef = useRef(0);

  const [cameraRunning, setCameraRunning] = useState(false);

  const [breathStatus, setBreathStatus] = useState('Camera not started');

  const [breathCount, setBreathCount] = useState(0);

  const [breathRate, setBreathRate] = useState<number | null>(null);

  const MIN_BREATH_SPACING_MS = 1500;
  const ROLLING_WINDOW_MS = 4000;

  const sampleFrame = useCallback(() => {
    const video = videoRef.current;

    const canvas = hiddenCanvasRef.current;

    if (!video || !canvas) {
      return;
    }

    if (!video.videoWidth) {
      return;
    }

    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    });

    if (!context) {
      return;
    }

    /*
     * Same ROI as the original HTML:
     *
     * x = 25%
     * y = 20%
     * width = 50%
     * height = 45%
     */

    const sx = video.videoWidth * 0.25;

    const sy = video.videoHeight * 0.2;

    const sw = video.videoWidth * 0.5;

    const sh = video.videoHeight * 0.45;

    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;

    /*
     * Calculate average luminance.
     */

    let sum = 0;

    for (let i = 0; i < frame.length; i += 4) {
      sum += 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
    }

    const pixelCount = frame.length / 4;

    const avgLuminance = sum / pixelCount;

    const now = Date.now();

    /*
     * Store luminance history.
     */

    luminanceBufferRef.current.push({
      t: now,
      v: avgLuminance,
    });

    luminanceBufferRef.current = luminanceBufferRef.current.filter((point) => now - point.t < 10000);

    /*
     * Rolling average.
     */

    const rollingPoints = luminanceBufferRef.current.filter((point) => now - point.t < ROLLING_WINDOW_MS);

    const rollingAvg = rollingPoints.length ? rollingPoints.reduce((sum, point) => sum + point.v / rollingPoints.length, 0) : avgLuminance;

    const detrended = avgLuminance - rollingAvg;

    /*
     * Detect direction change.
     */

    const sign = detrended > 0.15 ? 1 : detrended < -0.15 ? -1 : 0;

    if (sign !== 0 && sign !== lastSignRef.current) {
      if (sign === 1 && now - lastCrossTimeRef.current > MIN_BREATH_SPACING_MS) {
        breathCountRef.current += 1;

        lastCrossTimeRef.current = now;

        setBreathCount(breathCountRef.current);
      }

      lastSignRef.current = sign;
    }

    /*
     * Calculate breathing rate after
     * the first 8 seconds.
     */

    const camStart = camStartTimeRef.current;

    if (!camStart) {
      return;
    }

    const elapsedMs = now - camStart;

    if (elapsedMs > 8000) {
      const calculatedBpm = breathCountRef.current / (elapsedMs / 60000);

      setBreathRate(calculatedBpm);

      const point = {
        t: elapsedSec(),
        v: calculatedBpm,
      };

      setBreathSeries((previous) => {
        const next = [...previous, point];

        if (next.length > 600) {
          next.shift();
        }

        return next;
      });
    }
  }, [elapsedSec]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
        },
        audio: false,
      });

      const video = videoRef.current;

      if (!video) {
        return;
      }

      camStreamRef.current = stream;

      video.srcObject = stream;

      await video.play();

      /*
       * Create hidden processing canvas.
       */

      if (!hiddenCanvasRef.current) {
        const canvas = document.createElement('canvas');

        canvas.width = 64;
        canvas.height = 64;

        hiddenCanvasRef.current = canvas;
      }

      ensureSessionStarted();

      camStartTimeRef.current = Date.now();

      luminanceBufferRef.current = [];

      breathCountRef.current = 0;
      lastCrossTimeRef.current = 0;
      lastSignRef.current = 0;

      setBreathCount(0);
      setBreathRate(null);

      setBreathStatus('Tracking...');

      setCameraRunning(true);

      sampleIntervalRef.current = setInterval(sampleFrame, 100);
    } catch (error) {
      console.error(error);

      setBreathStatus('Camera access denied or unavailable.');
    }
  };

  // ---------------------------------------------------------
  // COMBINED CHART
  // ---------------------------------------------------------

  const combinedCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = combinedCanvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext('2d');

    if (!context) return;

    const drawChart = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (!width || !height) return;

      const dpr = window.devicePixelRatio || 1;

      /*
       * Only update the internal canvas resolution.
       */
      const targetWidth = Math.round(width * dpr);
      const targetHeight = Math.round(height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      context.clearRect(0, 0, width, height);

      /*
       * Waiting state.
       */
      if (hrvSeries.length < 2 && breathSeries.length < 2) {
        context.fillStyle = '#444';
        context.font = '13px monospace';

        context.fillText('Waiting for data from either panel above...', 16, height / 2);

        return;
      }

      /*
       * Determine timeline.
       */
      const latestHrv = hrvSeries.length ? hrvSeries[hrvSeries.length - 1].t : 0;

      const latestBreath = breathSeries.length ? breathSeries[breathSeries.length - 1].t : 0;

      const maxT = Math.max(latestHrv, latestBreath, 30);

      const windowStart = Math.max(0, maxT - 120);

      /*
       * Plot series.
       */
      const plotSeries = (series: SeriesPoint[], color: string, minV: number, maxV: number) => {
        const visible = series.filter((point) => point.t >= windowStart);

        if (visible.length < 2) return;

        context.strokeStyle = color;
        context.lineWidth = 2;

        context.beginPath();

        visible.forEach((point, index) => {
          const x = ((point.t - windowStart) / Math.max(1, maxT - windowStart)) * width;

          const normalized = (point.v - minV) / Math.max(1, maxV - minV);

          const y = height - 10 - normalized * (height - 20);

          if (index === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        });

        context.stroke();
      };

      /*
       * Visible values.
       */
      const hrvVisible = hrvSeries.filter((point) => point.t >= windowStart).map((point) => point.v);

      const breathVisible = breathSeries.filter((point) => point.t >= windowStart).map((point) => point.v);

      /*
       * Scales.
       */
      const hrvMin = hrvVisible.length ? Math.min(...hrvVisible) - 5 : 0;

      const hrvMax = hrvVisible.length ? Math.max(...hrvVisible) + 5 : 100;

      const breathMin = breathVisible.length ? Math.min(...breathVisible) - 2 : 0;

      const breathMax = breathVisible.length ? Math.max(...breathVisible) + 2 : 30;

      /*
       * Draw both lines.
       */
      plotSeries(hrvSeries, '#ff9c2b', hrvMin, hrvMax);

      plotSeries(breathSeries, '#2dd9c8', breathMin, breathMax);
    };

    /*
     * Initial draw.
     */
    drawChart();

    /*
     * Only redraw when the browser window changes size.
     */
    window.addEventListener('resize', drawChart);

    return () => {
      window.removeEventListener('resize', drawChart);
    };
  }, [hrvSeries, breathSeries]);

  // ---------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------

  useEffect(() => {
    return () => {
      if (sampleIntervalRef.current) {
        clearInterval(sampleIntervalRef.current);
      }

      if (camStreamRef.current) {
        camStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ---------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------

  return (
    <div className="breathing-live-wrap">
      {/* HEADER */}

      <header>
        <div className="brand">TIME DOMAIN LABS</div>

        <nav>
          <a href="https://hrv.live" target="_blank" rel="noopener noreferrer">
            HRV.live
          </a>

          <a href="https://hrv.live/poincare-live" target="_blank" rel="noopener noreferrer">
            Poincare.live
          </a>

          <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
            rmssd.com
          </a>
        </nav>
      </header>

      {/* HERO */}

      <div className="hero">
        <h1>Watch your breathing and heart respond to each other, live.</h1>

        <p className="sub">
          Connect your chest strap on the left, start your camera on the right. Both run independently and both feed the timeline below — so
          you can watch your HRV move as your breathing slows down, in the same window, in real time.
        </p>
      </div>

      {/* DUAL PANELS */}

      <div className="dual">
        {/* HRV */}

        <div className="panel hrv">
          <div className="panel-title">HRV — LIVE (BLUETOOTH CHEST STRAP)</div>

          <div className="heart-vector">
            <svg className={hrvState.connected ? 'active' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>

          <div className="gauge-row">
            <div className="gauge">
              <div className="gauge-label">HEART RATE</div>

              <div className="gauge-value">{heartRate ?? '--'}</div>
            </div>

            <div className="gauge">
              <div className="gauge-label">RMSSD (MS)</div>

              <div className="gauge-value">{rmssd !== null ? rmssd.toFixed(1) : '--'}</div>
            </div>
          </div>

          <button className="btn hrv-btn" onClick={connectPolar} disabled={hrvState.connected}>
            {hrvState.connected ? 'Connected' : 'Connect Polar H10'}
          </button>

          <div className="status-line">{hrvStatus}</div>
        </div>

        {/* BREATHING */}

        <div className="panel breath">
          <div className="panel-title">BREATHING — LIVE (CAMERA)</div>

          <div className="video-box">
            <video ref={videoRef} autoPlay playsInline muted />

            <div
              className="roi-box"
              style={{
                display: cameraRunning ? 'block' : 'none',
              }}
            />

            {!cameraRunning && <div className="camera-placeholder">Camera not started. Sit back so your chest is visible.</div>}
          </div>

          <div className="gauge-row">
            <div className="gauge">
              <div className="gauge-label">BREATHS DETECTED</div>

              <div className="gauge-value">{breathCount}</div>
            </div>

            <div className="gauge">
              <div className="gauge-label">RATE (BPM)</div>

              <div className="gauge-value">{breathRate !== null ? breathRate.toFixed(1) : '--'}</div>
            </div>
          </div>

          <button className="btn breath-btn" onClick={startCamera} disabled={cameraRunning}>
            {cameraRunning ? 'Camera Running' : 'Start Camera'}
          </button>

          <div className="status-line">{breathStatus}</div>
        </div>
      </div>

      {/* COMBINED CHART */}

      <div className="combined-panel">
        <canvas ref={combinedCanvasRef} />

        <div className="legend">
          <span>
            <span className="dot orange" />
            HRV (RMSSD, ms)
          </span>

          <span>
            <span className="dot teal" />
            Breathing rate (bpm)
          </span>
        </div>
      </div>

      {/* INSIGHT */}

      <div className="insight">
        <b>What to watch for:</b> as your breathing rate line (teal) drops and steadies, your HRV line (orange) typically climbs — this is a
        real, well-documented effect called respiratory sinus arrhythmia. Try a slow box-breathing pattern (4s in, 4s hold, 4s out) and
        watch both lines move together over the next minute or two.
      </div>

      {/* FOOTER */}

      <footer>
        Educational tools, not medical devices. Not intended to diagnose, treat, or monitor any condition. Consult a physician for medical
        concerns.
        <br />
        <br />
        Part of the TIME DOMAIN LABS:{' '}
        <a href="https://hrv.live" target="_blank" rel="noopener noreferrer">
          hrv.live
        </a>{' '}
        ·{' '}
        <a href="https://hrv.live/poincare-live" className="teal" target="_blank" rel="noopener noreferrer">
          Poincare.live
        </a>{' '}
        ·{' '}
        <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
          rmssd.com
        </a>
      </footer>
    </div>
  );
}
