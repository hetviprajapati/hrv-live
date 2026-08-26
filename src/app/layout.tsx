import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
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
    canonical: 'https://hrv.live',
  },

  openGraph: {
    title: 'Live HRV Monitor | Real-Time RMSSD & RR Intervals',
    description: 'Measure HRV live with real-time RMSSD, SDNN, pNN50, and RR interval data using a compatible Polar heart rate sensor.',
    url: 'https://hrv.live',
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

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
