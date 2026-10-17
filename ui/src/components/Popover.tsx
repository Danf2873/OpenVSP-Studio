// Floating menus: Popover (positioned glass panel), MenuList (keyboard nav),
// DropdownMenu (trigger + menu) and ContextMenu (menu at a point).

import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Check } from "lucide-react";
import s from "./ui.module.css";
import { cx } from "./cx";

// ---------- model ----------

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  /** Non-interactive section heading. */
  heading?: boolean;
  onSelect?: () => void;
  /** Submenu entries; when present the item opens them instead of selecting. */
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | "separator";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Placement = "bottom-start" | "bottom-end" | "right-start";

export type Anchor = { kind: "rect"; rect: Rect; placement?: Placement } | { kind: "point"; x: number; y: number };

// ---------- Popover ----------

export interface PopoverProps {
  anchor: Anchor;
  onClose: () => void;
  /** Clicks inside this element do not count as outside clicks. */
  ignoreRef?: RefObject<HTMLElement>;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

export function Popover({ anchor, onClose, ignoreRef, ariaLabel, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Escape closes; a pointerdown outside (and outside ignoreRef) closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (ignoreRef?.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose, ignoreRef]);

  // Position after measuring, keeping the panel inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x: number;
    let y: number;
    if (anchor.kind === "point") {
      x = anchor.x;
      y = anchor.y;
    } else {
      const r = anchor.rect;
      const placement = anchor.placement ?? "bottom-start";
      if (placement === "bottom-end") {
        x = r.right - w;
        y = r.bottom + 4;
      } else if (placement === "right-start") {
        x = r.right + 2;
        y = r.top - 4;
      } else {
        x = r.left;
        y = r.bottom + 4;
      }
    }
    x = Math.max(8, Math.min(x, vw - w - 8));
    y = Math.max(8, Math.min(y, vh - h - 8));
    setPos({ x, y });
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role="presentation"
      aria-label={ariaLabel}
      className={cx(s.popover, className)}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------- MenuList ----------

export interface MenuListProps {
  items: MenuEntry[];
  /** Close the whole menu chain. */
  onClose: () => void;
  /** Close only this list (used by submenus on ArrowLeft). */
  onBack?: () => void;
  ariaLabel?: string;
}

function isSelectable(e: MenuEntry): e is MenuItem {
  return e !== "separator" && !e.heading && !e.disabled;
}

export function MenuList({ items, onClose, onBack, ariaLabel }: MenuListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState<number>(() => items.findIndex(isSelectable));
  const [sub, setSub] = useState<{ index: number; rect: Rect } | null>(null);

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.focus();
    else listRef.current?.focus();
  }, [active]);

  const move = (dir: 1 | -1) => {
    if (items.length === 0) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (isSelectable(items[i])) {
        setActive(i);
        setSub(null);
        return;
      }
    }
  };

  const openSub = (index: number, el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSub({ index, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  };

  const activate = (index: number) => {
    const entry = items[index];
    if (entry === "separator" || entry.heading || entry.disabled) return;
    if (entry.items) {
      openSub(index, itemRefs.current[index]);
      setActive(index);
      return;
    }
    entry.onSelect?.();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(items.findIndex(isSelectable));
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = items.length - 1; i >= 0; i--) {
        if (isSelectable(items[i])) {
          setActive(i);
          break;
        }
      }
    } else if (e.key === "ArrowRight") {
      const entry = items[active];
      if (entry && entry !== "separator" && entry.items) {
        e.preventDefault();
        openSub(active, itemRefs.current[active]);
      }
    } else if (e.key === "ArrowLeft") {
      if (onBack) {
        e.preventDefault();
        onBack();
      }
    }
  };

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={s.menu}
      onKeyDown={onKeyDown}
    >
      {items.map((entry, i) => {
        if (entry === "separator") return <div key={`sep-${i}`} role="separator" className={s.menuSep} />;
        if (entry.heading) {
          return (
            <div key={entry.id} role="presentation" className={s.menuHeading}>
              {entry.label}
            </div>
          );
        }
        const hasSub = !!entry.items;
        return (
          <button
            key={entry.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={entry.disabled ? true : undefined}
            aria-haspopup={hasSub ? "menu" : undefined}
            aria-checked={entry.checked === undefined ? undefined : entry.checked}
            data-active={active === i}
            data-danger={entry.danger ? true : undefined}
            className={s.menuItem}
            title={entry.shortcut ? `${entry.label} (${entry.shortcut})` : entry.label}
            onMouseEnter={() => {
              if (entry.disabled) return;
              setActive(i);
              if (hasSub) openSub(i, itemRefs.current[i]);
              else setSub(null);
            }}
            onClick={() => activate(i)}
          >
            <span className={s.menuCheck} aria-hidden="true">
              {entry.checked ? <Check size={13} /> : null}
            </span>
            {entry.icon && (
              <span aria-hidden="true" style={{ display: "inline-grid" }}>
                {entry.icon}
              </span>
            )}
            <span className={s.menuLabel}>{entry.label}</span>
            {entry.shortcut && <span className={s.menuShortcut}>{entry.shortcut}</span>}
            {hasSub && <ChevronRight size={13} aria-hidden="true" />}
          </button>
        );
      })}
      {sub && items[sub.index] !== undefined && items[sub.index] !== "separator" && (
        <SubmenuHost
          rect={sub.rect}
          items={(items[sub.index] as MenuItem).items ?? []}
          onClose={onClose}
          onBack={() => {
            setSub(null);
            itemRefs.current[sub.index]?.focus();
          }}
        />
      )}
    </div>
  );
}

function SubmenuHost({ rect, items, onClose, onBack }: { rect: Rect; items: MenuEntry[]; onClose: () => void; onBack: () => void }) {
  return (
    <Popover anchor={{ kind: "rect", rect, placement: "right-start" }} onClose={onBack} className={s.popover}>
      <MenuList items={items} onClose={onClose} onBack={onBack} />
    </Popover>
  );
}

// ---------- DropdownMenu ----------

export interface DropdownMenuProps {
  items: MenuEntry[];
  /** A single trigger element (usually a Button). Receives aria/onClick props. */
  children: ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  align?: "start" | "end";
  ariaLabel?: string;
}

export function DropdownMenu({ items, children, align = "start", ariaLabel }: DropdownMenuProps) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const close = () => setRect(null);

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        "aria-haspopup": "menu",
        "aria-expanded": rect !== null,
        onClick: (e: React.MouseEvent) => {
          children.props.onClick?.(e);
          if (rect) {
            close();
          } else if (wrapRef.current) {
            const r = wrapRef.current.getBoundingClientRect();
            setRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
          }
        },
      } as Record<string, unknown>)
    : children;

  return (
    <span ref={wrapRef} style={{ display: "inline-flex" }}>
      {trigger}
      {rect && (
        <Popover
          anchor={{ kind: "rect", rect, placement: align === "end" ? "bottom-end" : "bottom-start" }}
          onClose={close}
          ignoreRef={wrapRef}
          ariaLabel={ariaLabel}
        >
          <MenuList items={items} onClose={close} />
        </Popover>
      )}
    </span>
  );
}

// ---------- ContextMenu ----------

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
  ariaLabel?: string;
}

export function ContextMenu({ x, y, items, onClose, ariaLabel }: ContextMenuProps) {
  return (
    <Popover anchor={{ kind: "point", x, y }} onClose={onClose} ariaLabel={ariaLabel}>
      <MenuList items={items} onClose={onClose} />
    </Popover>
  );
}
