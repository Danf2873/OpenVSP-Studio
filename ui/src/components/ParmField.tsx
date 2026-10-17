// One engine parameter, rendered as the right control for its type.

import { useId, useRef } from "react";
import type { Parm } from "../api/types";
import { vsp } from "../api/vsp";
import { useModelStore } from "../store/modelStore";
import { useParmStore } from "../store/parmStore";
import { Chip } from "./Card";
import { NumberField } from "./NumberField";
import { Select } from "./Select";
import { Slider } from "./Slider";
import { Switch } from "./Switch";
import s from "./ui.module.css";

// ---------- write path ----------
// Per parameter: at most one parms.set in flight; newer values replace queued
// ones, so a fast scrub never floods the engine and the final value always lands.

interface SendState {
  busy: boolean;
  next: { value: number; key?: string } | null;
}

const sendStates = new Map<string, SendState>();

function enqueueSet(parmId: string, value: number, key?: string): void {
  let st = sendStates.get(parmId);
  if (!st) {
    st = { busy: false, next: null };
    sendStates.set(parmId, st);
  }
  st.next = { value, key };
  if (!st.busy) void pumpSet(parmId, st);
}

async function pumpSet(parmId: string, st: SendState): Promise<void> {
  st.busy = true;
  try {
    while (st.next) {
      const job = st.next;
      st.next = null;
      try {
        const res = await vsp.parmsSet(parmId, job.value, job.key);
        // If a newer value is already queued, keep the local edit for this parm.
        useParmStore.getState().applyResult(res, st.next !== null);
        if (res.dirtyGeoms.length > 0) useModelStore.getState().noteDirty(res.dirtyGeoms);
      } catch {
        // The client has already raised a toast for the failed call.
      }
    }
  } finally {
    st.busy = false;
  }
}

// ---------- component ----------

function isFiniteRange(lo: number, hi: number): boolean {
  return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo && hi - lo < 1e6;
}

export interface ParmFieldProps {
  parm: Parm;
}

export function ParmField({ parm }: ParmFieldProps) {
  const live = useParmStore((st) => st.values[parm.id]);
  const value = live ?? parm.value;
  const gestureKey = useRef<string | null>(null);
  const autoId = useId();

  const label = parm.label || parm.name;
  const title = parm.descr ? `${parm.descr}` : parm.name;

  const onChange = (v: number, gesture: boolean) => {
    useParmStore.getState().setLocal(parm.id, v);
    let key: string | undefined;
    if (gesture) {
      if (gestureKey.current === null) gestureKey.current = `${parm.id}:${Date.now()}`;
      key = gestureKey.current;
    }
    enqueueSet(parm.id, v, key);
  };

  const onCommit = () => {
    gestureKey.current = null;
  };

  // Enum-like ints (not bitmask): a select.
  if (parm.options && parm.options.length > 0 && !parm.bitmask && parm.type !== "bool") {
    const iv = Math.round(value);
    const known = parm.options.some((o) => o.value === iv);
    const opts = parm.options.map((o) => ({ value: String(o.value), label: o.label }));
    if (!known) opts.push({ value: String(iv), label: `Other (${iv})` });
    return (
      <div className={s.parmLine} title={title}>
        <label htmlFor={autoId} className={s.parmLabel} title={title}>
          {label}
        </label>
        <Select
          id={autoId}
          className={s.parmSelect}
          value={String(iv)}
          options={opts}
          ariaLabel={label}
          onChange={(v) => onChange(Number(v), false)}
        />
      </div>
    );
  }

  // Bitmask: OR-able flags as toggle chips.
  if (parm.bitmask && parm.options) {
    const iv = Math.round(value);
    return (
      <div className={s.parmRow} title={title}>
        <span className={s.parmLabel} data-static="true">
          {label}
        </span>
        <div className={s.chipRow} role="group" aria-label={label}>
          {parm.options.map((o) => (
            <Chip
              key={o.value}
              pressed={o.value === 0 ? iv === 0 : (iv & o.value) === o.value}
              title={o.label}
              onClick={() => onChange(o.value === 0 ? 0 : iv ^ o.value, false)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </div>
    );
  }

  if (parm.type === "bool") {
    return (
      <Switch
        checked={Math.round(value) !== 0}
        label={label}
        title={title}
        onChange={(c) => onChange(c ? 1 : 0, false)}
      />
    );
  }

  const isInt = parm.type === "int" || parm.type === "limited_int" || parm.type === "power_int";

  if (isInt) {
    return (
      <NumberField
        label={label}
        title={title}
        value={value}
        integer
        min={Number.isFinite(parm.min) ? parm.min : undefined}
        max={Number.isFinite(parm.max) ? parm.max : undefined}
        units={parm.units}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
  }

  // double, fraction, noteq, other
  const lo = parm.type === "fraction" ? 0 : parm.min;
  const hi = parm.type === "fraction" ? 1 : parm.max;
  const showSlider = isFiniteRange(lo, hi);
  const clamped = showSlider ? Math.min(hi, Math.max(lo, value)) : value;

  return (
    <div className={s.parmRow}>
      <NumberField
        label={label}
        title={title}
        value={value}
        min={Number.isFinite(lo) ? lo : undefined}
        max={Number.isFinite(hi) ? hi : undefined}
        units={parm.units}
        onChange={onChange}
        onCommit={onCommit}
      />
      {showSlider && (
        <Slider
          value={clamped}
          min={lo}
          max={hi}
          ariaLabel={`${label} slider`}
          onChange={onChange}
          onCommit={onCommit}
        />
      )}
    </div>
  );
}
