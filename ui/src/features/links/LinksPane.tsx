// Sidebar "Links" pane: the list of link scripts (add, rename, delete) and the
// editor for the selected link.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link2, Pencil, Trash2 } from "lucide-react";
import type { LinkListItem } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, IconButton } from "../../components";
import { guard } from "../../layout/actions";
import { ConfirmModal } from "../vars/ConfirmModal";
import { LinkEditor } from "./LinkEditor";
import { useStructuralRevision } from "./useStructuralRevision";
import s from "./links.module.css";

export function LinksPane() {
  const rev = useStructuralRevision();
  const [links, setLinks] = useState<LinkListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<LinkListItem | null>(null);
  // Unsaved script text per link index. Cleared when links are deleted, since
  // deleting shifts the indices.
  const drafts = useRef(new Map<number, string>());
  const seq = useRef(0);

  const load = useCallback(async (): Promise<LinkListItem[] | null> => {
    const id = ++seq.current;
    try {
      const list = await vsp.linksList({ silent: true });
      if (id !== seq.current) return null;
      setLinks(list);
      setError(null);
      setSelected((cur) => (cur !== null && list.some((l) => l.index === cur) ? cur : (list[0]?.index ?? null)));
      return list;
    } catch (e: unknown) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Could not load links");
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, rev]);

  const addLink = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    guard(async () => {
      await vsp.linksAdd(name);
      // A new link is always the last index.
      const list = await load();
      const last = list?.[list.length - 1];
      if (last) setSelected(last.index);
    });
  };

  const renameLink = (index: number, name: string) =>
    guard(async () => {
      await vsp.linksRename(index, name);
      await load();
    });

  const deleteLink = (link: LinkListItem) =>
    guard(async () => {
      await vsp.linksDelete(link.index);
      drafts.current.clear();
      setSelected(null);
      await load();
    });

  let body;
  if (error) {
    body = <EmptyState title="Could not load links" text={error} />;
  } else if (links === null) {
    body = <p className={s.hint}>Loading links...</p>;
  } else if (links.length === 0) {
    body = (
      <EmptyState
        icon={<Link2 size={18} />}
        title="No links yet"
        text="A link is a short script that reads parameters, computes new values and writes them back."
      />
    );
  } else {
    body = (
      <ul className={s.linkList} aria-label="Links">
        {links.map((link) => (
          <LinkRow
            key={link.index}
            link={link}
            active={link.index === selected}
            onSelect={() => setSelected(link.index)}
            onRename={(name) => renameLink(link.index, name)}
            onDelete={() => setConfirmDelete(link)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <span className={s.paneTitle}>Links</span>
      </div>

      <div className={s.body}>
        <form className={s.addRow} onSubmit={addLink}>
          <input
            className={s.input}
            aria-label="New link name"
            placeholder="New link name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!newName.trim()}>
            Add link
          </Button>
        </form>

        {body}

        {selected !== null && links !== null && links.some((l) => l.index === selected) && (
          <LinkEditor key={selected} index={selected} rev={rev} drafts={drafts} />
        )}
      </div>

      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete link?"
        message={`"${confirmDelete?.name ?? ""}" and its inputs, outputs and script will be removed.`}
        confirmLabel="Delete link"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const link = confirmDelete;
          if (link) deleteLink(link);
        }}
      />
    </div>
  );
}

// ---------- list row ----------

interface LinkRowProps {
  link: LinkListItem;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function LinkRow({ link, active, onSelect, onRename, onDelete }: LinkRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.name);
  // Set when Escape cancels, so the blur that follows does not commit.
  const cancelled = useRef(false);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const name = draft.trim();
    if (!name || name === link.name) return;
    onRename(name);
  };

  return (
    <li className={s.linkRow} data-active={active}>
      {editing ? (
        <input
          className={s.input}
          aria-label={`Rename link ${link.name}`}
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
        <button
          type="button"
          className={s.linkSelect}
          aria-pressed={active}
          title={link.name}
          onClick={onSelect}
        >
          <span className={s.linkIndex}>{link.index}</span>
          <span className={s.linkName}>{link.name || `Link ${link.index}`}</span>
        </button>
      )}
      {!editing && (
        <>
          <IconButton
            icon={<Pencil size={13} />}
            label={`Rename link ${link.name}`}
            onClick={() => {
              cancelled.current = false;
              setDraft(link.name);
              setEditing(true);
            }}
          />
          <IconButton icon={<Trash2 size={13} />} label={`Delete link ${link.name}`} onClick={onDelete} />
        </>
      )}
    </li>
  );
}
