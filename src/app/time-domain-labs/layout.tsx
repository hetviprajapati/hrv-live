import type { Metadata } from 'next';
import { JsonLd } from '../components/shared/JsonLd/JsonLd';

const jsonLd = {
  '@context': 'https://schema.org',

  '@graph': [
    {
      '@type': 'Organization',

      '@id': 'https://hrv.live/time-domain-labs#organization',

      name: 'Time Domain Labs',

      url: 'https://hrv.live/time-domain-labs',

      email: 'HRVdotLIVE@gmail.com',

      founder: {
        '@type': 'Person',
        name: 'Rose',
      },
    },

    {
      '@type': 'WebPage',

      '@id': 'https://hrv.live/time-domain-labs#webpage',

      url: 'https://hrv.live/time-domain-labs',

      name: 'Time Domain Labs',

      description: 'Time Domain Labs builds browser-based tools for live HRV, breathing rate, and Poincaré analysis.',

      isPartOf: {
        '@id': 'https://hrv.live/#website',
      },

      about: {
        '@id': 'https://hrv.live/time-domain-labs#organization',
      },
    },
  ],
};

export const metadata: Metadata = {
  title: 'Time Domain Labs | Live HRV & Physiology Tools',

  description:
    'Time Domain Labs builds free browser-based tools for live HRV, breathing rate, and Poincaré analysis using transparent measurement methods.',

  alternates: {
    canonical: '/time-domain-labs',
  },

  openGraph: {
    title: 'Time Domain Labs | Live HRV & Physiology Tools',
    description: 'Free browser-based tools for live HRV, breathing rate, and Poincaré analysis.',
    url: '/time-domain-labs',
    siteName: 'HRV.live',
    type: 'website',
  },

  twitter: {
    card: 'summary',
    title: 'Time Domain Labs | Live HRV & Physiology Tools',
    description: 'Free browser-based tools for live HRV, breathing rate, and Poincaré analysis.',
  },

  robots: {
    index: true,
    follow: true,
  },
};

export default function TimeDomainLabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
