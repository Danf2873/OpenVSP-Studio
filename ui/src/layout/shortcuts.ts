// Global keyboard shortcuts. Editing fields keep their native behaviour.

import { useEffect } from "react";
import * as act from "./actions";
import { useModelStore } from "../store/modelStore";
import { useUiStore } from "../store/uiStore";

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function hasTextSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && sel.toString().length > 0;
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const ui = useUiStore.getState();

      if (mod && key === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }

      if (ui.paletteOpen || ui.settingsOpen || ui.aboutOpen) return;

      // Save is allowed even while a field has focus.
      if (mod && key === "s") {
        e.preventDefault();
        if (e.shiftKey) act.guard(() => act.saveModelAs());
        else act.guard(() => act.saveModel());
        return;
      }

      if (isEditable(e.target)) return;

      if (mod && key === "o") {
        e.preventDefault();
        act.guard(() => act.openModelDialog());
        return;
      }
      if (mod && key === "n") {
        e.preventDefault();
        act.guard(() => act.newModel());
        return;
      }
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        act.guard(() => act.undo());
        return;
      }
      if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        act.guard(() => act.redo());
        return;
      }

      const hasSel = useModelStore.getState().selectedGeomId !== null;

      if (mod && !e.altKey && (key === "c" || key === "x" || key === "v")) {
        if (key !== "v" && hasTextSelection()) return;
        e.preventDefault();
        if (key === "c" && hasSel) act.guard(() => act.copySelected());
        else if (key === "x" && hasSel) act.guard(() => act.cutSelected());
        else if (key === "v") act.guard(() => act.pasteGeom(hasSel));
        return;
      }

      if (mod) return;

      if (e.key === "Delete" && hasSel) {
        e.preventDefault();
        act.guard(() => act.deleteSelected());
        return;
      }

      if (key === "f" && !e.altKey) {
        act.sendView("fit");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
