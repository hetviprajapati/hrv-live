import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { SessionRecorder } from '@/lib/hrv-live/session-recorder';
import {
  PMD_MEASUREMENT_PPI,
  PMD_REQUEST_MEASUREMENT_START,
  POLAR_PMD_CONTROL_UUID,
  POLAR_PMD_DATA_UUID,
  POLAR_PMD_SERVICE_UUID,
  isVeritySenseDevice,
} from '../../utils/hrv-live/polar';

export function usePolarBluetooth({
  resetSession,
  teardownConnection,
  startDemo,
  stopDemo,
  handleHeartRateMeasurement,
  handlePpiMeasurement,
  recorderRef,
  setConnected,
  setDemoMode,
  setDeviceName,
  setErrorMessage,
}: {
  resetSession: () => void;
  teardownConnection: () => void;
  startDemo: () => void;
  stopDemo: () => void;
  handleHeartRateMeasurement: (event: Event) => void;
  handlePpiMeasurement: (event: Event) => void;
  recorderRef: MutableRefObject<SessionRecorder>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setDemoMode: Dispatch<SetStateAction<boolean>>;
  setDeviceName: Dispatch<SetStateAction<string>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
}) {
  const bluetoothDeviceRef = useRef<any | null>(null);
  const characteristicRef = useRef<any | null>(null);
  const pmdControlRef = useRef<any | null>(null);
  const pmdDataRef = useRef<any | null>(null);
  const lastPpiPacketAtRef = useRef<number | null>(null);

  const handleDeviceDisconnected = useCallback(
    (event?: Event) => {
      console.error('[Polar] GATT DISCONNECTED at', new Date().toISOString());

      const device = (event?.target as any) ?? bluetoothDeviceRef.current;
      if (device) device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);

      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;

      teardownConnection();
      startDemo();
      setErrorMessage('POLAR DISCONNECTED — DEMO MODE ACTIVE');
    },
    [startDemo, teardownConnection, setErrorMessage],
  );

  const connectPolar = useCallback(async () => {
    setErrorMessage('');
    stopDemo();

    if (!(navigator as any).bluetooth) {
      setErrorMessage('WEB BLUETOOTH UNAVAILABLE — USE CHROME ON DESKTOP/ANDROID, OR BLUEFY ON iOS');
      return;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'Polar' }],
        optionalServices: ['heart_rate', 'battery_service', 'device_information', POLAR_PMD_SERVICE_UUID],
      });

      resetSession();

      bluetoothDeviceRef.current = device;
      device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('GATT connect failed');

      const name = device.name || 'POLAR DEVICE';
      const isVerity = isVeritySenseDevice(name);

      if (!isVerity) {
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
        characteristicRef.current = characteristic;
      }

      recorderRef.current.start('live', name, Date.now());

      if (isVerity) {
        const pmdService = await server.getPrimaryService(POLAR_PMD_SERVICE_UUID);
        const pmdControl = await pmdService.getCharacteristic(POLAR_PMD_CONTROL_UUID);
        const pmdData = await pmdService.getCharacteristic(POLAR_PMD_DATA_UUID);

        pmdControlRef.current = pmdControl;
        pmdDataRef.current = pmdData;

        await pmdData.startNotifications();
        pmdData.addEventListener('characteristicvaluechanged', handlePpiMeasurement);

        await pmdControl.startNotifications();
        pmdControl.addEventListener('characteristicvaluechanged', (controlEvent: Event) => {
          const controlView = (controlEvent.target as any)?.value as DataView | undefined;
          if (!controlView || controlView.byteLength === 0) return;

          const bytes = new Uint8Array(controlView.buffer, controlView.byteOffset, controlView.byteLength);
          console.debug(
            '[Verity Sense] PMD CONTROL RESPONSE:',
            Array.from(bytes)
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join(' '),
          );
        });

        await pmdControl.writeValue(new Uint8Array([PMD_REQUEST_MEASUREMENT_START, PMD_MEASUREMENT_PPI]));
        console.debug('[Verity Sense] PPI start command sent — first data can take ~25s');
      }

      setConnected(true);
      setDemoMode(false);
      setDeviceName(name);
    } catch (error) {
      console.error(error);

      const device = bluetoothDeviceRef.current;
      if (device) device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
      if (characteristicRef.current) {
        characteristicRef.current.removeEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
      }
      if (pmdDataRef.current) {
        pmdDataRef.current.removeEventListener('characteristicvaluechanged', handlePpiMeasurement);
      }
      if (device?.gatt?.connected) {
        try {
          device.gatt.disconnect();
        } catch {
          // Best-effort cleanup; the original error is more useful.
        }
      }

      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;
      resetSession();

      setConnected(false);
      setErrorMessage(
        error instanceof Error && error.name === 'NotFoundError'
          ? 'NO DEVICE SELECTED'
          : 'CONNECTION FAILED — CHECK THE POLAR DEVICE IS ON, WORN, AND NOT CONNECTED TO ANOTHER APP',
      );
      startDemo();
    }
  }, [
    handleDeviceDisconnected,
    handleHeartRateMeasurement,
    handlePpiMeasurement,
    recorderRef,
    resetSession,
    setConnected,
    setDemoMode,
    setDeviceName,
    setErrorMessage,
    startDemo,
    stopDemo,
  ]);

  const disconnectPolar = useCallback(() => {
    const device = bluetoothDeviceRef.current;

    try {
      if (characteristicRef.current) {
        characteristicRef.current.removeEventListener('characteristicvaluechanged', handleHeartRateMeasurement);
      }
      if (pmdDataRef.current) {
        pmdDataRef.current.removeEventListener('characteristicvaluechanged', handlePpiMeasurement);
      }
      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
        if (device.gatt?.connected) device.gatt.disconnect();
      }
    } catch (error) {
      console.error('Bluetooth disconnect error:', error);
    } finally {
      bluetoothDeviceRef.current = null;
      characteristicRef.current = null;
      pmdControlRef.current = null;
      pmdDataRef.current = null;
      lastPpiPacketAtRef.current = null;
      teardownConnection();
      startDemo();
    }
  }, [handleDeviceDisconnected, handleHeartRateMeasurement, handlePpiMeasurement, startDemo, teardownConnection]);

  useEffect(() => {
    return () => {
      const device = bluetoothDeviceRef.current;

      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
        if (device.gatt?.connected) device.gatt.disconnect();
        bluetoothDeviceRef.current = null;
      }
    };
  }, [handleDeviceDisconnected]);

  return { connectPolar, disconnectPolar };
}
