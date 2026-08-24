'use client';

import { useRef, useState, useEffect } from 'react';

export default function PolarHeartRate() {
  // Use state only for UI updates
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // Use refs to hold the actual Bluetooth connection objects securely in memory
  const deviceRef = useRef<any>(null);
  const characteristicRef = useRef<any>(null);
  const keepAliveIntervalRef = useRef<any>(null);

  // Helper clean up function to reset state
  const resetBluetoothState = () => {
    setIsConnected(false);
    setHeartRate(null);
    deviceRef.current = null;
    characteristicRef.current = null;

    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
  };

  const handleData = (event: any) => {
    const value = event.target.value;
    const hr = value.getUint8(1);
    setHeartRate(hr);
  };

  const onDisconnected = (event: any) => {
    console.log(`Device ${event.target.name} has disconnected safely.`);
    resetBluetoothState();
  };

  const connectPolarVeritySense = async () => {
    // Next.js SSR Check: Ensure navigator is available
    if (typeof window === 'undefined' || !(navigator as any).bluetooth) {
      alert('Web Bluetooth is not supported or accessible in this environment.');
      return;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'Polar' }],
        optionalServices: [0x180d, 0x180f], // Added Battery Service for Keep-Alive
      });

      deviceRef.current = device;
      deviceRef.current.addEventListener('gattserverdisconnected', onDisconnected);

      const server = await device.gatt.connect();

      // 1. Setup Heart Rate Service
      const hrService = await server.getPrimaryService(0x180d);
      const hrCharacteristic = await hrService.getCharacteristic(0x2a37);
      characteristicRef.current = hrCharacteristic;

      await hrCharacteristic.startNotifications();
      hrCharacteristic.addEventListener('characteristicvaluechanged', handleData);

      setIsConnected(true);
      console.log('Connected safely');

      // 2. Windows Keep-Alive Mechanism
      // Periodically read the battery level to force Windows to keep the channel open
      try {
        const batteryService = await server.getPrimaryService(0x180f);
        const batteryChar = await batteryService.getCharacteristic(0x2a19);

        keepAliveIntervalRef.current = setInterval(async () => {
          if (deviceRef.current?.gatt.connected) {
            await batteryChar.readValue();
            console.log('Keep-alive ping sent to prevent auto-disconnect.');
          }
        }, 10000); // Ping every 10 seconds
      } catch (e) {
        console.log('Could not initialize keep-alive ping:', e);
      }
    } catch (error) {
      console.log('Connection failed:', error);
      resetBluetoothState();
    }
  };

  const disconnectPolarVeritySense = async () => {
    try {
      if (characteristicRef.current) {
        await characteristicRef.current.stopNotifications();
        characteristicRef.current.removeEventListener('characteristicvaluechanged', handleData);
      }

      if (deviceRef.current?.gatt.connected) {
        await deviceRef.current.gatt.disconnect();
      }
    } catch (error) {
      console.log('Error during disconnection:', error);
    } finally {
      resetBluetoothState();
    }
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
    };
  }, []);

  return (
    <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-md space-y-4">
      <h1 className="text-xl font-bold text-black">Polar Verity Sense Monitor</h1>

      <div className="text-gray-500">
        Status:{' '}
        <span className={isConnected ? 'text-green-500 font-bold' : 'text-red-500'}>{isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {isConnected && (
        <div className="text-3xl font-bold text-red-600 animate-pulse">♥ {heartRate ? `${heartRate} bpm` : 'Reading...'}</div>
      )}

      <div className="space-x-2">
        {!isConnected ? (
          <button onClick={connectPolarVeritySense} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            Connect Device
          </button>
        ) : (
          <button onClick={disconnectPolarVeritySense} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
