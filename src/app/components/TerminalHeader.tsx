const APP_VERSION = '3.0.0';

export function TerminalHeader({ connected, demoMode }: { connected: boolean; demoMode: boolean }) {
  return (
    <div className="terminal-header">
      <div>HRV.LIVE // BIOMETRIC FEED</div>

      <div>
        DEVICE SYNC:{' '}
        <b className={demoMode ? 'demo-mode' : connected ? 'device-connected' : 'device-offline'}>
          {demoMode ? 'DEMO MODE' : connected ? 'CONNECTED' : 'OFFLINE'}
        </b>
      </div>

      <div>SYS_VER: {APP_VERSION} &nbsp;&nbsp; ACCESS: FREE</div>
    </div>
  );
}
