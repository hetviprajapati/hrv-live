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
  metadataBase: new URL('https://hrv.live'),
  title: {
    default: 'HRV.live | Live Heart Rate Variability',
    template: '%s | HRV.live',
  },
  description:
    'HRV.live provides live heart rate variability measurement using real-time RR intervals, RMSSD, and other time-domain HRV metrics.',
  applicationName: 'HRV.live',
  openGraph: {
    siteName: 'HRV.live',
    type: 'website',
  },
  twitter: {
    card: 'summary',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
