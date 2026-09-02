import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { GoogleAnalytics } from '@next/third-parties/google';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://hrv.live'),

  applicationName: 'HRV.live',

  title: 'Live HRV Monitor | Real-Time RMSSD & RR Intervals',

  description:
    'Measure heart rate variability live with real-time RMSSD, SDNN, pNN50, and RR interval data. Connect a compatible heart rate sensor and monitor your HRV directly in your browser.',

  alternates: {
    canonical: '/',
  },

  openGraph: {
    title: 'Live HRV Monitor | Real-Time RMSSD & RR Intervals',
    description: 'Measure HRV live with real-time RMSSD, SDNN, pNN50, and RR interval data using a compatible heart rate sensor.',
    url: '/',
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
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>

      {process.env.NEXT_PUBLIC_GA_ID ? <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} /> : null}
    </html>
  );
}
