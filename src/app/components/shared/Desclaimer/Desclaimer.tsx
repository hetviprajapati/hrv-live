import './Desclaimer.css';

export default function Desclaimer() {
  return (
    <div className="disclaimer">
      <p>
        <strong>Disclaimer</strong>
      </p>

      <p>
        hrv.live, rmssd.com, and Time Domain Labs tools are for informational and educational purposes only. Not a medical device. Not FDA
        cleared or approved. No medical advice is provided.
      </p>

      <p>
        We do not diagnose, treat, cure, or prevent any disease or medical condition. RMSSD, pNN50, and RR interval data are measures of
        autonomic activity, not a medical diagnosis.
      </p>

      <p>
        Do not use this information to make medical decisions. Always consult a qualified healthcare professional for medical concerns. If
        you have a medical emergency, call 911.
      </p>

      <p>You assume full responsibility for use of this site and its data.</p>
    </div>
  );
}
