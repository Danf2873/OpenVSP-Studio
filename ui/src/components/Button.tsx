import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import s from "./ui.module.css";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, block = false, className, children, type = "button", style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(s.btn, s[variant], s[size], className)}
      style={block ? { ...style, width: "100%" } : style}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  icon: ReactNode;
  /** Required: used for aria-label and the title tooltip. */
  label: string;
  /** Toggle state; maps to aria-pressed. */
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, pressed, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(s.iconBtn, className)}
      {...rest}
    >
      {icon}
    </button>
  );
});
