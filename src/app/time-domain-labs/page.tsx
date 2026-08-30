import './TimeDomainLab.css';

export default function TimeDomainLabPage() {
  return (
    <main className="tdl-page">
      <div className="tdl-wrap">
        <header className="tdl-header">
          <div className="tdl-mark">TIME DOMAIN LABS</div>
          <div>timedomainlabs.com</div>
        </header>

        <section className="tdl-hero">
          <div className="tdl-kicker">Time Domain Labs</div>

          <h1>We measure stress in the time domain — as it happens, not the morning after.</h1>

          <p className="tdl-lede">
            Every physiological measurement we build answers one question in real time: what is happening to you right now. Not last
            night&apos;s average. Not a wellness score. The actual signal, live.
          </p>
        </section>

        <section className="tdl-section">
          <h2>Why this exists</h2>

          <p>
            We went looking for tools that showed autonomic and physiological state as it changed, moment to moment — during a stressful
            call, a hard set, a bad night — and found almost nothing. The wearable industry is built around overnight averaging: a green
            score you check the next morning, well after the moment it was measuring has already passed. That&apos;s a reasonable design
            choice for a nightly baseline. It&apos;s the wrong tool for the moment you&apos;re actually trying to understand.
          </p>

          <br />
          <p>So we built the tools ourselves. Free, live, and with nothing hidden about what they can and can&apos;t do.</p>
          <br />
          <div className="tdl-principle-grid">
            <div className="tdl-principle">
              <b>Live, not averaged</b>
              <span>Every tool shows the signal as it happens, not a delayed summary.</span>
            </div>

            <div className="tdl-principle">
              <b>No login, nothing stored</b>
              <span>Processing happens in your browser. No accounts, no server-side data.</span>
            </div>

            <div className="tdl-principle">
              <b>Real sensors, real math</b>
              <span>Standard, published formulas and validated measurement methods — no proprietary black box.</span>
            </div>

            <div className="tdl-principle">
              <b>Free by default</b>
              <span>The core measurement tools are free. We&apos;re not gating the basics behind a paywall.</span>
            </div>
          </div>
        </section>

        <section className="tdl-section">
          <h2>What we&apos;ve built</h2>

          <div className="tdl-asset-list">
            <a href="https://hrv.live" className="tdl-asset-row" target="_blank" rel="noopener noreferrer">
              <div>
                <div className="tdl-asset-name">HRV.live</div>
                <div className="tdl-asset-desc">Live RMSSD from any Bluetooth chest strap — recovery and load, in real time.</div>
              </div>

              <div className="tdl-asset-type">LIVE TOOL</div>
            </a>

            <a href="https://hrv.live/poincare-live" className="tdl-asset-row" target="_blank" rel="noopener noreferrer">
              <div>
                <div className="tdl-asset-name">Poincare.live</div>
                <div className="tdl-asset-desc">A live Poincaré plot of your RR intervals, with SD1/SD2 calculated beat by beat.</div>
              </div>

              <div className="tdl-asset-type">LIVE TOOL</div>
            </a>

            <a href="https://hrv.live/hrv-breathing-live" className="tdl-asset-row" target="_blank" rel="noopener noreferrer">
              <div>
                <div className="tdl-asset-name">BreathingRate.live</div>
                <div className="tdl-asset-desc">Real breathing rate from a camera alone — no wearable required.</div>
              </div>

              <div className="tdl-asset-type">LIVE TOOL</div>
            </a>

            <a href="https://rmssd.com" className="tdl-asset-row" target="_blank" rel="noopener noreferrer">
              <div>
                <div className="tdl-asset-name">rmssd.com</div>
                <div className="tdl-asset-desc">A cited, peer-reviewed-sourced reference on RMSSD and heart rate variability.</div>
              </div>

              <div className="tdl-asset-type">REFERENCE</div>
            </a>

            <a href="https://poincareplot.com" className="tdl-asset-row" target="_blank" rel="noopener noreferrer">
              <div>
                <div className="tdl-asset-name">PoincarePlot.com</div>
                <div className="tdl-asset-desc">
                  The history and mathematics of the Poincaré plot, from dynamical systems to cardiology.
                </div>
              </div>

              <div className="tdl-asset-type">REFERENCE</div>
            </a>
          </div>
        </section>

        <section className="tdl-section">
          <h2>Who&apos;s behind it</h2>

          <div className="tdl-founder-box">
            <p>
              Time Domain Labs was founded by Rose, who builds these tools end to end — measurement logic, interface, and the reference
              material behind them. The lab operates lean and independent, with a preference for tools that are fast, transparent about
              their own limitations, and useful the day they ship.
            </p>
          </div>
        </section>

        <section className="tdl-section">
          <h2>Contact</h2>

          <div className="tdl-contact-box">
            <a href="mailto:HRVdotLIVE@gmail.com">HRVdotLIVE@gmail.com</a>

            <p>Feedback, questions, partnerships, or evaluation access — all inquiries welcome.</p>
          </div>
        </section>

        <footer className="tdl-footer">
          <p>
            Time Domain Labs tools are educational and informational, not medical devices. Not FDA cleared or approved. Not intended to
            diagnose, treat, or prevent any condition. Consult a physician for medical concerns.
          </p>

          <p>hrv.live · poincare.live · breathingrate.live · rmssd.com · poincareplot.com</p>
        </footer>
      </div>
    </main>
  );
}
