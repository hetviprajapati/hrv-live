import type { Metadata } from 'next';
import { JsonLd } from '../components/shared/JsonLd/JsonLd';

export const metadata: Metadata = {
  title: 'HRV Devices | Polar H10 & Compatible Heart Rate Monitors',

  description:
    'Find out which heart rate monitors and chest straps are compatible with HRV.live for live HRV, RMSSD, and RR interval measurement.',

  alternates: {
    canonical: '/devices',
  },

  openGraph: {
    title: 'HRV Devices | Polar H10 & Compatible Heart Rate Monitors',
    description:
      'Find out which heart rate monitors and chest straps are compatible with HRV.live for live HRV, RMSSD, and RR interval measurement.',
    url: '/devices',
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

  '@id': 'https://hrv.live/devices#webpage',

  name: 'HRV Devices | Compatible Heart Rate Monitors',

  url: 'https://hrv.live/devices',

  description: 'Information about heart rate monitors and chest straps compatible with HRV.live for live HRV measurement.',

  isPartOf: {
    '@id': 'https://hrv.live/#website',
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

    {
      '@type': 'Thing',
      name: 'Polar H10',
    },
  ],
};

export default function DevicesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
