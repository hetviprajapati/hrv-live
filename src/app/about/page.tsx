'use client';

import Desclaimer from '../components/shared/Desclaimer/Desclaimer';
import './about.css';
import Link from 'next/link';

export default function AboutPage() {
  return (
    <main className="about-page">
      <div className="about-wrap">
        <header className="about-header">
          <div>
            <Link href="/">HRV.LIVE</Link>
            // ABOUT
          </div>

          <div>
            <a href="https://rmssd.com" rel="noopener noreferrer">
              rmssd.com
            </a>
          </div>
        </header>
        <div className="about-kicker">Live autonomic measurement</div>
        <h1>hrv.live shows recovery as it happens — not tomorrow morning.</h1>
        <p className="about-lede">
          True beat-to-beat RMSSD, pNN50, and RR intervals, live in your browser. No smoothing, no averaged score. If your autonomic system
          drops at 2:14pm, you see it at 2:14pm.
        </p>
        <p>
          Built because wearables give you a green recovery score while you're overdrawn. Overnight averaging is the right tool for a
          nightly baseline. It's the wrong tool for the moment you're actually trying to measure.
        </p>
        <h2>How it works</h2>
        <p>
          Connect a chest strap over Bluetooth. Watch your time-domain signal live — RMSSD, pNN50, and the underlying RR intervals, updating
          in real time as you sit in front of it. See load, crash, and recovery in the same window, as they happen.
        </p>
        <h2>What it is not</h2>
        <p>
          Not wellness. Not a readiness score. A measurement tool for trading floors, performance labs, clinicians, and anyone operating
          under sustained cognitive or physical load who needs to see autonomic state in the moment, not the next morning.
        </p>
        <div className="about-signoff">
          Built by Rose. Documented at{' '}
          <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
            rmssd.com
          </a>
          .
          <br />
          Contact: <a href="mailto:HRVdotLIVE@gmail.com">HRVdotLIVE@gmail.com</a>
        </div>
        <Desclaimer />

        <div className="return-link">
          RETURN TO{' '}
          <Link href="/" className="return-link-button">
            HRV.LIVE
          </Link>{' '}
          DASHBOARD
        </div>
      </div>
    </main>
  );
}
