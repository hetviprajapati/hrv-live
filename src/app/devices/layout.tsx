import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HRV Devices | Polar H10 & Compatible Heart Rate Monitors',
  description:
    'Find out which heart rate monitors and chest straps are compatible with HRV.live for live HRV, RMSSD, and RR interval measurement.',
  keywords: [
    'HRV devices',
    'HRV compatible devices',
    'HRV heart rate monitor',
    'HRV chest strap',
    'Polar H10',
    'Polar H10 HRV',
    'Polar H10 chest strap',
    'ECG chest strap',
    'ECG heart rate monitor',
    'live HRV',
    'real-time HRV',
    'RR interval monitor',
    'RMSSD',
    'heart rate variability',
    'HRV.live devices',
    'Web Bluetooth HRV',
  ],
  alternates: {
    canonical: 'https://hrv.live/devices',
  },
  openGraph: {
    title: 'HRV Devices | Polar H10 & Compatible Heart Rate Monitors',
    description:
      'Find out which heart rate monitors and chest straps are compatible with HRV.live for live HRV, RMSSD, and RR interval measurement.',
    url: 'https://hrv.live/devices',
    siteName: 'HRV.live',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'HRV Devices | Polar H10 & Compatible Heart Rate Monitors',
    description: 'See which heart rate monitors and ECG chest straps are compatible with HRV.live for live HRV measurement.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'HRV Devices | Compatible Heart Rate Monitors',
  url: 'https://hrv.live/devices',
  description: 'Information about heart rate monitors and chest straps compatible with HRV.live for live HRV measurement.',
  isPartOf: {
    '@type': 'WebSite',
    name: 'HRV.live',
    url: 'https://hrv.live',
  },
  about: [
    {
      '@type': 'Thing',
      name: 'Heart Rate Variability',
    },
    {
      '@type': 'Thing',
      name: 'RR Intervals',
    },
    {
      '@type': 'Thing',
      name: 'ECG Chest Straps',
    },
  ],
};

export default function DevicesLayout({ children }: { children: React.ReactNode }) {
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
