import type { ReactNode } from "react";
import s from "./ui.module.css";

/** CSS tooltip shown on hover or keyboard focus after a short delay. */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className={s.tip} data-tip={content}>
      {children}
    </span>
  );
}
