import type { Metadata } from 'next';
import { JsonLd } from '../components/shared/JsonLd/JsonLd';

const jsonLd = {
  '@context': 'https://schema.org',

  '@type': 'WebApplication',

  '@id': 'https://hrv.live/hrv-breathing-live#webapp',

  name: 'HRV.live Breathing Rate Monitor',

  url: 'https://hrv.live/hrv-breathing-live',

  description:
    'A browser-based tool for viewing HRV and breathing rate together in real time using a compatible Bluetooth heart rate sensor and camera.',

  applicationCategory: 'HealthApplication',

  operatingSystem: 'Any',

  browserRequirements:
    'Requires camera access for breathing tracking. HRV tracking requires Web Bluetooth support and a compatible heart rate sensor.',

  isPartOf: {
    '@id': 'https://hrv.live/#website',
  },
};

export const metadata: Metadata = {
  title: 'Live HRV & Breathing Rate Monitor | HRV.live',

  description:
    'Track live HRV and breathing rate together using a compatible Bluetooth chest strap and your camera. View RMSSD and breathing changes together in real time.',

  alternates: {
    canonical: '/hrv-breathing-live',
  },

  openGraph: {
    title: 'Live HRV & Breathing Rate Monitor | HRV.live',
    description: 'Track live HRV, RMSSD, and breathing rate together in your browser.',
    url: '/hrv-breathing-live',
    siteName: 'HRV.live',
    type: 'website',
  },

  twitter: {
    card: 'summary',
    title: 'Live HRV & Breathing Rate Monitor | HRV.live',
    description: 'Track live HRV, RMSSD, and breathing rate together in your browser.',
  },

  robots: {
    index: true,
    follow: true,
  },
};

export default function HrvBreathingLiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
