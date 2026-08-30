'use client';

import './SiteHeader.css';

type SiteHeaderProps = {
  activePage?: 'hrv' | 'breathing' | 'poincare' | 'rmssd';
};

export function SiteHeader({ activePage }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="site-brand">
        <a href="https://hrv.live/time-domain-labs" rel="noopener noreferrer">
          TIME DOMAIN LABS
        </a>
      </div>

      <nav>
        <a href="https://hrv.live" className={activePage === 'hrv' ? 'teal' : ''} rel="noopener noreferrer">
          HRV.live
        </a>

        <a href="https://hrv.live/hrv-breathing-live" className={activePage === 'breathing' ? 'teal' : ''} rel="noopener noreferrer">
          BreathingRate.live
        </a>

        <a href="https://hrv.live/poincare-live" className={activePage === 'poincare' ? 'teal' : ''} rel="noopener noreferrer">
          Poincare.live
        </a>

        <a href="https://rmssd.com" className={activePage === 'rmssd' ? 'teal' : ''} rel="noopener noreferrer">
          rmssd.com
        </a>
      </nav>
    </header>
  );
}
