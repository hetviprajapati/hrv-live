'use client';

import { sendGAEvent } from '@next/third-parties/google';

type GAEventParameters = Record<
  string,
  string | number | boolean
>;

export const trackEvent = (
  eventName: string,
  parameters: GAEventParameters = {}
) => {
  sendGAEvent('event', eventName, parameters);
};