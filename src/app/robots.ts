import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },

    sitemap: 'https://hrv.live/sitemap.xml',

    host: 'https://hrv.live',
  };
}