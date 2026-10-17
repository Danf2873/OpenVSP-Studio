import { useRef } from "react";
import s from "./ui.module.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  /** gesture is true while the thumb is held down. */
  onChange?: (value: number, gesture: boolean) => void;
  /** Fired once when the thumb is released after a gesture. */
  onCommit?: (value: number) => void;
}

export function Slider({ value, min, max, step, disabled = false, ariaLabel, onChange, onCommit }: SliderProps) {
  const dragging = useRef(false);
  const last = useRef(value);

  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit?.(last.current);
  };

  return (
    <input
      type="range"
      className={s.slider}
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step ?? "any"}
      value={value}
      disabled={disabled}
      onPointerDown={() => {
        dragging.current = true;
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onChange={(e) => {
        const v = Number(e.target.value);
        last.current = v;
        onChange?.(v, dragging.current);
      }}
    />
  );
}
