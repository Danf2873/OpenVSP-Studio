// Editor for one link: its inputs and outputs (parameter <-> script variable),
// and the script with Save & Build.

import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Check, Plus, X } from "lucide-react";
import type { LinkBuildResult, LinkGetResult, LinkIO } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, IconButton, Modal } from "../../components";
import { guard } from "../../layout/actions";
import { CodeEditor } from "./CodeEditor";
import { ParmPicker, formatParmValue, type PickedParm } from "./ParmPicker";
import s from "./links.module.css";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARROW_IN = "←";
const ARROW_OUT = "→";

type IOKind = "input" | "output";

export interface LinkEditorProps {
  index: number;
  /** Changes when the model changed structurally; triggers a refetch. */
  rev: number;
  /** Unsaved script text per link index, kept while switching links. */
  drafts: MutableRefObject<Map<number, string>>;
}

/** A variable name derived from a parameter name, unique among taken names. */
function defaultVarName(parmName: string, taken: string[]): string {
  let base = parmName.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(base)) base = `_${base}`;
  if (base === "_" || base === "") base = "var";
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
  return name;
}

export function LinkEditor({ index, rev, drafts }: LinkEditorProps) {
  const [detail, setDetail] = useState<LinkGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCodeState] = useState("");
  const [build, setBuild] = useState<LinkBuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickKind, setPickKind] = useState<IOKind | null>(null);
  const [picked, setPicked] = useState<{ kind: IOKind; parm: PickedParm } | null>(null);
  // Refs mirror the code so async callbacks always see the latest text.
  const codeRef = useRef("");
  const savedRef = useRef<string | null>(null);
  const seq = useRef(0);

  const setCode = useCallback(
    (value: string) => {
      codeRef.current = value;
      setCodeState(value);
      if (value === savedRef.current) drafts.current.delete(index);
      else drafts.current.set(index, value);
    },
    [drafts, index],
  );

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await vsp.linksGet(index, { silent: true });
      if (id !== seq.current) return;
      const previous = savedRef.current;
      savedRef.current = res.code;
      setDetail(res);
      setError(null);
      if (previous === null) {
        // First load: resume any unsaved text from before the editor was re-opened.
        setCode(drafts.current.get(index) ?? res.code);
      } else if (codeRef.current === previous) {
        // Not dirty: take the engine's text (it may have changed externally).
        setCode(res.code);
      }
      // Otherwise the user has unsaved edits; keep them.
    } catch (e: unknown) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load this link");
    }
  }, [index, drafts, setCode]);

  useEffect(() => {
    void load();
  }, [load, rev]);

  const saveAndBuild = () => {
    if (busy) return;
    const text = codeRef.current;
    setBusy(true);
    setBuild(null);
    guard(async () => {
      try {
        await vsp.linksSetCode(index, text);
        savedRef.current = text;
        if (codeRef.current === text) drafts.current.delete(index);
        setDetail((d) => (d ? { ...d, code: text } : d));
        const res = await vsp.linksBuild(index);
        setBuild(res);
      } finally {
        setBusy(false);
      }
    });
  };

  const removeIO = (kind: IOKind, variable: string) =>
    guard(async () => {
      if (kind === "input") await vsp.linksRemoveInput(index, variable);
      else await vsp.linksRemoveOutput(index, variable);
      await load();
    });

  const addIO = (kind: IOKind, name: string, parm: PickedParm) =>
    guard(async () => {
      if (kind === "input") await vsp.linksAddInput(index, parm.id, name);
      else await vsp.linksAddOutput(index, parm.id, name);
      setPicked(null);
      await load();
    });

  if (error) return <EmptyState title="Could not load this link" text={error} />;
  if (!detail) return <p className={s.hint}>Loading link...</p>;

  const dirty = code !== detail.code;
  const taken = [...detail.inputs, ...detail.outputs].map((io) => io.var);
  const available = taken.length > 0 ? taken.join(", ") : null;

  return (
    <div className={s.editorWrap}>
      <div className={s.editorHead}>
        <h3 className={s.editorTitle}>{detail.name || `Link ${index}`}</h3>
        {dirty && <span className={s.dirty}>Unsaved</span>}
      </div>

      <IOSection
        title="Inputs"
        kind="input"
        items={detail.inputs}
        onAdd={() => setPickKind("input")}
        onRemove={(v) => removeIO("input", v)}
      />
      <IOSection
        title="Outputs"
        kind="output"
        items={detail.outputs}
        onAdd={() => setPickKind("output")}
        onRemove={(v) => removeIO("output", v)}
      />

      <ParmPicker
        open={pickKind !== null}
        onClose={() => setPickKind(null)}
        title={pickKind === "output" ? "Choose a parameter to set" : "Choose a parameter to read"}
        onPick={(parm) => setPicked({ kind: pickKind ?? "input", parm })}
      />

      {picked && (
        <NamePrompt
          kind={picked.kind}
          parm={picked.parm}
          taken={taken}
          onCancel={() => setPicked(null)}
          onSubmit={(name) => addIO(picked.kind, name, picked.parm)}
        />
      )}

      <section className={s.scriptSection} aria-label="Script">
        <div className={s.sectionRow}>
          <h4 className={s.subTitle}>Script</h4>
          <span className={s.helper}>Ctrl+S saves and builds</span>
        </div>
        <p className={s.helper}>
          {available ? (
            <>
              Variables: <code className={s.mono}>{available}</code>
            </>
          ) : (
            "Add an input or output to make variables available to the script."
          )}
        </p>
        <CodeEditor
          value={code}
          ariaLabel={`Script for ${detail.name || `link ${index}`}`}
          onChange={(v) => {
            setCode(v);
            setBuild(null);
          }}
          onSave={saveAndBuild}
        />
        <div className={s.actions}>
          <Button variant="primary" size="sm" onClick={saveAndBuild} disabled={busy}>
            {busy ? "Building..." : "Save & Build"}
          </Button>
        </div>

        {build &&
          (build.ok ? (
            <div className={s.buildOk} role="status">
              <Check size={14} aria-hidden="true" />
              <span>Built</span>
              {build.message && <span className={s.buildNote}>{build.message}</span>}
            </div>
          ) : (
            <div className={s.buildErr} role="alert">
              <span className={s.buildErrTitle}>Build failed</span>
              <pre className={s.errorBox}>{build.message || "The compiler reported no details."}</pre>
            </div>
          ))}
      </section>
    </div>
  );
}

// ---------- inputs / outputs ----------

interface IOSectionProps {
  title: string;
  kind: IOKind;
  items: LinkIO[];
  onAdd: () => void;
  onRemove: (variable: string) => void;
}

function IOSection({ title, kind, items, onAdd, onRemove }: IOSectionProps) {
  const arrow = kind === "input" ? ARROW_IN : ARROW_OUT;
  return (
    <section className={s.ioSection} aria-label={title}>
      <div className={s.sectionRow}>
        <h4 className={s.subTitle}>{title}</h4>
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={onAdd}>
          Add {kind}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className={s.helper}>None yet.</p>
      ) : (
        <ul className={s.ioList}>
          {items.map((io) => (
            <li key={io.var} className={s.ioRow}>
              <code className={s.varName} title={io.var}>
                {io.var}
              </code>
              <span className={s.arrow} aria-hidden="true">
                {arrow}
              </span>
              <span className={s.parmName} title={`${io.parm.name} (${io.parm.group})`}>
                <span className={s.parmLabel}>{io.parm.label || io.parm.name}</span>
                <span className={s.parmMeta}>
                  {io.parm.group} &middot; {formatParmValue(io.parm.value)}
                </span>
              </span>
              <IconButton icon={<X size={13} />} label={`Remove ${kind} ${io.var}`} onClick={() => onRemove(io.var)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- variable name prompt ----------

interface NamePromptProps {
  kind: IOKind;
  parm: PickedParm;
  taken: string[];
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

function NamePrompt({ kind, parm, taken, onCancel, onSubmit }: NamePromptProps) {
  const [name, setName] = useState(() => defaultVarName(parm.name, taken));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!IDENT.test(n)) {
      setError("Use letters, digits and underscores. Start with a letter or underscore.");
      return;
    }
    if (taken.includes(n)) {
      setError(`"${n}" is already used by this link.`);
      return;
    }
    setError(null);
    onSubmit(n);
  };

  return (
    <Modal open onClose={onCancel} title={kind === "input" ? "Add input" : "Add output"}>
      <form className={s.namePrompt} onSubmit={submit}>
        <p className={s.helper}>
          Variable name for <strong>{parm.label || parm.name}</strong>. The script uses this name.
        </p>
        <label className={s.fieldLabel}>
          <span>Variable name</span>
          <input
            className={s.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error !== null || undefined}
            autoFocus
          />
        </label>
        {error && (
          <p className={s.formError} role="alert">
            {error}
          </p>
        )}
        <div className={s.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={name.trim() === ""}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
