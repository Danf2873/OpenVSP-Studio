// Compact Scale / Offset / Rotation grid for the selected section. Each cell is a
// NumberField that writes its parm through the editor's setter. A scrub gesture
// passes one coalesce key so the engine records a single undo step.

import { Fragment, useRef } from "react";
import type { Parm } from "../../api/types";
import { NumberField } from "../../components";
import { useParmStore } from "../../store/parmStore";
import s from "./XsecEditor.module.css";

export interface ParmGridRow {
  label: string;
  /** X, Y, Z cells. Null leaves the cell disabled (the parm does not exist for this shape). */
  cells: Array<Parm | null>;
}

export interface SectionParmsProps {
  rows: ParmGridRow[];
  onSet: (parm: Parm, value: number, coalesceKey?: string) => void;
}

const COLS = ["X", "Y", "Z"] as const;

function finiteOrUndef(n: number): number | undefined {
  return Number.isFinite(n) ? n : undefined;
}

export function SectionParms({ rows, onSet }: SectionParmsProps) {
  const live = useParmStore((st) => st.values);
  const gestureKeys = useRef(new Map<string, string>());

  const onChange = (p: Parm, v: number, gesture: boolean) => {
    useParmStore.getState().setLocal(p.id, v);
    if (!gesture) {
      gestureKeys.current.delete(p.id);
      onSet(p, v);
      return;
    }
    let key = gestureKeys.current.get(p.id);
    if (!key) {
      key = `xsec-parm:${p.id}:${Date.now()}`;
      gestureKeys.current.set(p.id, key);
    }
    onSet(p, v, key);
  };

  return (
    <div className={s.parmGrid} role="group" aria-label="Section scale, offset and rotation">
      <span />
      {COLS.map((c) => (
        <span key={c} className={s.parmColHead} aria-hidden="true">
          {c}
        </span>
      ))}
      {rows.map((row) => (
        <Fragment key={row.label}>
          <span className={s.parmRowLabel}>{row.label}</span>
          {row.cells.map((p, ci) => {
            const col = COLS[ci];
            if (!p) {
              return (
                <span key={col} className={s.parmEmpty} title={`${row.label} ${col} is not available for this shape`}>
                  -
                </span>
              );
            }
            const value = live[p.id] ?? p.value;
            return (
              <NumberField
                key={p.id}
                ariaLabel={`${row.label} ${col}`}
                title={p.descr || p.name}
                value={value}
                min={finiteOrUndef(p.min)}
                max={finiteOrUndef(p.max)}
                units={p.units}
                onChange={(v, gesture) => onChange(p, v, gesture)}
                onCommit={() => gestureKeys.current.delete(p.id)}
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
