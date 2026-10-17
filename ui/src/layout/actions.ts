// Every user action in one place. Menus, shortcuts and the command palette
// all call these. Engine errors are toasted by the client; anything else that
// throws here is toasted by guard().

import { dialogs, isTauri, RpcError } from "../api/client";
import { engineRestart, openPopoutWindow } from "../api/settings";
import { vsp } from "../api/vsp";
import type { FormatInfo, Id, Vec3 } from "../api/types";
import { useAppStore } from "../store/appStore";
import { useModelStore } from "../store/modelStore";
import { useUiStore, type DockTabId, type ViewKind } from "../store/uiStore";

const MODEL_FILTERS = [{ name: "OpenVSP model", extensions: ["vsp3"] }];

/** Run an async action; unexpected failures become toasts (engine errors already are). */
export function guard(fn: () => Promise<unknown>): void {
  fn().catch((err: unknown) => {
    if (err instanceof RpcError) return;
    useAppStore.getState().pushToast("error", err instanceof Error ? err.message : String(err));
  });
}

function selectedId(): Id | null {
  return useModelStore.getState().selectedGeomId;
}

function toast(message: string): void {
  useAppStore.getState().pushToast("success", message);
}

function stripDot(ext: string): string {
  return ext.replace(/^\./, "");
}

// ---------- file ----------

export function addRecent(path: string): void {
  const ui = useUiStore.getState();
  ui.setRecentFiles([path, ...ui.recentFiles.filter((p) => p !== path)]);
}

export async function newModel(): Promise<void> {
  await vsp.modelNew();
  useUiStore.getState().dismissWelcome();
  useModelStore.getState().setSelected(null);
}

export async function openModel(path: string): Promise<void> {
  await vsp.modelOpen(path);
  addRecent(path);
  useModelStore.getState().setSelected(null);
}

export async function openModelDialog(): Promise<void> {
  const p = await dialogs.open({ filters: MODEL_FILTERS, title: "Open model" });
  if (typeof p === "string") await openModel(p);
}

export async function saveModelAs(): Promise<void> {
  const model = useModelStore.getState().model;
  const p = await dialogs.save({ filters: MODEL_FILTERS, defaultPath: model?.file ?? "untitled.vsp3", title: "Save model" });
  if (!p) return;
  await vsp.modelSave(p);
  addRecent(p);
  toast("Model saved");
}

export async function saveModel(): Promise<void> {
  const model = useModelStore.getState().model;
  if (!model?.file) return saveModelAs();
  await vsp.modelSave();
  toast("Model saved");
}

export async function insertModelDialog(): Promise<void> {
  const p = await dialogs.open({ filters: MODEL_FILTERS, title: "Insert model" });
  if (typeof p === "string") await vsp.modelInsert(p);
}

export async function importFormat(fmt: FormatInfo): Promise<void> {
  const p = await dialogs.open({
    filters: [{ name: fmt.name, extensions: [stripDot(fmt.ext)] }],
    title: `Import ${fmt.name}`,
  });
  if (typeof p === "string") {
    await vsp.ioImport(p, fmt.value);
    toast(`Imported ${fmt.name}`);
  }
}

export async function exportFormat(fmt: FormatInfo): Promise<void> {
  const ext = stripDot(fmt.ext);
  const p = await dialogs.save({
    filters: [{ name: fmt.name, extensions: [ext] }],
    defaultPath: `export.${ext}`,
    title: `Export ${fmt.name}`,
  });
  if (!p) return;
  await vsp.ioExport(p, fmt.value);
  toast(`Exported ${fmt.name}`);
}

// ---------- edit ----------

export const undo = () => vsp.modelUndo();
export const redo = () => vsp.modelRedo();

export async function copySelected(): Promise<void> {
  const id = selectedId();
  if (id) await vsp.geomCopy([id]);
}

export async function cutSelected(): Promise<void> {
  const id = selectedId();
  if (!id) return;
  await vsp.geomCut([id]);
  useModelStore.getState().setSelected(null);
}

export async function pasteGeom(asChild: boolean): Promise<void> {
  const parent = asChild ? selectedId() ?? undefined : undefined;
  const res = await vsp.geomPaste(parent);
  if (res.ids.length > 0) useModelStore.getState().setSelected(res.ids[0]);
}

export async function deleteSelected(): Promise<void> {
  const id = selectedId();
  if (!id) return;
  await vsp.geomDelete([id]);
  useModelStore.getState().setSelected(null);
}

export async function renameGeom(id: Id, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await vsp.geomRename(id, trimmed);
}

export async function setGeomShown(ids: Id[], shown: boolean): Promise<void> {
  await vsp.geomSetShown(ids, shown);
}

export async function setGeomColor(id: Id, color: Vec3, coalesceKey?: string): Promise<void> {
  await vsp.geomSetColor(id, color, coalesceKey);
}

export async function reparentGeom(id: Id, parentId: Id | null): Promise<void> {
  await vsp.geomReparent(id, parentId);
}

// ---------- add / analysis ----------

export async function addGeom(type: string, parentId?: Id): Promise<void> {
  const res = await vsp.geomAdd(type, parentId);
  useModelStore.getState().setSelected(res.id);
}

export function focusAnalysis(name: string): void {
  useUiStore.getState().focusAnalysis(name);
}

// ---------- view / panels ----------

export function sendView(kind: ViewKind): void {
  useUiStore.getState().sendView(kind);
}

export function toggleDock(tab: DockTabId): void {
  useUiStore.getState().toggleDock(tab);
}

export function openDock(tab: DockTabId): void {
  useUiStore.getState().openDock(tab);
}

export async function popOutXsec(): Promise<void> {
  const title = "Cross-Section Editor";
  if (isTauri) {
    await openPopoutWindow("xsec", title, "index.html#/xsec");
  } else {
    window.open(`${window.location.pathname}#/xsec`, "_blank", "width=1100,height=760");
  }
}

export async function restartEngine(): Promise<void> {
  if (!isTauri) {
    useAppStore.getState().pushToast("info", "Restart the engine process from its terminal (browser mode).");
    return;
  }
  await engineRestart();
}

export function openSettings(): void {
  useUiStore.getState().setSettingsOpen(true);
}

export function openAbout(): void {
  useUiStore.getState().setAboutOpen(true);
}

/** Fill the command-palette-style parameter search and jump to the explorer. */
export function searchParams(query: string): void {
  useUiStore.getState().openParams(query);
}
