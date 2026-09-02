import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://hrv.live';

  return [
    {
      url: `${baseUrl}/`,
    },
    {
      url: `${baseUrl}/hrv-breathing-live`,
    },
    {
      url: `${baseUrl}/poincare-live`,
    },
    {
      url: `${baseUrl}/time-domain-labs`,
    },
    {
      url: `${baseUrl}/about`,
    },
    {
      url: `${baseUrl}/devices`,
    },
  ];
}