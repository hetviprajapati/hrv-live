'use client';

import { useRef, useState } from 'react';

export default function PolarMonitor() {
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('Disconnected');

  // CRITICAL: These refs survive Next.js re-renders and block Garbage Collection
  const deviceRef = useRef<any>(null);
  const characteristicRef = useRef<any>(null);

  const handleData = (event: any) => {
    const value = event.target.value;
    const hr = value.getUint8(1);
    setHeartRate(hr);
  };

  const onDisconnected = (event: any) => {
    console.log(`Device ${event.target.name} cut connection.`);
    setStatus('Disconnected');
    setHeartRate(null);
    deviceRef.current = null;
    characteristicRef.current = null;
  };

  const connectPolarVeritySense = async () => {
    if (typeof window === 'undefined' || !(navigator as any).bluetooth) return;

    try {
      setStatus('Connecting...');
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'Polar' }],
        optionalServices: [0x180d],
      });

      // Secure the reference inside the ref structure BEFORE connecting GATT
      deviceRef.current = device;
      deviceRef.current.addEventListener('gattserverdisconnected', onDisconnected);

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(0x180d);
      const characteristic = await service.getCharacteristic(0x2a37);

      characteristicRef.current = characteristic;

      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleData);

      // Updating state now will re-render the page safely
      setStatus('Connected');
      console.log('Connected!');
    } catch (error) {
      console.error(error);
      setStatus('Disconnected');
    }
  };

  return (
    <div className="p-6 text-center">
      <p className="text-sm text-gray-500">Status: {status}</p>
      {status === 'Connected' && <h1 className="text-4xl font-bold text-red-500">{heartRate || '--'} BPM</h1>}
      <button onClick={connectPolarVeritySense} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">
        Connect Polar Sense
      </button>
    </div>
  );
}
