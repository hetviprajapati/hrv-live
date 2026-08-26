import { useEffect, type RefObject } from 'react';
import { niceCeiling } from '@/utils/hrv-live/hrv-display'; 

export function useHrvChart({
  canvasRef,
  traceData,
  connected,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  traceData: number[];
  connected: boolean;
}) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const padTop = 14;
      const padBottom = 14;
      const usableHeight = height - padTop - padBottom;
      const peak = traceData.length > 0 ? Math.max(...traceData) : 0;
      const scaleMax = niceCeiling(Math.max(peak * 1.15, 50));

      const yFor = (value: number) =>
        padTop + usableHeight - (Math.max(0, Math.min(scaleMax, value)) / scaleMax) * usableHeight;

      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.font = '9px monospace';
      ctx.fillStyle = '#4a4a4a';

      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        const mark = scaleMax * fraction;
        const y = yFor(mark);

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${Math.round(mark)}`, 2, y - 2);
      }

      if (!connected || traceData.length === 0) {
        ctx.strokeStyle = '#3a2a10';
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      const points = traceData.map((value, index) => ({
        x: (index / Math.max(1, traceData.length - 1)) * width,
        y: yFor(value),
        value,
      }));

      const latest = points[points.length - 1].value;
      const lineColor = latest < 20 ? '#ff2a2a' : latest < 40 ? '#ffe14d' : '#3dff6e';

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      points.forEach((point, index) => {
        const isLatest = index === points.length - 1;

        ctx.beginPath();
        ctx.arc(point.x, point.y, isLatest ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isLatest ? '#fff' : lineColor;
        ctx.fill();
      });
    };

    draw();

    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(parent);

    return () => resizeObserver.disconnect();
  }, [canvasRef, traceData, connected]);
}
