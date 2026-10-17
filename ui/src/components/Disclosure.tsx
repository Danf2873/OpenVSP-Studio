import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import s from "./ui.module.css";
import { cx } from "./cx";

const KEY_PREFIX = "openvsp-studio.disclosure:";

function readOpen(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const v = window.localStorage.getItem(KEY_PREFIX + key);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // storage unavailable; use the default
  }
  return fallback;
}

function writeOpen(key: string | undefined, open: boolean): void {
  if (!key) return;
  try {
    window.localStorage.setItem(KEY_PREFIX + key, open ? "1" : "0");
  } catch {
    // storage unavailable; state is per session only
  }
}

export interface DisclosureProps {
  title: ReactNode;
  defaultOpen?: boolean;
  /** When set, the open state is remembered in localStorage. */
  storageKey?: string;
  /** Force open (e.g. while filtering). */
  forceOpen?: boolean;
  nested?: boolean;
  className?: string;
  children: ReactNode;
}

export function Disclosure({
  title,
  defaultOpen = true,
  storageKey,
  forceOpen = false,
  nested = false,
  className,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const bodyId = useId();
  const effective = forceOpen || open;

  return (
    <section className={cx(s.disclosure, nested && s.disclosureNested, className)}>
      <button
        type="button"
        className={s.disclosureHead}
        aria-expanded={effective}
        aria-controls={bodyId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          writeOpen(storageKey, next);
        }}
      >
        <ChevronRight size={14} className={s.disclosureChevron} data-open={effective} aria-hidden="true" />
        <span className={s.disclosureTitle}>{title}</span>
      </button>
      {effective && (
        <div id={bodyId} className={s.disclosureBody}>
          {children}
        </div>
      )}
    </section>
  );
}
