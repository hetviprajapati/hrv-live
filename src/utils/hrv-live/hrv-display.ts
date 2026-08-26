export function qualityLabel(rate: number, ready: boolean): string {
  if (!ready) return 'ACQUIRING';
  if (rate > 0.15) return 'NOISY';
  if (rate > 0.05) return 'FAIR';
  return 'CLEAN';
}

export function qualityClass(rate: number, ready: boolean): string {
  if (!ready) return 'tk-yellow';
  if (rate > 0.15) return 'tk-red';
  if (rate > 0.05) return 'tk-yellow';
  return 'tk-green';
}

export function formatTimestamp(date: Date): string {
  return `${date.toTimeString().split(' ')[0]}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** Round a chart ceiling up to something a human would choose. */
export function niceCeiling(value: number): number {
  const candidates = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500];

  for (const candidate of candidates) {
    if (value <= candidate) return candidate;
  }

  return Math.ceil(value / 100) * 100;
}
