import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import type { ParmSearchHit } from "../../api/types";
import { vsp } from "../../api/vsp";
import { EmptyState } from "../../components";
import * as act from "../../layout/actions";
import { useUiStore } from "../../store/uiStore";
import { useCommands, type Command } from "./commands";
import s from "./palette.module.css";

interface ResultItem {
  key: string;
  section: string;
  title: string;
  shortcut?: string;
  run: () => void;
}

/** Subsequence match with bonuses for contiguous runs and word starts. */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let last = -2;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return -1;
    score += idx === last + 1 ? 3 : 1;
    if (idx === 0 || " -_/.".includes(t.charAt(idx - 1))) score += 2;
    last = idx;
    ti = idx + 1;
  }
  return score - t.length * 0.01;
}

const MAX_RESULTS = 80;
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Glass command palette, Ctrl/Cmd+K. */
export function CommandPalette() {
  const open = useUiStore((st) => st.paletteOpen);
  const setOpen = useUiStore((st) => st.setPaletteOpen);
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<ParmSearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setHits([]);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Parameter search when the query is at least two characters.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      vsp
        .parmsSearch(q, 12, { silent: true })
        .then((res) => {
          if (alive) setHits(res);
        })
        .catch(() => {
          if (alive) setHits([]);
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query, open]);

  const results = useMemo<ResultItem[]>(() => {
    if (!open) return [];
    const q = query.trim();
    const cmdItems: { score: number; item: ResultItem }[] = [];
    for (const c of commands as Command[]) {
      if (c.enabled && !c.enabled()) continue;
      const score = q ? fuzzyScore(`${c.title} ${c.keywords ?? ""}`, q) : 0;
      if (q && score < 0) continue;
      cmdItems.push({
        score,
        item: {
          key: c.id,
          section: c.section,
          title: c.title,
          shortcut: c.shortcut,
          run: () => {
            setOpen(false);
            act.guard(async () => {
              await c.run();
            });
          },
        },
      });
    }
    cmdItems.sort((a, b) => (q ? b.score - a.score : 0));

    const paramItems: ResultItem[] = hits.map((h) => ({
      key: `parm:${h.parm.id}:${h.containerId}`,
      section: "Parameters",
      title: `${h.parm.label || h.parm.name}  —  ${h.containerName}`,
      run: () => {
        setOpen(false);
        act.searchParams(q);
      },
    }));

    return [...cmdItems.map((c) => c.item), ...paramItems].slice(0, MAX_RESULTS);
  }, [open, query, commands, hits, setOpen]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  let lastSection = "";

  return (
    <div className={s.scrim} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className={s.panel} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={s.inputRow}>
          <Search size={16} aria-hidden="true" className={s.searchIcon} />
          <input
            ref={inputRef}
            className={s.input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Type a command or parameter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className={s.hint}>
            <CornerDownLeft size={12} aria-hidden="true" /> {IS_MAC ? "⌘K" : "Ctrl+K"}
          </span>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className={s.list}>
          {results.length === 0 && <EmptyState title="No matches" text="Try another word, or check the section names." />}
          {results.map((r, i) => {
            const header = r.section !== lastSection;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header && <div className={s.section}>{r.section}</div>}
                <div
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={s.item}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    r.run();
                  }}
                >
                  <span className={s.itemTitle}>{r.title}</span>
                  {r.shortcut && <kbd className={s.kbd}>{r.shortcut}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
