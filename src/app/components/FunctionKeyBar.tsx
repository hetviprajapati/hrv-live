type FunctionKey = [string, string, (() => void) | null];

export function FunctionKeyBar({
  onAbout,
  onDevices,
  onPoincare,
  onBreathingRate,
  onExport,
}: {
  onAbout: () => void;
  onDevices: () => void;
  onPoincare: () => void;
  onBreathingRate: () => void;
  onExport: () => void;
}) {
  const keys: FunctionKey[] = [
    ['F1', 'ABOUT', onAbout],
    ['F2', 'DEVICES', onDevices],
    ['F3', 'POINCARE', onPoincare],
    ['F4', 'BREATHING RATE', onBreathingRate],
    ['F5', 'LOG EXPORT', onExport],
  ];

  return (
    <div className="fkey-bar">
      {keys.map(([key, label, action]) => (
        <div
          className="fkey"
          key={key}
          onClick={action ?? undefined}
          role={action ? 'button' : undefined}
          tabIndex={action ? 0 : undefined}
          onKeyDown={
            action
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') action();
                }
              : undefined
          }
          style={action ? { cursor: 'pointer' } : undefined}
          title={action ? 'Download this session as a file you can send for analysis' : undefined}
        >
          <span className="fkey-num">{key}</span>
          {label}
        </div>
      ))}
    </div>
  );
}
