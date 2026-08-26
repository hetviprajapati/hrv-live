export const PACKET_GAP_MS = 2500;

export const POLAR_PMD_SERVICE_UUID = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8';
export const POLAR_PMD_CONTROL_UUID = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8';
export const POLAR_PMD_DATA_UUID = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8';

export const PMD_REQUEST_MEASUREMENT_START = 0x02;
export const PMD_MEASUREMENT_PPI = 0x03;

export type PpiSample = {
  heartRate: number;
  ppIntervalMs: number;
  errorEstimate: number;
  blocker: boolean;
  skinContact: boolean;
  skinContactSupported: boolean;
};

export function isVeritySenseDevice(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes('verity sense') || normalized.includes('polar sense');
}

/**
 * Polar PMD PPI frames:
 *   byte 0      measurement type (0x03 = PPI)
 *   bytes 1..8  device timestamp
 *   byte 9      frame type (0 = normal PPI frame)
 *   byte 10..   repeated 6-byte PPI samples
 */
export function parsePpiMeasurement(view: DataView): PpiSample[] {
  if (view.byteLength < 16) return [];
  if (view.getUint8(0) !== PMD_MEASUREMENT_PPI) return [];

  const frameType = view.getUint8(9) & 0x7f;
  if (frameType !== 0) return [];

  const contentLength = view.byteLength - 10;
  if (contentLength < 6 || contentLength % 6 !== 0) return [];

  const samples: PpiSample[] = [];

  for (let offset = 10; offset + 6 <= view.byteLength; offset += 6) {
    const flags = view.getUint8(offset + 5);

    samples.push({
      heartRate: view.getUint8(offset),
      ppIntervalMs: view.getUint16(offset + 1, true),
      errorEstimate: view.getUint16(offset + 3, true),
      blocker: (flags & 0x01) !== 0,
      skinContact: (flags & 0x02) !== 0,
      skinContactSupported: (flags & 0x04) !== 0,
    });
  }

  return samples;
}
