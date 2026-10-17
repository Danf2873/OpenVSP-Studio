import type { HTMLAttributes, ReactNode } from "react";
import s from "./ui.module.css";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
  children?: ReactNode;
}

export function Card({ padded = true, className, children, ...rest }: CardProps) {
  return (
    <div className={cx(s.card, padded && s.cardPad, className)} {...rest}>
      {children}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.badge, className)}>{children}</span>;
}

export interface ChipProps {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
}

export function Chip({ pressed, onClick, children, title, disabled = false }: ChipProps) {
  return (
    <button type="button" className={s.chip} aria-pressed={pressed} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
