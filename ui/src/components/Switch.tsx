import { useId, type ReactNode } from "react";
import s from "./ui.module.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  title?: string;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled = false, title, id }: SwitchProps) {
  const autoId = useId();
  const labelId = `${autoId}-label`;
  return (
    <div className={s.switchRow} title={title}>
      {label !== undefined && (
        <span id={labelId} className={s.parmLabel} data-static="true">
          {label}
        </span>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label !== undefined ? labelId : undefined}
        aria-label={label === undefined ? title : undefined}
        disabled={disabled}
        className={s.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={s.switchKnob} />
      </button>
    </div>
  );
}
