// Sidebar "Sets" pane: the set list (rename user sets, show / hide per set)
// and the component x set membership matrix.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Eye, EyeOff, Layers, Pencil } from "lucide-react";
import type { GeomNode, Id, SetListItem, SetsMatrix } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, IconButton } from "../../components";
import * as act from "../../layout/actions";
import { useModelStore } from "../../store/modelStore";
import s from "./sets.module.css";

/** Engine set indices below this are built in (All, Shown, Not_Shown). */
const FIRST_USER_SET = 3;

const NO_GEOMS: GeomNode[] = [];

/** Bumps when the model changed structurally (not for plain parm edits). */
function useStructuralRevision(): number {
  const lastChange = useModelStore((st) => st.lastChange);
  const [rev, setRev] = useState(0);
  const seen = useRef(lastChange.seq);
  useEffect(() => {
    if (lastChange.seq === seen.current) return;
    seen.current = lastChange.seq;
    if (!lastChange.parmsOnly) setRev((r) => r + 1);
  }, [lastChange]);
  return rev;
}

function depthMap(geoms: GeomNode[]): Map<Id, number> {
  const byId = new Map(geoms.map((g) => [g.id, g] as const));
  const out = new Map<Id, number>();
  for (const g of geoms) {
    let depth = 0;
    let parent = g.parentId;
    while (parent !== null && depth < 32) {
      depth += 1;
      parent = byId.get(parent)?.parentId ?? null;
    }
    out.set(g.id, depth);
  }
  return out;
}

export function SetsPane() {
  const geoms = useModelStore((st) => st.model?.geoms ?? NO_GEOMS);
  const rev = useStructuralRevision();
  const [matrix, setMatrix] = useState<SetsMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const m = await vsp.setsMatrix({ silent: true });
      if (id !== seq.current) return;
      setMatrix(m);
      setError(null);
    } catch (e: unknown) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load sets");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, rev]);

  const depths = useMemo(() => depthMap(geoms), [geoms]);

  // Run an engine call, then refresh the matrix. Engine errors are toasted by
  // the client; anything else is toasted by guard().
  const run = (fn: () => Promise<unknown>) =>
    act.guard(async () => {
      try {
        await fn();
      } finally {
        void load();
      }
    });

  const toggleFlag = (geomId: Id, pos: number, value: boolean) => {
    const current = matrix;
    const set = current?.sets[pos];
    if (!current || !set) return;
    // Optimistic update; the refresh after the call corrects any mismatch.
    setMatrix({
      ...current,
      rows: current.rows.map((r) =>
        r.geomId === geomId ? { ...r, flags: r.flags.map((f, i) => (i === pos ? value : f)) } : r,
      ),
    });
    run(() => vsp.setsSetFlag(geomId, set.index, value));
  };

  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <span className={s.paneTitle}>Sets</span>
      </div>

      <div className={s.body}>
        {error ? (
          <EmptyState title="Could not load sets" text={error} />
        ) : matrix === null ? (
          <p className={s.hint}>Loading sets...</p>
        ) : (
          <>
            <section aria-label="Set list">
              <h3 className={s.sectionTitle}>Sets</h3>
              {matrix.sets.length === 0 ? (
                <p className={s.hint}>No sets available.</p>
              ) : (
                <ul className={s.setList}>
                  {matrix.sets.map((set) => (
                    <SetRow
                      key={set.index}
                      set={set}
                      system={set.index < FIRST_USER_SET}
                      onRename={(name) => run(() => vsp.setsRename(set.index, name))}
                      onShow={() => run(() => vsp.setsShow(set.index))}
                      onHide={() => run(() => vsp.setsHide(set.index))}
                      onShowOnly={() => run(() => vsp.setsShowOnly(set.index))}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Membership matrix" className={s.matrixSection}>
              <h3 className={s.sectionTitle}>Membership</h3>
              {matrix.rows.length === 0 ? (
                <EmptyState
                  icon={<Layers size={18} />}
                  title="No components"
                  text="Add a component to assign it to sets."
                />
              ) : (
                <div className={s.matrixWrap}>
                  <table className={s.matrix}>
                    <caption className={s.srOnly}>Which components belong to each set</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={s.cornerHead}>
                          Component
                        </th>
                        {matrix.sets.map((set) => (
                          <th key={set.index} scope="col" className={s.colHead} title={set.name}>
                            <span className={s.colLabel} title={set.name}>{set.name}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map((row) => (
                        <tr key={row.geomId}>
                          <th
                            scope="row"
                            className={s.rowHead}
                            style={{ "--depth": depths.get(row.geomId) ?? 0 } as CSSProperties}
                            title={row.name}
                          >
                            <span className={s.rowName} title={row.name}>{row.name}</span>
                          </th>
                          {matrix.sets.map((set, pos) => (
                            <td key={set.index} className={s.cell}>
                              <input
                                type="checkbox"
                                className={s.check}
                                checked={row.flags[pos] ?? false}
                                aria-label={`${row.name} in ${set.name}`}
                                onChange={(e) => toggleFlag(row.geomId, pos, e.target.checked)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- set list row ----------

interface SetRowProps {
  set: SetListItem;
  system: boolean;
  onRename: (name: string) => void;
  onShow: () => void;
  onHide: () => void;
  onShowOnly: () => void;
}

function SetRow({ set, system, onRename, onShow, onHide, onShowOnly }: SetRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(set.name);
  // Set when Escape cancels, so the blur that follows does not commit.
  const cancelled = useRef(false);

  const startEdit = () => {
    cancelled.current = false;
    setDraft(set.name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const name = draft.trim();
    if (!name || name === set.name) return;
    onRename(name);
  };

  return (
    <li className={s.setRow}>
      <div className={s.setHead}>
        {editing ? (
          <input
            className={s.input}
            aria-label={`Rename set ${set.name}`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className={s.setName} title={set.name}>
            {set.name || `Set ${set.index}`}
          </span>
        )}
        {system ? (
          <span className={s.sysBadge}>System</span>
        ) : (
          !editing && <IconButton icon={<Pencil size={13} />} label={`Rename set ${set.name}`} onClick={startEdit} />
        )}
      </div>
      <div className={s.setActions}>
        <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={onShow}>
          Show
        </Button>
        <Button size="sm" variant="secondary" icon={<EyeOff size={13} />} onClick={onHide}>
          Hide
        </Button>
        <Button size="sm" variant="ghost" onClick={onShowOnly}>
          Show only
        </Button>
      </div>
    </li>
  );
}
