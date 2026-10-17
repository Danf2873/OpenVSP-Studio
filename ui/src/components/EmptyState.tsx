import type { ReactNode } from "react";
import s from "./ui.module.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className={s.empty}>
      {icon && (
        <div className={s.emptyIcon} aria-hidden="true">
          {icon}
        </div>
      )}
      <div className={s.emptyTitle}>{title}</div>
      {text && <p className={s.emptyText}>{text}</p>}
      {action}
    </div>
  );
}
