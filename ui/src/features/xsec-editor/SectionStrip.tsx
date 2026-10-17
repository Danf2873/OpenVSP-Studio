// Horizontal strip of section thumbnails. All thumbnails share one scale so
// the strip reads as the real growth of the component along its length.

import { useEffect, useMemo, useRef } from "react";
import type { XsecListItem } from "../../api/types";
import { cx } from "../../components/cx";
import { pathD } from "./geometry";
import s from "./XsecEditor.module.css";

export interface SectionStripProps {
  items: XsecListItem[];
  selected: number;
  onSelect: (index: number) => void;
}

export function SectionStrip({ items, selected, onSelect }: SectionStripProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Shared extent so every thumbnail uses the same scale.
  const extent = useMemo(() => {
    let u = 0;
    let v = 0;
    for (const it of items) {
      for (const [a, b] of it.thumb) {
        if (Math.abs(a) > u) u = Math.abs(a);
        if (Math.abs(b) > v) v = Math.abs(b);
      }
    }
    return { ru: (u || 1) * 1.1, rv: (v || 1) * 1.1 };
  }, [items]);

  // Keep the selected card in view when the selection moves (scroll the row only).
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const left = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [selected, items]);

  const vb = `${-extent.ru} ${-extent.rv} ${2 * extent.ru} ${2 * extent.rv}`;

  return (
    <div ref={rowRef} className={s.strip} role="listbox" aria-label="Sections" aria-orientation="horizontal">
      {items.map((it) => {
        const sel = it.index === selected;
        return (
          <button
            key={it.id}
            type="button"
            role="option"
            aria-selected={sel}
            aria-label={`Section ${it.index}, ${it.shapeName}`}
            title={`Section ${it.index} - ${it.shapeName}`}
            className={cx(s.card, sel && s.cardSelected)}
            onClick={() => onSelect(it.index)}
          >
            <svg className={s.thumb} viewBox={vb} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
              <path className={s.thumbPath} d={pathD(it.thumb.map(([a, b]): [number, number] => [a, -b]), true)} />
            </svg>
            <span className={s.cardCaption}>
              <span className={s.cardIndex}>{it.index}</span> {it.shapeName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
