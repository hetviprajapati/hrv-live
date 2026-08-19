'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './page.css';

type LogEntry = {
  timestamp: string;
  rr: number;
  demo?: boolean;
};

export default function HrvLivePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rrHistoryRef = useRef<number[]>([]);
  const rmssdHistoryRef = useRef<number[]>([]);
  const lastRmssdRef = useRef<number | null>(null);

  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [deviceName, setDeviceName] = useState('');

  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [rmssd, setRmssd] = useState<number | null>(null);
  const [sdnn, setSdnn] = useState<number | null>(null);
  const [pnn50, setPnn50] = useState<number | null>(null);
  const [avgRmssd, setAvgRmssd] = useState<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);

  const [traceData, setTraceData] = useState<number[]>([]);

  const [logs, setLogs] = useState<LogEntry[]>([
    {
      timestamp: '',
      rr: 0,
    },
  ]);

  /*
   * ---------------------------------------------------------
   * RMSSD CALCULATION
   * ---------------------------------------------------------
   */

  const calculateRmssd = useCallback((rrValues: number[]) => {
    if (rrValues.length < 2) {
      return 0;
    }

    let sumSq = 0;

    for (let i = 1; i < rrValues.length; i++) {
      const difference = rrValues[i] - rrValues[i - 1];

      sumSq += difference * difference;
    }

    return Math.sqrt(sumSq / (rrValues.length - 1));
  }, []);

  /*
   * ---------------------------------------------------------
   * TIMESTAMP
   * ---------------------------------------------------------
   */

  const formatTimestamp = () => {
    const date = new Date();

    return date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  /*
   * ---------------------------------------------------------
   * UPDATE METRICS
   * ---------------------------------------------------------
   */

  const updateExtendedMetrics = useCallback((currentRmssd: number, bpm: number, rr: number, demo = false) => {
    const calculatedSdnn = currentRmssd * 0.9;

    const calculatedPnn50 = Math.min(45, Math.max(2, currentRmssd / 2));

    rmssdHistoryRef.current.push(currentRmssd);

    if (rmssdHistoryRef.current.length > 60) {
      rmssdHistoryRef.current.shift();
    }

    const average = rmssdHistoryRef.current.reduce((sum, value) => sum + value, 0) / rmssdHistoryRef.current.length;

    const previousRmssd = lastRmssdRef.current;

    setHeartRate(bpm);
    setRmssd(currentRmssd);
    setSdnn(calculatedSdnn);
    setPnn50(calculatedPnn50);
    setAvgRmssd(average);

    if (previousRmssd !== null) {
      setDelta(currentRmssd - previousRmssd);
    }

    lastRmssdRef.current = currentRmssd;

    /*
     * Chart data
     */

    setTraceData((previous) => {
      const next = [...previous, currentRmssd];

      if (next.length > 60) {
        next.shift();
      }

      return next;
    });

    /*
     * RR log
     */

    setLogs((previous) => {
      const next: LogEntry[] = [
        {
          timestamp: formatTimestamp(),
          rr,
          demo,
        },
        ...previous,
      ];

      return next.slice(0, 30);
    });
  }, []);

  /*
   * ---------------------------------------------------------
   * CANVAS GRAPH
   * ---------------------------------------------------------
   */

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

      const SCALE_MAX = 100;

      const padTop = 14;
      const padBottom = 14;

      const usableHeight = height - padTop - padBottom;

      /*
       * Reference gridlines
       */

      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;

      [25, 50, 75].forEach((mark) => {
        const y = padTop + usableHeight - (mark / SCALE_MAX) * usableHeight;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      });

      /*
       * Idle state
       */

      if (!connected || traceData.length === 0) {
        ctx.strokeStyle = '#3a2a10';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(0, height / 2);

        ctx.lineTo(width, height / 2);

        ctx.stroke();

        return;
      }

      /*
       * Create points
       */

      const points = traceData.map((value, index) => {
        const x = (index / Math.max(1, traceData.length - 1)) * width;

        const clamped = Math.max(0, Math.min(SCALE_MAX, value));

        const y = padTop + usableHeight - (clamped / SCALE_MAX) * usableHeight;

        return {
          x,
          y,
          value,
        };
      });

      /*
       * Line color based on latest value
       */

      const latest = points[points.length - 1].value;

      const lineColor = latest < 20 ? '#ff2a2a' : latest < 40 ? '#ffe14d' : '#3dff6e';

      /*
       * Draw line
       */

      ctx.strokeStyle = lineColor;

      ctx.lineWidth = 2;

      ctx.beginPath();

      points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });

      ctx.stroke();

      /*
       * Draw heartbeat dots
       */

      points.forEach((point, index) => {
        ctx.beginPath();

        ctx.arc(point.x, point.y, index === points.length - 1 ? 4 : 2.5, 0, Math.PI * 2);

        ctx.fillStyle = index === points.length - 1 ? '#fff' : lineColor;

        ctx.fill();
      });
    };

    draw();

    const resizeObserver = new ResizeObserver(draw);

    resizeObserver.observe(parent);

    return () => {
      resizeObserver.disconnect();
    };
  }, [traceData, connected]);

  /*
   * ---------------------------------------------------------
   * PROCESS HEART RATE
   * ---------------------------------------------------------
   */

  const processHeartRate = useCallback(
    (bpm: number, rr: number) => {
      rrHistoryRef.current.push(rr);

      if (rrHistoryRef.current.length > 40) {
        rrHistoryRef.current.shift();
      }

      const currentRmssd = calculateRmssd(rrHistoryRef.current);

      updateExtendedMetrics(currentRmssd, bpm, rr);
    },
    [calculateRmssd, updateExtendedMetrics],
  );

  /*
   * ---------------------------------------------------------
   * CONNECT POLAR H10
   * ---------------------------------------------------------
   */

  const connectPolar = async () => {
    if (!(navigator as any).bluetooth) {
      alert('Browser security blocks Web Bluetooth APIs. Please use Chrome, or Bluefy on iOS.');

      return;
    }

    try {
      /*
       * Find Polar device
       */

      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          {
            namePrefix: 'Polar',
          },
          {
            services: ['heart_rate'],
          },
        ],
      });

      /*
       * Connect GATT
       */

      const server = await device.gatt?.connect();

      if (!server) {
        throw new Error('Could not connect to device.');
      }

      /*
       * Heart Rate service
       */

      const service = await server.getPrimaryService('heart_rate');

      /*
       * Heart Rate characteristic
       */

      const characteristic = await service.getCharacteristic('heart_rate_measurement');

      await characteristic.startNotifications();

      /*
       * Connected
       */

      setConnected(true);
      setDemoMode(false);

      setDeviceName(device.name || 'POLAR DEVICE');

      setLogs([
        {
          timestamp: '',
          rr: 0,
        },
      ]);

      /*
       * Receive measurements
       */

      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const target = event.target as any;
        const payload = target.value;
        if (!payload) return;
        const flags = payload.getUint8(0);
        const is16Bit = Boolean(flags & 0x01);
        const offset = is16Bit ? 3 : 2;
        const bpm = is16Bit ? payload.getUint16(1, true) : payload.getUint8(1);

        /*
         * RR interval present
         */

        if (!(flags & 0x10)) {
          return;
        }

        for (let i = offset; i < payload.byteLength; i += 2) {
          const rawRr = payload.getUint16(i, true);
          const rrMs = Math.round((rawRr / 1024) * 1000);
          processHeartRate(bpm, rrMs);
        }
      });
    } catch (error) {
      console.error(error);
      setConnected(false);
    }
  };

  /*
   * ---------------------------------------------------------
   * DEMO MODE
   * ---------------------------------------------------------
   */

  const pushSimulatedReading = useCallback(() => {
    const baseHr = 68 + Math.round(Math.sin(Date.now() / 4000) * 6);
    const jitter = Math.round((Math.random() - 0.5) * 4);
    const bpm = baseHr + jitter;
    const baseRr = Math.round(60000 / bpm);
    const rr = baseRr + Math.round((Math.random() - 0.5) * 40);
    rrHistoryRef.current.push(rr);

    if (rrHistoryRef.current.length > 40) {
      rrHistoryRef.current.shift();
    }

    const currentRmssd = calculateRmssd(rrHistoryRef.current);
    updateExtendedMetrics(currentRmssd, bpm, rr, true);
  }, [calculateRmssd, updateExtendedMetrics]);

  const toggleDemo = () => {
    /*
     * Stop demo
     */

    if (demoMode) {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
      }

      simulationRef.current = null;

      setDemoMode(false);
      setConnected(false);
      setDeviceName('');

      return;
    }

    /*
     * Start demo
     */

    setDemoMode(true);
    setConnected(true);

    setDeviceName('SIMULATED DEVICE');

    setLogs([
      {
        timestamp: '',
        rr: 0,
        demo: true,
      },
    ]);

    simulationRef.current = setInterval(pushSimulatedReading, 900);
  };

  /*
   * ---------------------------------------------------------
   * CLEANUP
   * ---------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
      }
    };
  }, []);

  /*
   * ---------------------------------------------------------
   * STATUS
   * ---------------------------------------------------------
   */

  const status = rmssd === null ? 'AWAITING SIGNAL' : rmssd < 20 ? 'LOW HRV — ELEVATED STRESS' : rmssd < 40 ? 'NOMINAL' : 'STRONG RECOVERY';

  const statusClass = rmssd === null ? 'tk-yellow' : rmssd < 20 ? 'tk-red' : rmssd < 40 ? 'tk-yellow' : 'tk-green';

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  return (
    <main className="hrv-live">
      {/* Header */}

      <div className="terminal-header">
        <div>HRV.LIVE // BIOMETRIC FEED</div>

        <div>
          DEVICE SYNC:{' '}
          <b className={connected ? 'device-connected' : 'device-offline'}>
            {demoMode ? 'DEMO MODE' : connected ? 'CONNECTED' : 'OFFLINE'}
          </b>
        </div>

        <div>SYS_VER: 1.4.0 &nbsp;&nbsp; ACCESS: FREE</div>
      </div>

      {/* Ticker */}

      <div className="ticker-tape">
        <div className="ticker-tape-inner">
          HR &lt;GO&gt; <span className="tk-white">{heartRate ?? '--'} BPM</span>
          &nbsp;|&nbsp; RMSSD &lt;GO&gt; <span className="tk-white">{rmssd !== null ? rmssd.toFixed(1) : '--'} MS</span>
          &nbsp;|&nbsp; SDNN &lt;GO&gt; <span className="tk-cyan">{sdnn !== null ? sdnn.toFixed(1) : '--'} MS</span>
          &nbsp;|&nbsp; pNN50 &lt;GO&gt; <span className="tk-cyan">{pnn50 !== null ? pnn50.toFixed(1) : '--'} %</span>
          &nbsp;|&nbsp; STATUS &lt;GO&gt; <span className={statusClass}>{status}</span>
          &nbsp;|&nbsp; HR &lt;GO&gt; <span className="tk-white">{heartRate ?? '--'} BPM</span>
          &nbsp;|&nbsp; RMSSD &lt;GO&gt; <span className="tk-white">{rmssd !== null ? rmssd.toFixed(1) : '--'} MS</span>
          &nbsp;|&nbsp; SDNN &lt;GO&gt; <span className="tk-cyan">{sdnn !== null ? sdnn.toFixed(1) : '--'} MS</span>
          &nbsp;|&nbsp; pNN50 &lt;GO&gt; <span className="tk-cyan">{pnn50 !== null ? pnn50.toFixed(1) : '--'} %</span>
        </div>
      </div>

      {/* Workspace */}

      <div className="workspace-scroll">
        <div className="workspace">
          {/* Source Vector */}

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
              {connected ? deviceName : 'CONNECT POLAR H10'}
            </div>
          </div>

          {/* Main Data Panel */}

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

                <div className="gauge-label">MILLISECONDS</div>
              </div>
            </div>

            {/* Watchlist */}

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

                <span className="wl-val tk-yellow">{avgRmssd !== null ? `${avgRmssd.toFixed(1)} ms` : '-- ms'}</span>
              </div>

              <div className="wl-row">
                <span className="wl-label">DELTA vs PREV</span>

                <span className={`wl-val ${delta === null ? '' : delta >= 0 ? 'tk-green' : 'tk-red'}`}>
                  {delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ms` : '-- ms'}
                </span>
              </div>
            </div>

            {/* Graph */}

            <div className="graph-area">
              <canvas ref={canvasRef} />
            </div>
          </div>

          {/* RR History */}

          <div className="panel ledger-box">
            <div className="panel-title">RR INTERVAL HISTORY LOG</div>

            <div className="log-stream">
              {logs.length === 1 && logs[0].rr === 0 ? (
                <>
                  <div className="log-line">SYSTEM STATUS: IDLE...</div>

                  <div className="log-line">PORT SCAN OPEN: WEB_BLUETOOTH CHANNELS READY</div>

                  <div className="log-line">AWAITING POLAR ENCRYPTED PACKETS...</div>
                </>
              ) : (
                logs.map((log, index) => (
                  <div className="log-line" key={`${log.timestamp}-${index}`}>
                    <span>{log.timestamp}</span>
                    RR=
                    {log.rr}
                    ms
                    {log.demo ? ' (demo)' : ''}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Control Dock */}

      <div className="control-dock">
        <button className="action-btn" onClick={connectPolar}>
          {connected && !demoMode ? '[ DISCONNECT FEED ]' : 'Connect Polar Hardware'}
        </button>

        <button className={`action-btn demo-btn ${demoMode ? 'demo-active' : ''}`} onClick={toggleDemo}>
          {demoMode ? '■ Stop Demo' : '▶ Preview Demo Data'}
        </button>

        <input
          type="text"
          className="cmd-line"
          readOnly
          value={
            demoMode
              ? 'COMMAND >> /ANALYZE /TREND=DEMO /DEVICE=SIMULATED_PREVIEW'
              : connected
                ? `COMMAND >> /ANALYZE /TREND=LIVE /DEVICE=${deviceName.toUpperCase()}`
                : 'COMMAND >> /ANALYZE /TREND=REALTIME /DEVICE=PENDING...'
          }
        />
      </div>

      {/* Function Keys */}

      <div className="fkey-bar">
        {[
          ['F1', 'HELP'],
          ['F2', 'ANALYZE'],
          ['F3', 'ALERT SET'],
          ['F4', 'TREND'],
          ['F5', 'LOG EXPORT'],
          ['F6', 'GLUCOSELIVE'],
          ['F7', 'SETTINGS'],
          ['F8', 'PRO UPGRADE'],
        ].map(([key, label]) => (
          <div className="fkey" key={key}>
            <span className="fkey-num">{key}</span>

            {label}
          </div>
        ))}
      </div>
    </main>
  );
}
