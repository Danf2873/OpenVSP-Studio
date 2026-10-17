// Monospace script editor with a line-number gutter. The gutter follows the
// textarea's vertical scroll. Tab inserts two spaces; Ctrl+S (or Cmd+S) calls
// onSave; Escape leaves the editor so keyboard users can move on.

import { useLayoutEffect, useRef, type KeyboardEvent, type UIEvent } from "react";
import s from "./links.module.css";

const INDENT = "  ";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  ariaLabel: string;
}

export function CodeEditor({ value, onChange, onSave, ariaLabel }: CodeEditorProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  // Caret position to restore after a Tab insert re-renders the textarea.
  const pendingCaret = useRef<number | null>(null);
  const lineCount = value.split("\n").length;

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (ta && pendingCaret.current !== null) {
      ta.selectionStart = pendingCaret.current;
      ta.selectionEnd = pendingCaret.current;
      pendingCaret.current = null;
    }
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      pendingCaret.current = start + INDENT.length;
      onChange(ta.value.slice(0, start) + INDENT + ta.value.slice(end));
      return;
    }
    if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className={s.editor}>
      <div className={s.gutter} ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        className={s.code}
        value={value}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
      />
    </div>
  );
}
