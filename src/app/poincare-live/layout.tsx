import type { Metadata } from 'next';
import { JsonLd } from '../components/shared/JsonLd/JsonLd';

const jsonLd = {
  '@context': 'https://schema.org',

  '@type': 'WebApplication',

  '@id': 'https://hrv.live/poincare-live#webapp',

  name: 'HRV.live Poincaré Plot',

  url: 'https://hrv.live/poincare-live',

  description:
    'A browser-based live Poincaré plot for visualizing RR intervals and calculating SD1, SD2, SD1/SD2 ratio, and signal quality.',

  applicationCategory: 'HealthApplication',

  operatingSystem: 'Any',

  browserRequirements: 'Requires a browser with Web Bluetooth support and a compatible heart rate sensor.',

  isPartOf: {
    '@id': 'https://hrv.live/#website',
  },
};

export const metadata: Metadata = {
  title: 'Live Poincaré Plot | SD1, SD2 & RR Intervals | HRV.live',

  description:
    'Build a live Poincaré plot from RR intervals and view SD1, SD2, SD1/SD2 ratio, and signal quality beat by beat using a compatible Bluetooth heart rate sensor.',

  alternates: {
    canonical: '/poincare-live',
  },

  openGraph: {
    title: 'Live Poincaré Plot | SD1, SD2 & RR Intervals | HRV.live',
    description: 'Visualize RR intervals, SD1, SD2, and HRV variability live in your browser.',
    url: '/poincare-live',
    siteName: 'HRV.live',
    type: 'website',
  },

  twitter: {
    card: 'summary',
    title: 'Live Poincaré Plot | SD1, SD2 & RR Intervals | HRV.live',
    description: 'Visualize RR intervals, SD1, SD2, and HRV variability live in your browser.',
  },

  robots: {
    index: true,
    follow: true,
  },
};

export default function PoincareLiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
