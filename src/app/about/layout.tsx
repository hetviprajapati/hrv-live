import type { Metadata } from 'next';
import { JsonLd } from '../components/shared/JsonLd/JsonLd';

export const metadata: Metadata = {
  title: 'About HRV.live | Live Autonomic Measurement',

  description:
    'Learn how HRV.live provides live beat-to-beat RMSSD, pNN50, and RR interval measurement to observe autonomic changes as they happen.',

  alternates: {
    canonical: '/about',
  },

  openGraph: {
    title: 'About HRV.live | Live Autonomic Measurement',
    description:
      'Learn how HRV.live provides live beat-to-beat RMSSD, pNN50, and RR interval measurement to observe autonomic changes as they happen.',
    url: '/about',
    siteName: 'HRV.live',
    type: 'website',
  },

  twitter: {
    card: 'summary',
    title: 'About HRV.live | Live Autonomic Measurement',
    description: 'Learn how HRV.live provides live RMSSD, pNN50, and RR interval measurement directly in your browser.',
  },

  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',

  '@type': 'AboutPage',

  '@id': 'https://hrv.live/about#webpage',

  name: 'About HRV.live',

  url: 'https://hrv.live/about',

  description: 'Information about HRV.live and its approach to live autonomic measurement.',

  isPartOf: {
    '@id': 'https://hrv.live/#website',
  },

  about: {
    '@id': 'https://hrv.live/#webapp',
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
