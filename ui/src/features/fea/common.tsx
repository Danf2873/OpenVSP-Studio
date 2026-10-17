// Building blocks shared by the three Structures tabs.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { Id, ParmGroup } from "../../api/types";
import { vsp } from "../../api/vsp";
import {
  Button,
  EmptyState,
  IconButton,
  Modal,
  ParmGroupList,
  Select,
  Spinner,
  cx,
  type SelectOption,
} from "../../components";
import { useParmStore } from "../../store/parmStore";
import { errorText, useStructuralSeq } from "./feaData";
import css from "./fea.module.css";

/** The parameter container currently shown in the lower panel. */
export interface Selection {
  id: Id;
  label: string;
}

export interface ConfirmRequest {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
}

// ---------- confirm ----------

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const confirmNow = () => {
    if (!request) return;
    const run = request.onConfirm;
    onClose();
    run();
  };
  return (
    <Modal
      open={request !== null}
      onClose={onClose}
      title={request?.title ?? ""}
      footer={
        request ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmNow}>
              {request.confirmLabel}
            </Button>
          </>
        ) : null
      }
    >
      <p className={css.confirmText}>{request?.text}</p>
    </Modal>
  );
}

// ---------- editable label ----------

export interface EditableLabelProps {
  name: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
  /** Omit to make the label read-only. */
  onRename?: (name: string) => void;
  className?: string;
}

/** Selectable label; double-click or F2 renames it inline (Enter saves, Escape cancels). */
export function EditableLabel({ name, meta, selected, onSelect, onRename, className }: EditableLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const finished = useRef(false);

  const start = () => {
    if (!onRename) return;
    finished.current = false;
    setDraft(name);
    setEditing(true);
  };

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const next = draft.trim();
    if (save && onRename && next && next !== name) onRename(next);
  };

  if (editing) {
    return (
      <input
        className={css.renameInput}
        aria-label={`Rename ${name}`}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={cx(css.label, className)}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={start}
      onKeyDown={(e) => {
        if (e.key === "F2") {
          e.preventDefault();
          start();
        }
      }}
      title={onRename ? `${name} (double-click or F2 to rename)` : name}
    >
      <span className={css.labelName}>{name}</span>
      {meta && <span className={css.labelMeta}>{meta}</span>}
    </button>
  );
}

// ---------- row ----------

export interface ItemRowProps {
  name: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  deleteLabel: string;
}

export function ItemRow({ name, meta, selected, onSelect, onRename, onDelete, deleteLabel }: ItemRowProps) {
  return (
    <div className={css.row} data-selected={selected}>
      <EditableLabel name={name} meta={meta} selected={selected} onSelect={onSelect} onRename={onRename} />
      {onDelete && <IconButton label={deleteLabel} icon={<Trash2 size={13} />} onClick={onDelete} />}
    </div>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className={css.sectionHead}>
      <span className={css.sectionTitle}>{title}</span>
      {action}
    </div>
  );
}

// ---------- geom select ----------

export interface GeomSelectProps {
  id?: string;
  value: string;
  geoms: { id: Id; name: string }[];
  onChange: (id: string) => void;
  label: string;
}

export function GeomSelect({ id, value, geoms, onChange, label }: GeomSelectProps) {
  const options: SelectOption[] =
    geoms.length === 0
      ? [{ value: "", label: "No components", disabled: true }]
      : geoms.map((g) => ({ value: g.id, label: g.name }));
  return <Select id={id} value={value} options={options} onChange={onChange} ariaLabel={label} />;
}

// ---------- parameters ----------

export function ParmsPanel({ containerId, title }: { containerId: Id | null; title: string | null }) {
  if (containerId === null) {
    return <div className={css.hint}>Select an item to edit its parameters.</div>;
  }
  return <ParmsLoader key={containerId} containerId={containerId} title={title ?? ""} />;
}

function ParmsLoader({ containerId, title }: { containerId: Id; title: string }) {
  const seq = useStructuralSeq();
  const [groups, setGroups] = useState<ParmGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    vsp
      .parmsList(containerId, { silent: true })
      .then((g) => {
        if (!live) return;
        // Fresh server values supersede any locally edited overrides.
        useParmStore.getState().reset();
        setGroups(g);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [containerId, seq]);

  return (
    <div className={css.parmsWrap}>
      <div className={css.parmsHead}>
        <span className={css.parmsTitle}>{title}</span>
      </div>
      {error ? (
        <EmptyState title="Could not load parameters" text={error} />
      ) : groups === null ? (
        <div className={css.loading}>
          <Spinner label="Loading parameters" />
        </div>
      ) : (
        <div className={css.parmsBody}>
          <ParmGroupList groups={groups} />
        </div>
      )}
    </div>
  );
}

// ---------- resizable split ----------

const MIN_TOP = 120;
const MIN_BOTTOM = 96;

/** Top list with a draggable (and arrow-key adjustable) lower panel. */
export function SplitPane({ top, bottom, label }: { top: ReactNode; bottom: ReactNode; label: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(260);
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  const clamp = (h: number) => {
    const total = rootRef.current?.clientHeight ?? 600;
    return Math.round(Math.max(MIN_BOTTOM, Math.min(h, total - MIN_TOP)));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, startH: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setHeight(clamp(d.startH - (e.clientY - d.startY)));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHeight((h) => clamp(h + 24));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHeight((h) => clamp(h - 24));
    }
  };

  return (
    <div ref={rootRef} className={css.split}>
      <div className={css.splitTop}>{top}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={`Resize ${label} panel`}
        aria-valuenow={height}
        aria-valuemin={MIN_BOTTOM}
        tabIndex={0}
        className={css.splitHandle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span className={css.splitGrip} aria-hidden="true" />
      </div>
      <div className={css.splitBottom} style={{ height }}>
        {bottom}
      </div>
    </div>
  );
}
