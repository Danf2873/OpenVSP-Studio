import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, ExternalLink, Play, RotateCcw, X } from "lucide-react";
import type { AnalysisInput } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, Card, cx, Disclosure, EmptyState, NumberField, Select, Spinner, Switch } from "../../components";
import { useUiStore } from "../../store/uiStore";
import { useResultsFocus } from "../results/resultsStore";
import { formatValue } from "../results/resultModel";
import { COMMON_INPUTS } from "./analysisInfo";
import { useAnalysisOverlay } from "./useAnalysisOverlay";
import { useRunStore, type RunRecord, type StepState } from "./runStore";
import s from "./analyses.module.css";

type Values = Record<string, unknown[]>;

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "The engine did not accept the change.";
}

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function replaceAt<T>(list: T[], i: number, v: T): T[] {
  const next = list.slice();
  next[i] = v;
  return next;
}

/** Int/double flags (names ending in "Flag") with at most two options render as a switch. */
function isSwitch(input: AnalysisInput): boolean {
  return input.type === "int" && input.name.endsWith("Flag") && (!input.options || input.options.length <= 2);
}

function parseNumberList(text: string, integer: boolean): number[] | null {
  const nums = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return integer ? nums.map((n) => Math.round(n)) : nums;
}

function formatElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** Re-renders once per quarter second while active, for the elapsed-time readout. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

// ---------- field controls ----------

function TextField({
  value,
  ariaLabel,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <input
      className={s.text}
      aria-label={ariaLabel}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

interface FieldProps {
  input: AnalysisInput;
  value: unknown[];
  /** Display-only update while a drag is in progress. */
  onLocal: (next: unknown[]) => void;
  /** Send the value to the engine. */
  onCommit: (next: unknown[]) => void;
  onInvalid: (message: string) => void;
}

function Field({ input, value, onLocal, onCommit, onInvalid }: FieldProps) {
  const label = input.label;
  const integer = input.type === "int";

  if (input.type === "vec3d") {
    const vectors: unknown[][] = (value.length > 0 ? value : [[0, 0, 0]]).map((v) =>
      Array.isArray(v) ? v : [0, 0, 0],
    );
    const withComponent = (k: number, i: number, v: number) =>
      replaceAt(
        vectors,
        k,
        [0, 1, 2].map((j) => (j === i ? v : toNum(vectors[k][j]))),
      );
    return (
      <div className={s.stack}>
        {vectors.map((vec, k) => (
          <div key={k} className={s.multi}>
            {["x", "y", "z"].map((axis, i) => (
              <NumberField
                key={axis}
                value={toNum(vec[i])}
                ariaLabel={`${label}${vectors.length > 1 ? ` ${k + 1}` : ""} ${axis}`}
                className={s.smallField}
                onChange={(v, gesture) => (gesture ? onLocal(withComponent(k, i, v)) : onCommit(withComponent(k, i, v)))}
                onCommit={(v) => onCommit(withComponent(k, i, v))}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (isSwitch(input)) {
    return <Switch checked={toNum(value[0]) !== 0} onChange={(c) => onCommit([c ? 1 : 0])} label={label} />;
  }

  const opts = input.options;
  if (opts && opts.length > 0) {
    return (
      <Select
        value={String(value[0] ?? "")}
        options={opts.map((o) => ({ value: String(o.value), label: o.label }))}
        ariaLabel={label}
        onChange={(sv) => {
          const match = opts.find((o) => String(o.value) === sv);
          if (match) onCommit([match.value]);
        }}
      />
    );
  }

  if (input.type === "string") {
    const text = value.map((v) => String(v ?? "")).join(", ");
    return (
      <TextField
        value={text}
        ariaLabel={label}
        onCommit={(t) => onCommit(value.length > 1 ? t.split(",").map((p) => p.trim()) : [t])}
      />
    );
  }

  // int / double
  if (value.length === 1) {
    return (
      <NumberField
        value={toNum(value[0])}
        integer={integer}
        ariaLabel={label}
        onChange={(v, gesture) => (gesture ? onLocal([v]) : onCommit([v]))}
        onCommit={(v) => onCommit([v])}
      />
    );
  }

  if (value.length >= 2 && value.length <= 6) {
    return (
      <div className={s.multi}>
        {value.map((raw, i) => (
          <NumberField
            key={i}
            value={toNum(raw)}
            integer={integer}
            ariaLabel={`${label} ${i + 1}`}
            className={s.smallField}
            onChange={(v, gesture) =>
              gesture ? onLocal(replaceAt(value, i, v)) : onCommit(replaceAt(value, i, v))
            }
            onCommit={(v) => onCommit(replaceAt(value, i, v))}
          />
        ))}
      </div>
    );
  }

  // Empty or long lists: comma-separated editor.
  return (
    <TextField
      value={value.map((v) => String(toNum(v))).join(", ")}
      ariaLabel={label}
      onCommit={(t) => {
        const nums = parseNumberList(t, integer);
        if (!nums) {
          onInvalid(`${label}: enter numbers separated by commas.`);
          return;
        }
        onCommit(nums);
      }}
    />
  );
}

function InputRow({
  input,
  value,
  onLocal,
  onCommit,
  onInvalid,
}: FieldProps) {
  if (isSwitch(input)) {
    return (
      <div className={cx(s.row, s.rowInline)}>
        <Field input={input} value={value} onLocal={onLocal} onCommit={onCommit} onInvalid={onInvalid} />
      </div>
    );
  }
  return (
    <div className={s.row}>
      <span className={s.rowLabel} title={input.name}>
        {input.label}
      </span>
      <div className={s.rowControl}>
        <Field input={input} value={value} onLocal={onLocal} onCommit={onCommit} onInvalid={onInvalid} />
      </div>
    </div>
  );
}

// ---------- run progress and results ----------

function stepIcon(state: StepState): ReactNode {
  if (state === "done") return <Check size={13} aria-hidden="true" />;
  if (state === "error") return <X size={13} aria-hidden="true" />;
  if (state === "active") return <Spinner label="In progress" />;
  return <Circle size={9} aria-hidden="true" />;
}

function RunPanel({ name, run, onDismiss }: { name: string; run: RunRecord; onDismiss: () => void }) {
  const running = run.status === "running";
  const now = useNow(running);

  if (running) {
    return (
      <Card className={s.runCard}>
        <div className={s.runHead}>
          <span className={s.runTitle}>Running {name}</span>
          <span className={s.elapsed}>{formatElapsed(now - run.startedAt)}</span>
        </div>
        <ol className={s.steps}>
          {run.steps.map((step, i) => (
            <li key={i} className={cx(s.step, s[step.state])}>
              <span className={s.stepIcon}>{stepIcon(step.state)}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      </Card>
    );
  }

  if (run.status === "error") {
    return (
      <Card className={cx(s.runCard, s.runError)} role="alert">
        <div className={s.runHead}>
          <span className={s.runTitle}>{name} failed</span>
          <span className={s.elapsed}>{formatElapsed((run.endedAt ?? now) - run.startedAt)}</span>
        </div>
        <p className={s.errorText}>{run.error}</p>
        <ol className={s.steps}>
          {run.steps.map((step, i) => (
            <li key={i} className={cx(s.step, s[step.state])}>
              <span className={s.stepIcon}>{stepIcon(step.state)}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
        <div className={s.runActions}>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={s.runCard}>
      <div className={s.runHead}>
        <span className={s.runTitle}>Finished {name}</span>
        <span className={s.elapsed}>{formatElapsed((run.endedAt ?? now) - run.startedAt)}</span>
      </div>
      {run.summary.length > 0 ? (
        <dl className={s.kv}>
          {run.summary.map((item, i) => (
            <div key={`${item.name}-${i}`} className={s.kvRow}>
              <dt>{item.name}</dt>
              <dd>{formatValue(item.value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={s.muted}>No scalar summary. Open the result to see the full data.</p>
      )}
      <div className={s.runActions}>
        <Button
          size="sm"
          variant="secondary"
          icon={<ExternalLink size={13} />}
          disabled={!run.resultId}
          onClick={() => {
            if (!run.resultId) return;
            useResultsFocus.getState().setFocus(run.resultId);
            useUiStore.getState().openDock("results");
          }}
        >
          Open in Results
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}

// ---------- detail ----------

/** Input form and run controls for one analysis. Mounted with key={name}. */
export function AnalysisDetail({ name }: { name: string }) {
  useAnalysisOverlay(name);
  const [inputs, setInputs] = useState<AnalysisInput[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const valuesRef = useRef<Values>({});
  const [formError, setFormError] = useState<string | null>(null);

  const run = useRunStore((st) => st.runs[name] ?? null);
  const busyName = useRunStore((st) => st.busyName);
  const runAnalysis = useRunStore((st) => st.run);
  const forget = useRunStore((st) => st.forget);
  const busy = busyName !== null;

  const applyValues = useCallback((list: AnalysisInput[]) => {
    const next: Values = {};
    for (const input of list) next[input.name] = input.value;
    valuesRef.current = next;
    setValues(next);
  }, []);

  const loadInputs = useCallback(async () => {
    try {
      const list = await vsp.analysisInputs(name);
      setInputs(list);
      setLoadError(null);
      applyValues(list);
    } catch (err) {
      setLoadError(messageOf(err));
    }
  }, [name, applyValues]);

  useEffect(() => {
    void loadInputs();
  }, [loadInputs]);

  const setLocal = (input: AnalysisInput, next: unknown[]) => {
    valuesRef.current = { ...valuesRef.current, [input.name]: next };
    setValues(valuesRef.current);
  };

  const commit = async (input: AnalysisInput, next: unknown[]) => {
    setLocal(input, next);
    setFormError(null);
    try {
      await vsp.analysisSetInput(name, input.name, next);
    } catch (err) {
      setFormError(`${input.label}: ${messageOf(err)}`);
      void loadInputs();
    }
  };

  const resetDefaults = async () => {
    setFormError(null);
    try {
      await vsp.analysisReset(name);
      await loadInputs();
    } catch (err) {
      setFormError(messageOf(err));
    }
  };

  const commonOrder = (input: AnalysisInput) => COMMON_INPUTS.indexOf(input.name);
  const common = (inputs ?? [])
    .filter((i) => commonOrder(i) >= 0)
    .sort((a, b) => commonOrder(a) - commonOrder(b));
  const advanced = (inputs ?? []).filter((i) => commonOrder(i) < 0);

  const renderInput = (input: AnalysisInput) => (
    <InputRow
      key={input.name}
      input={input}
      value={values[input.name] ?? input.value}
      onLocal={(next) => setLocal(input, next)}
      onCommit={(next) => void commit(input, next)}
      onInvalid={setFormError}
    />
  );

  const isThisBusy = busyName === name;

  return (
    <div className={s.detail}>
      <div className={s.actions}>
        <Button
          variant="primary"
          size="md"
          icon={<Play size={13} />}
          disabled={busy}
          title={busy && !isThisBusy ? `${busyName} is running` : undefined}
          onClick={() => void runAnalysis(name)}
        >
          {isThisBusy ? "Running" : "Run"}
        </Button>
        <Button
          variant="ghost"
          size="md"
          icon={<RotateCcw size={13} />}
          disabled={busy || inputs === null}
          onClick={() => void resetDefaults()}
        >
          Reset defaults
        </Button>
      </div>

      {run && <RunPanel name={name} run={run} onDismiss={() => forget(name)} />}

      {formError && (
        <p className={s.formError} role="alert">
          {formError}
        </p>
      )}

      {loadError ? (
        <EmptyState title="Could not load inputs" text={loadError} />
      ) : inputs === null ? (
        <div className={s.loading}>
          <Spinner label="Loading inputs" />
          <span>Loading inputs</span>
        </div>
      ) : inputs.length === 0 ? (
        <EmptyState title="No inputs" text="This analysis has no editable inputs." />
      ) : (
        <div className={s.inputs}>
          {common.length > 0 && <div className={s.group}>{common.map(renderInput)}</div>}
          {advanced.length > 0 && (
            <Disclosure title={`Advanced inputs (${advanced.length})`} defaultOpen={common.length === 0} storageKey="analyses.advanced">
              <div className={s.group}>{advanced.map(renderInput)}</div>
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}
