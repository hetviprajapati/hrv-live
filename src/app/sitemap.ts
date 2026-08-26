import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://hrv.live/',
      changeFrequency: 'weekly',
      priority: 1,
    },

    {
      url: 'https://hrv.live',
      changeFrequency: 'weekly',
      priority: 0.9,
    },

    {
      url: 'https://hrv.live/about',
      changeFrequency: 'monthly',
      priority: 0.7,
    },

    {
      url: 'https://hrv.live/devices',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}