// Pick an airfoil for the selected section: a searchable list of the engine's
// airfoil library, or a file from disk via the native (or browser) open dialog.

import { useEffect, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";
import { dialogs } from "../../api/client";
import type { AirfoilLibraryItem } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, Modal, Spinner } from "../../components";
import s from "./XsecEditor.module.css";

export interface AirfoilDialogProps {
  open: boolean;
  /** Must be referentially stable (Modal re-focuses when it changes). */
  onClose: () => void;
  onPick: (path: string) => void;
}

export function AirfoilDialog({ open, onClose, onPick }: AirfoilDialogProps) {
  const [items, setItems] = useState<AirfoilLibraryItem[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null);
    setQuery("");
    // A failed list call is already reported as a toast by the client.
    vsp
      .xsecAirfoilLibrary()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const shown = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const browse = () => {
    void dialogs
      .open({ filters: [{ name: "Airfoil", extensions: ["dat", "af"] }], title: "Load airfoil" })
      .then((p) => {
        if (typeof p === "string") onPick(p);
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load airfoil"
      footer={
        <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={browse}>
          Browse…
        </Button>
      }
    >
      <input
        type="search"
        className={s.searchInput}
        placeholder="Search airfoils"
        aria-label="Search airfoils"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {items === null ? (
        <div className={s.loadingRow}>
          <Spinner label="Loading airfoils" />
          <span>Loading airfoils</span>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? "No airfoil files" : "No matches"}
          text={items.length === 0 ? "Files in the OpenVSP airfoil folder appear here. Use Browse to pick one from disk." : `Nothing matches "${query.trim()}".`}
        />
      ) : (
        <ul className={s.libList} aria-label="Airfoil library">
          {shown.map((it) => (
            <li key={it.path}>
              <button type="button" className={s.libItem} title={it.path} onClick={() => onPick(it.path)}>
                {it.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
