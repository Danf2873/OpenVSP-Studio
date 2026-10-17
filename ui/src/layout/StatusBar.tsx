import { Spinner } from "../components";
import { useAppStore, type EngineState } from "../store/appStore";
import { useModelStore } from "../store/modelStore";
import { useUiStore } from "../store/uiStore";
import s from "./layout.module.css";

const ENGINE_LABEL: Record<EngineState, string> = {
  connecting: "Connecting to engine",
  running: "Engine running",
  restarting: "Engine restarting",
  stopped: "Engine stopped",
};

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Bottom status line: engine state, current file, running jobs, last log line. */
export function StatusBar() {
  const engine = useAppStore((st) => st.engine);
  const engineCode = useAppStore((st) => st.engineCode);
  const jobs = useAppStore((st) => st.jobs);
  const lastLog = useAppStore((st) => st.lastLog);
  const file = useModelStore((st) => st.model?.file ?? null);
  const dirty = useModelStore((st) => st.model?.dirty ?? false);

  const label = engine === "stopped" && engineCode !== undefined ? `${ENGINE_LABEL.stopped} (code ${engineCode})` : ENGINE_LABEL[engine];
  const latestJob = jobs[jobs.length - 1];

  return (
    <footer className={s.status}>
      <span className={s.statusItem}>
        <span className={s.dot} data-state={engine} aria-hidden="true" />
        {label}
      </span>
      <span className={s.statusItem} title={file ?? "Not saved yet"}>
        {file ? baseName(file) : "Untitled"}
        {dirty ? " (edited)" : ""}
      </span>
      {latestJob && (
        <span className={s.statusItem}>
          <Spinner label="Job running" />
          <span className={s.jobText}>{latestJob.text || "Working"}</span>
          {jobs.length > 1 && <span className={s.jobCount}>+{jobs.length - 1}</span>}
        </span>
      )}
      <span className={s.spacer} />
      <button
        type="button"
        className={s.logButton}
        title="Open console"
        onClick={() => useUiStore.getState().openDock("console")}
      >
        {lastLog ? lastLog.text : "No messages yet"}
      </button>
    </footer>
  );
}
