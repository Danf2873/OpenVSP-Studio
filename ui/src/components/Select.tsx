import s from "./ui.module.css";
import { cx } from "./cx";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function Select({ value, options, onChange, ariaLabel, id, disabled = false, title, className }: SelectProps) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      title={title}
      className={cx(s.select, className)}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
