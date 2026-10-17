// Variables > Presets: preset groups, each with saved settings (apply / save
// current values / delete) and the parameters it controls.

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Play, Plus, Save, Trash2, X } from "lucide-react";
import type { PresetGroup } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, IconButton, ParmField } from "../../components";
import { guard } from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useParmStore } from "../../store/parmStore";
import { ParmPicker, type PickedParm } from "../links/ParmPicker";
import { ConfirmModal } from "./ConfirmModal";
import { useStructuralRevision } from "./useStructuralRevision";
import s from "./vars.module.css";

function toast(message: string): void {
  useAppStore.getState().pushToast("success", message);
}

export function PresetsPanel() {
  const rev = useStructuralRevision();
  const [groups, setGroups] = useState<PresetGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmGroup, setConfirmGroup] = useState<PresetGroup | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await vsp.varsPresets({ silent: true });
      if (id !== seq.current) return;
      // Engine values are authoritative after a structural change.
      useParmStore.getState().reset();
      setGroups(res.groups);
      setError(null);
    } catch (e: unknown) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load presets");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, rev]);

  const addGroup = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    guard(async () => {
      await vsp.varsAddGroup(name);
      await load();
    });
  };

  let body;
  if (error) {
    body = <EmptyState title="Could not load presets" text={error} />;
  } else if (groups === null) {
    body = <p className={s.hint}>Loading presets...</p>;
  } else if (groups.length === 0) {
    body = (
      <EmptyState
        title="No preset groups"
        text="Create a group, then save parameter values as settings you can apply later."
      />
    );
  } else {
    body = groups.map((g) => <GroupCard key={g.id} group={g} onChanged={load} onDelete={() => setConfirmGroup(g)} />);
  }

  return (
    <div className={s.panel}>
      <form className={s.addRow} onSubmit={addGroup}>
        <input
          className={s.input}
          aria-label="New preset group name"
          placeholder="New group name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button size="sm" variant="secondary" type="submit" icon={<Plus size={13} />} disabled={!newName.trim()}>
          Add group
        </Button>
      </form>

      {body}

      <ConfirmModal
        open={confirmGroup !== null}
        title="Delete preset group?"
        message={`"${confirmGroup?.name ?? ""}" and its settings will be removed.`}
        confirmLabel="Delete group"
        onClose={() => setConfirmGroup(null)}
        onConfirm={() => {
          const g = confirmGroup;
          if (!g) return;
          guard(async () => {
            await vsp.varsDeleteGroup(g.id);
            await load();
          });
        }}
      />
    </div>
  );
}

// ---------- one group ----------

interface GroupCardProps {
  group: PresetGroup;
  onChanged: () => Promise<void>;
  onDelete: () => void;
}

function GroupCard({ group, onChanged, onDelete }: GroupCardProps) {
  const [open, setOpen] = useState(true);
  const [settingName, setSettingName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const bodyId = useId();

  // Run an engine call, then reload the presets.
  const mutate = (fn: () => Promise<unknown>) =>
    guard(async () => {
      await fn();
      await onChanged();
    });

  const addSetting = (e: FormEvent) => {
    e.preventDefault();
    const name = settingName.trim();
    if (!name) return;
    setSettingName("");
    mutate(() => vsp.varsAddSetting(group.id, name));
  };

  return (
    <section className={s.card} aria-label={`Preset group ${group.name}`}>
      <div className={s.cardHead}>
        <button
          type="button"
          className={s.disclose}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={14} aria-hidden="true" className={open ? s.chevOpen : s.chev} />
          <span className={s.cardTitle}>{group.name}</span>
          <span className={s.count}>{group.parms.length}</span>
        </button>
        <IconButton icon={<Trash2 size={14} />} label={`Delete preset group ${group.name}`} onClick={onDelete} />
      </div>

      {open && (
        <div id={bodyId} className={s.cardBody}>
          <h4 className={s.subTitle}>Settings</h4>
          {group.settings.length === 0 ? (
            <p className={s.hint}>No settings yet. Save the current values to create one.</p>
          ) : (
            <ul className={s.list}>
              {group.settings.map((st) => (
                <li key={st.id} className={s.settingRow}>
                  <span className={s.settingName} title={st.name}>
                    {st.name}
                  </span>
                  <div className={s.settingActions}>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Play size={12} />}
                      onClick={() => mutate(() => vsp.varsApplySetting(st.id))}
                    >
                      Apply
                    </Button>
                    <IconButton
                      icon={<Save size={13} />}
                      label={`Save current values to ${st.name}`}
                      onClick={() =>
                        mutate(async () => {
                          await vsp.varsSaveSetting(st.id);
                          toast(`Saved current values to "${st.name}".`);
                        })
                      }
                    />
                    <IconButton
                      icon={<Trash2 size={13} />}
                      label={`Delete setting ${st.name}`}
                      onClick={() => mutate(() => vsp.varsDeleteSetting(st.id))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className={s.addRow} onSubmit={addSetting}>
            <input
              className={s.input}
              aria-label={`New setting name in ${group.name}`}
              placeholder="New setting name"
              value={settingName}
              onChange={(e) => setSettingName(e.target.value)}
            />
            <Button size="sm" variant="secondary" type="submit" disabled={!settingName.trim()}>
              Add
            </Button>
          </form>

          <h4 className={s.subTitle}>Parameters</h4>
          {group.parms.length === 0 ? (
            <p className={s.hint}>No parameters in this group.</p>
          ) : (
            <ul className={s.parmList}>
              {group.parms.map((p) => (
                <li key={p.id} className={s.parmItem}>
                  <div className={s.parmField}>
                    <ParmField parm={p} />
                  </div>
                  <IconButton
                    icon={<X size={13} />}
                    label={`Remove ${p.label || p.name} from ${group.name}`}
                    onClick={() => mutate(() => vsp.varsDeleteParm(group.id, p.id))}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setPickerOpen(true)}>
            Add parameter
          </Button>
          <ParmPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title={`Add a parameter to ${group.name}`}
            onPick={(p: PickedParm) => mutate(() => vsp.varsAddParm(group.id, p.id))}
          />
        </div>
      )}
    </section>
  );
}
