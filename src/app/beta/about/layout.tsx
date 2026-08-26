import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About HRV.live | Live Autonomic Measurement',

  description:
    'Learn how HRV.live provides live beat-to-beat RMSSD, pNN50, and RR interval measurement to observe autonomic changes as they happen.',

  keywords: [
    'HRV',
    'HRV.live',
    'heart rate variability',
    'live HRV',
    'live autonomic measurement',
    'RMSSD',
    'pNN50',
    'RR intervals',
    'real-time HRV',
    'autonomic activity',
  ],

  alternates: {
    canonical: 'https://hrv.live/beta/about',
  },

  openGraph: {
    title: 'About HRV.live | Live Autonomic Measurement',
    description:
      'Learn how HRV.live provides live beat-to-beat RMSSD, pNN50, and RR interval measurement to observe autonomic changes as they happen.',
    url: 'https://hrv.live/beta/about',
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

  name: 'About HRV.live',

  url: 'https://hrv.live/beta/about',

  description: 'Information about HRV.live and its approach to live autonomic measurement.',

  isPartOf: {
    '@type': 'WebSite',
    name: 'HRV.live',
    url: 'https://hrv.live',
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
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
