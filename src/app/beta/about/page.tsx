import './about.css';

export const metadata = {
  title: 'About — HRV.live | Live Autonomic Measurement',
  description: 'HRV.live shows recovery as it happens — not tomorrow morning.',
};

export default function AboutPage() {
  return (
    <main className="about-page">
      <div className="about-wrap">
        <header className="about-header">
          <div>
            <a href="https://hrv.live" target="_blank" rel="noopener noreferrer">
              HRV.LIVE
            </a>{' '}
            // ABOUT
          </div>

          <div>
            <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
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

        <h2>Evaluation access</h2>

        <div className="beta-box">
          <div className="beta-price">$199/mo — public beta</div>

          <p>
            Includes hrv.live/beta, rmssd.com/beta, and priority booking for Time Domain Labs NYC sessions{' '}
            <em>(launching — details on request)</em>.
          </p>

          <div className="beta-note">Institutional and partner evaluation access available at no cost — reach out directly below.</div>
        </div>

        <div className="about-signoff">
          Built by Rose. Documented at{' '}
          <a href="https://rmssd.com" target="_blank" rel="noopener noreferrer">
            rmssd.com
          </a>
          .
          <br />
          Contact: <a href="mailto:hello@hrv.live">hello@hrv.live</a>
        </div>

        <div className="about-disclaimer">
          <p>
            <strong>Disclaimer</strong>
          </p>

          <p>
            hrv.live, rmssd.com, and Time Domain Labs tools are for informational and educational purposes only. Not a medical device. Not
            FDA cleared or approved. No medical advice is provided.
          </p>

          <p>
            We do not diagnose, treat, cure, or prevent any disease or medical condition. RMSSD, pNN50, and RR interval data are measures of
            autonomic activity, not a medical diagnosis.
          </p>

          <p>
            Do not use this information to make medical decisions. Always consult a qualified healthcare professional for medical concerns.
            If you have a medical emergency, call 911.
          </p>

          <p>You assume full responsibility for use of this site and its data.</p>
        </div>
      </div>
    </main>
  );
}
