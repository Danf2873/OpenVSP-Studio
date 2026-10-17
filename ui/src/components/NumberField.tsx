import { useCallback, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import s from "./ui.module.css";
import { cx } from "./cx";

export interface NumberFieldProps {
  label?: ReactNode;
  value: number;
  min?: number;
  max?: number;
  /** Base scrub/arrow step. Derived from the value's magnitude when omitted. */
  step?: number;
  integer?: boolean;
  decimals?: number;
  units?: string;
  disabled?: boolean;
  title?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
  /**
   * Called on every change. For drag-to-scrub, gesture is true and the
   * caller should coalesce the stream; typed edits and arrow keys pass false.
   */
  onChange?: (value: number, gesture: boolean) => void;
  /** Called once when a drag-to-scrub gesture ends. */
  onCommit?: (value: number) => void;
}

function trimNumber(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 1000 ? 1 : a >= 1 ? 4 : 6;
  return String(Number(v.toFixed(digits)));
}

function formatValue(v: number, integer: boolean, decimals?: number): string {
  if (!Number.isFinite(v)) return "--";
  if (integer) return String(Math.round(v));
  if (decimals !== undefined) return v.toFixed(decimals);
  return trimNumber(v);
}

/** One scrub/arrow step: 1% of the value's order of magnitude. */
export function stepFor(value: number, integer: boolean, base?: number): number {
  if (base !== undefined && base > 0) return base;
  const mag = Math.max(Math.abs(value), 1e-3);
  const step = Math.pow(10, Math.floor(Math.log10(mag))) * 0.01;
  return integer ? Math.max(1, Math.round(step)) : step;
}

interface DragState {
  startX: number;
  startValue: number;
  base: number;
  moved: boolean;
  current: number;
}

/**
 * Numeric input with drag-to-scrub on its label.
 * Horizontal drag changes the value (shift = x10, alt = x0.1).
 * Enter commits typed text, Escape reverts, arrows step.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step: baseStep,
  integer = false,
  decimals,
  units,
  disabled = false,
  title,
  id,
  ariaLabel,
  className,
  onChange,
  onCommit,
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shown = draft ?? formatValue(value, integer, decimals);

  const clamp = useCallback(
    (v: number) => {
      let x = v;
      if (min !== undefined && x < min) x = min;
      if (max !== undefined && x > max) x = max;
      if (integer) x = Math.round(x);
      return Number(x.toPrecision(12));
    },
    [min, max, integer],
  );

  const onLabelDown = (e: PointerEvent<HTMLLabelElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startValue: value,
      base: stepFor(value, integer, baseStep),
      moved: false,
      current: value,
    };
    setDraft(null);
  };

  const onLabelMove = (e: PointerEvent<HTMLLabelElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 2) return;
    d.moved = true;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const next = clamp(d.startValue + dx * d.base * mult);
    if (next !== d.current) {
      d.current = next;
      onChange?.(next, true);
    }
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    onCommit?.(d.current);
  };

  const commitText = (text: string) => {
    setDraft(null);
    const n = Number(text.trim());
    if (text.trim() === "" || !Number.isFinite(n)) return;
    const v = clamp(n);
    if (v !== value) onChange?.(v, false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draft !== null) commitText(draft);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
      inputRef.current?.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (disabled) return;
      e.preventDefault();
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const next = clamp(value + dir * stepFor(value, integer, baseStep) * mult);
      if (next !== value) onChange?.(next, false);
    }
  };

  const labelText = typeof label === "string" ? label : undefined;

  return (
    <div className={cx(s.parmLine, className)}>
      {label !== undefined && (
        <label
          htmlFor={inputId}
          className={s.parmLabel}
          title={disabled ? title : cx(title, title ? " - " : "", "Drag to adjust")}
          onPointerDown={onLabelDown}
          onPointerMove={onLabelMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ touchAction: "none" }}
        >
          {label}
        </label>
      )}
      <div className={s.parmControl}>
        <input
          ref={inputRef}
          id={inputId}
          className={s.numberInput}
          inputMode="decimal"
          value={shown}
          disabled={disabled}
          aria-label={ariaLabel ?? labelText}
          title={title}
          onFocus={() => setDraft(null)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) commitText(draft);
          }}
          onKeyDown={onKeyDown}
        />
        {units && <span className={s.unit}>{units}</span>}
      </div>
    </div>
  );
}
