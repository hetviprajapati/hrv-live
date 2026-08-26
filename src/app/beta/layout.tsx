import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Live HRV Monitor | Real-Time RMSSD & RR Intervals',

  description:
    'Measure heart rate variability live with real-time RMSSD, SDNN, pNN50, and RR interval data. Connect a Polar heart rate sensor and monitor your HRV directly in your browser.',

  keywords: [
    'live HRV',
    'HRV monitor',
    'heart rate variability monitor',
    'real-time HRV',
    'live RMSSD',
    'RMSSD monitor',
    'RR interval monitor',
    'RR intervals',
    'SDNN',
    'pNN50',
    'Polar H10 HRV',
    'Polar heart rate sensor',
    'HRV browser',
    'heart rate variability',
    'HRV measurement',
  ],

  alternates: {
    canonical: 'https://hrv.live/beta',
  },

  openGraph: {
    title: 'Live HRV Monitor | Real-Time RMSSD & RR Intervals',

    description: 'Measure HRV live with real-time RMSSD, SDNN, pNN50, and RR interval data using a compatible Polar heart rate sensor.',

    url: 'https://hrv.live/beta',

    siteName: 'HRV.live',

    type: 'website',
  },

  twitter: {
    card: 'summary',
    title: 'Live HRV Monitor | Real-Time RMSSD & RR Intervals',
    description: 'Track live RMSSD, SDNN, pNN50, heart rate, and RR intervals directly in your browser.',
  },

  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',

  name: 'HRV.live',

  url: 'https://hrv.live/beta',

  description:
    'A browser-based live heart rate variability measurement tool providing real-time RMSSD, SDNN, pNN50, heart rate, and RR interval data.',

  applicationCategory: 'HealthApplication',

  operatingSystem: 'Web Browser',

  browserRequirements: 'Requires a browser with Web Bluetooth support and a compatible heart rate sensor.',

  isPartOf: {
    '@type': 'WebSite',
    name: 'HRV.live',
    url: 'https://hrv.live',
  },
};

export default function BetaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
    </>
  );
}
