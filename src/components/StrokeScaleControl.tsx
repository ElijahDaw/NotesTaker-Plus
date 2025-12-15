import { useCallback, useRef, useState, type CSSProperties } from 'react';

interface StrokeScaleControlProps {
  value: number;
  onChange: (value: number) => void;
  color: string;
}

const clamp = (val: number, min = 0) => Math.max(val, min);

const StrokeScaleControl = ({ value, onChange, color }: StrokeScaleControlProps) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointer = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = 1 - (clientY - rect.top) / rect.height;
      onChange(clamp(ratio));
    },
    [onChange]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    handlePointer(event.clientY);
    setDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    handlePointer(event.clientY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (Number.isNaN(parsed)) return;
    const normalized = clamp(parsed / 100);
    onChange(normalized);
  };

  const displayValue = Math.round(value * 100);

  return (
    <div className="stroke-scale-wrapper">
      <div
        className="stroke-scale"
        style={{ '--stroke-control-color': color } as CSSProperties}
      >
        <div className="stroke-scale__circle stroke-scale__circle--large" />
        <div
          className="stroke-scale__track"
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <div
            className="stroke-scale__indicator"
            style={{ bottom: `${Math.min(value, 1) * 100}%` }}
          />
        </div>
        <div className="stroke-scale__circle stroke-scale__circle--small" />
        <input
          type="number"
          className="stroke-scale__input"
          min={0}
          value={displayValue}
          onChange={handleInputChange}
        />
      </div>
    </div>
  );
};

export default StrokeScaleControl;
