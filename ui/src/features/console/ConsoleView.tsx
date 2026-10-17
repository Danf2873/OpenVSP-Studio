import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type LogEntry } from "../../store/appStore";
import { Button, SegmentedControl, type SegmentOption } from "../../components";
import s from "./console.module.css";

type Level = "all" | "warn" | "error";

const LEVEL_OPTIONS: SegmentOption<Level>[] = [
  { value: "all", label: "All" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors" },
];

const MAX_RENDER = 500;

function stamp(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

function matches(e: LogEntry, level: Level): boolean {
  if (level === "all") return true;
  if (level === "warn") return e.level !== "info";
  return e.level === "error";
}

/** Read-only engine log (the ring buffer lives in appStore). */
export function ConsoleView() {
  const logs = useAppStore((st) => st.logs);
  const clearLogs = useAppStore((st) => st.clearLogs);
  const [level, setLevel] = useState<Level>("all");
  const listRef = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => logs.filter((e) => matches(e, level)).slice(-MAX_RENDER), [logs, level]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  return (
    <div className={s.console}>
      <div className={s.toolbar}>
        <SegmentedControl<Level> value={level} options={LEVEL_OPTIONS} onChange={setLevel} ariaLabel="Log level" />
        <span className={s.count}>{shown.length} lines</span>
        <span className={s.spacer} />
        <Button size="sm" variant="ghost" onClick={clearLogs}>
          Clear
        </Button>
      </div>
      <div ref={listRef} className={`${s.list} selectable`} role="log" aria-label="Engine log">
        {shown.length === 0 && <div className={s.empty}>No messages yet.</div>}
        {shown.map((e) => (
          <div key={e.id} className={s.line} data-level={e.level}>
            <span className={s.time}>{stamp(e.time)}</span>
            <span className={s.text}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
