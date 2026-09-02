import Link from 'next/link';

type NavigationKey = {
  key: string;
  label: string;
  href: string;
};

type ActionKey = {
  key: string;
  label: string;
  onClick: () => void;
};

export function FunctionKeyBar({ onExport }: { onExport: () => void }) {
  const navigationKeys: NavigationKey[] = [
    {
      key: 'F1',
      label: 'ABOUT',
      href: '/about',
    },
    {
      key: 'F2',
      label: 'DEVICES',
      href: '/devices',
    },
    {
      key: 'F3',
      label: 'POINCARE',
      href: '/poincare-live',
    },
    {
      key: 'F4',
      label: 'BREATHING RATE',
      href: '/hrv-breathing-live',
    },
  ];

  const exportKey: ActionKey = {
    key: 'F5',
    label: 'LOG EXPORT',
    onClick: onExport,
  };

  return (
    <div className="fkey-bar">
      {navigationKeys.map(({ key, label, href }) => (
        <Link
          href={href}
          className="fkey"
          key={key}
          style={{
            cursor: 'pointer',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <span className="fkey-num">{key}</span>
          {label}
        </Link>
      ))}

      <button
        type="button"
        className="fkey"
        onClick={exportKey.onClick}
        style={{
          cursor: 'pointer',
          textDecoration: 'none',
          color: 'inherit',
        }}
        title="Download this session as a file you can send for analysis"
      >
        <span className="fkey-num">{exportKey.key}</span>
        {exportKey.label}
      </button>
    </div>
  );
}
