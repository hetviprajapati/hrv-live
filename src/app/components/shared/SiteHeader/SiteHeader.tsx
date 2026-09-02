'use client';
import Link from 'next/link';
import './SiteHeader.css';

type SiteHeaderProps = {
  activePage?: 'hrv' | 'breathing' | 'poincare' | 'rmssd';
};

export function SiteHeader({ activePage }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="site-brand">
        <Link href="/time-domain-labs">TIME DOMAIN LABS</Link>
      </div>

      <nav>
        <Link href="/" className={activePage === 'hrv' ? 'teal' : ''}>
          HRV.live
        </Link>

        <Link href="/hrv-breathing-live" className={activePage === 'breathing' ? 'teal' : ''}>
          BreathingRate.live
        </Link>

        <Link href="/poincare-live" className={activePage === 'poincare' ? 'teal' : ''}>
          Poincare.live
        </Link>

        <a href="https://rmssd.com" className={activePage === 'rmssd' ? 'teal' : ''} rel="noopener noreferrer">
          rmssd.com
        </a>
      </nav>
    </header>
  );
}
