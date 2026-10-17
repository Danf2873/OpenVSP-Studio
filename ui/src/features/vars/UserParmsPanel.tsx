// Variables > User parms: user-defined parameters (editable inline) and a form
// to add a new one.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { Parm } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, ParmField, Select } from "../../components";
import { guard } from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useStructuralRevision } from "./useStructuralRevision";
import s from "./vars.module.css";

const DEFAULT_GROUP = "User";

export function UserParmsPanel() {
  const rev = useStructuralRevision();
  const [parms, setParms] = useState<Parm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState(DEFAULT_GROUP);
  const [type, setType] = useState<"double" | "int">("double");
  const [formError, setFormError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await vsp.varsUserParms({ silent: true });
      if (id !== seq.current) return;
      setParms(res);
      setError(null);
    } catch (e: unknown) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load user parameters");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, rev]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const g = group.trim();
    if (!n) {
      setFormError("Enter a name for the parameter.");
      return;
    }
    if (!g) {
      setFormError("Enter a group name.");
      return;
    }
    setFormError(null);
    guard(async () => {
      await vsp.varsAddUserParm(type, n, g);
      setName("");
      useAppStore.getState().pushToast("success", `Added user parameter "${n}".`);
      await load();
    });
  };

  let list;
  if (error) {
    list = <EmptyState title="Could not load user parameters" text={error} />;
  } else if (parms === null) {
    list = <p className={s.hint}>Loading user parameters...</p>;
  } else if (parms.length === 0) {
    list = <p className={s.hint}>No user parameters yet. Add one below.</p>;
  } else {
    list = (
      <ul className={s.parmList}>
        {parms.map((p) => (
          <li key={p.id} className={s.parmItemPlain}>
            <ParmField parm={p} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={s.panel}>
      {list}

      <form className={s.userForm} onSubmit={submit} aria-label="Add user parameter" noValidate>
        <h4 className={s.subTitle}>Add user parameter</h4>
        <label className={s.fieldLabel}>
          <span>Name</span>
          <input
            className={s.input}
            value={name}
            placeholder="e.g. WingSpanTarget"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={formError !== null || undefined}
          />
        </label>
        <div className={s.formRow}>
          <label className={s.fieldLabel}>
            <span>Group</span>
            <input className={s.input} value={group} onChange={(e) => setGroup(e.target.value)} />
          </label>
          <div className={s.fieldLabel}>
            <span>Type</span>
            <Select
              value={type}
              options={[
                { value: "double", label: "Decimal" },
                { value: "int", label: "Integer" },
              ]}
              onChange={(v) => setType(v === "int" ? "int" : "double")}
              ariaLabel="User parameter type"
              className={s.kindSelect}
            />
          </div>
        </div>
        {formError && (
          <p className={s.formError} role="alert">
            {formError}
          </p>
        )}
        <div>
          <Button size="sm" variant="primary" type="submit" icon={<Plus size={13} />}>
            Add parameter
          </Button>
        </div>
      </form>
    </div>
  );
}
