export function TickerTape({
  heartRate,
  rmssd,
  sdnn,
  pnn50,
  signalLabel,
  signalClass,
  status,
  statusClass,
}: {
  heartRate: number | null;
  rmssd: number | null;
  sdnn: number | null;
  pnn50: number | null;
  signalLabel: string;
  signalClass: string;
  status: string;
  statusClass: string;
}) {
  const num = (value: number | null, digits = 1) => (value !== null ? value.toFixed(digits) : '--');

  return (
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
  );
}
