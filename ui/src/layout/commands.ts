// Static commands (menu actions, view toggles). Dynamic ones (geom types,
// analyses, formats, examples) live in features/palette/appCommands.ts.

import { registerCommands, type Command } from "../features/palette/commands";
import { useUiStore } from "../store/uiStore";
import { useModelStore } from "../store/modelStore";
import * as act from "./actions";

export function staticCommands(): Command[] {
  const ui = () => useUiStore.getState();
  const hasSel = () => useModelStore.getState().selectedGeomId !== null;

  return [
    { id: "file.new", title: "New Model", section: "File", shortcut: "Ctrl+N", run: () => act.newModel() },
    { id: "file.open", title: "Open…", section: "File", shortcut: "Ctrl+O", run: () => act.openModelDialog() },
    { id: "file.save", title: "Save", section: "File", shortcut: "Ctrl+S", run: () => act.saveModel() },
    { id: "file.saveAs", title: "Save As…", section: "File", shortcut: "Ctrl+Shift+S", run: () => act.saveModelAs() },
    { id: "file.insert", title: "Insert Model…", section: "File", run: () => act.insertModelDialog() },
    { id: "edit.undo", title: "Undo", section: "Edit", shortcut: "Ctrl+Z", run: () => act.undo() },
    { id: "edit.redo", title: "Redo", section: "Edit", shortcut: "Ctrl+Y", run: () => act.redo() },
    { id: "edit.cut", title: "Cut Component", section: "Edit", shortcut: "Ctrl+X", enabled: hasSel, run: () => act.cutSelected() },
    { id: "edit.copy", title: "Copy Component", section: "Edit", shortcut: "Ctrl+C", enabled: hasSel, run: () => act.copySelected() },
    { id: "edit.paste", title: "Paste Component", section: "Edit", shortcut: "Ctrl+V", run: () => act.pasteGeom(false) },
    { id: "edit.pasteChild", title: "Paste as Child Component", section: "Edit", enabled: hasSel, run: () => act.pasteGeom(true) },
    { id: "edit.delete", title: "Delete Component", section: "Edit", shortcut: "Delete", enabled: hasSel, run: () => act.deleteSelected() },
    { id: "view.fit", title: "Fit View", section: "View", shortcut: "F", run: () => act.sendView("fit") },
    { id: "view.front", title: "Front View", section: "View", run: () => act.sendView("front") },
    { id: "view.top", title: "Top View", section: "View", run: () => act.sendView("top") },
    { id: "view.side", title: "Side View", section: "View", run: () => act.sendView("side") },
    { id: "view.iso", title: "Isometric View", section: "View", run: () => act.sendView("iso") },
    { id: "view.theme.system", title: "Theme: System", section: "View", run: () => ui().setTheme("system") },
    { id: "view.theme.light", title: "Theme: Light", section: "View", run: () => ui().setTheme("light") },
    { id: "view.theme.dark", title: "Theme: Dark", section: "View", run: () => ui().setTheme("dark") },
    { id: "view.density.compact", title: "Density: Compact", section: "View", run: () => ui().setDensity("compact") },
    { id: "view.density.comfortable", title: "Density: Comfortable", section: "View", run: () => ui().setDensity("comfortable") },
    { id: "xsec.panel", title: "Toggle Cross-Section Editor", section: "View", run: () => ui().toggleXsecPanel() },
    { id: "dock.results", title: "Show Results Dock", section: "View", run: () => act.openDock("results") },
    { id: "dock.console", title: "Show Console", section: "View", run: () => act.openDock("console") },
    { id: "dock.params", title: "Show Parameter Explorer", section: "View", run: () => act.openDock("params") },
    { id: "dock.toggle", title: "Toggle Bottom Dock", section: "View", run: () => ui().toggleDock() },
    { id: "xsec.popout", title: "Pop Out Cross-Section Editor", section: "View", run: () => act.popOutXsec() },
    { id: "app.settings", title: "Settings…", section: "Help", run: () => act.openSettings() },
    { id: "app.about", title: "About OpenVSP Studio", section: "Help", run: () => act.openAbout() },
    { id: "engine.restart", title: "Restart Engine", section: "Help", run: () => act.restartEngine() },
    { id: "palette.open", title: "Open Command Palette", section: "Help", shortcut: "Ctrl+K", run: () => ui().setPaletteOpen(true) },
  ];
}

/** Register the static command set. Returns the disposer. */
export function registerStaticCommands(): () => void {
  return registerCommands(staticCommands());
}
