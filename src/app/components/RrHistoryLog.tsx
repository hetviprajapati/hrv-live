import type { LogEntry } from '../types';

export function RrHistoryLog({ logs, visibleLogs }: { logs: LogEntry[]; visibleLogs: Array<LogEntry | null> }) {
  return (
    <div className="panel ledger-box">
      <div className="panel-title">RR INTERVAL HISTORY LOG</div>

      <div className="log-stream">
        {logs.length === 0 ? (
          <>
            <div className="log-line">SYSTEM STATUS: IDLE...</div>
            <div className="log-line">PORT SCAN OPEN: WEB_BLUETOOTH CHANNELS READY</div>
            <div className="log-line">ARTIFACT FLAGGING: ARMED</div>
            <div className="log-line">AWAITING POLAR PACKETS...</div>
          </>
        ) : (
          visibleLogs.map((log, index) => (
            <div className="log-line" key={index}>
              {log ? (
                <>
                  <span>{log.timestamp}</span>
                  <span className={log.bad ? 'tk-red' : 'tk-green'}>
                    RR={log.rr}ms{log.bad ? '*' : ' '}
                  </span>
                </>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
