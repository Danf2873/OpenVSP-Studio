import { Search } from "lucide-react";
import { Button, DropdownMenu, type MenuEntry } from "../components";
import { useAppStore } from "../store/appStore";
import { useModelStore } from "../store/modelStore";
import { useUiStore, type DisplayMode } from "../store/uiStore";
import { prettyName } from "../features/palette/appCommands";
import * as act from "./actions";
import s from "./layout.module.css";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const ANALYSIS_GROUPS = ["Geometry", "Aero", "Mesh", "Other"] as const;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function AppMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 15 L12 4 L22 15 L12 11 Z" style={{ fill: "var(--accent-blue)" }} />
      <path d="M8 19 L12 16 L16 19 Z" style={{ fill: "var(--accent-green)" }} />
    </svg>
  );
}

/** Glass top bar: brand, file name, the menus, and the command palette button. */
export function TopToolbar() {
  const file = useModelStore((st) => st.model?.file ?? null);
  const dirty = useModelStore((st) => st.model?.dirty ?? false);
  const canUndo = useModelStore((st) => st.model?.canUndo ?? false);
  const canRedo = useModelStore((st) => st.model?.canRedo ?? false);
  const hasSel = useModelStore((st) => st.selectedGeomId !== null);
  const info = useAppStore((st) => st.appInfo);
  const recent = useUiStore((st) => st.recentFiles);
  const theme = useUiStore((st) => st.theme);
  const density = useUiStore((st) => st.density);
  const dockOpen = useUiStore((st) => st.dockOpen);
  const dockTab = useUiStore((st) => st.dockTab);
  const xsecPanelOpen = useUiStore((st) => st.xsecPanelOpen);
  const displayMode = useUiStore((st) => st.displayMode);
  const ui = useUiStore.getState;

  const title = file ? baseName(file) : "Untitled";

  const formatItems = (list: { value: number | string; name: string; ext: string }[], run: (f: (typeof list)[number]) => void): MenuEntry[] =>
    list.length === 0
      ? [{ id: "none", label: "None available", disabled: true }]
      : list.map((f) => ({ id: `${f.name}-${f.value}`, label: f.name, onSelect: () => run(f) }));

  const fileMenu: MenuEntry[] = [
    { id: "new", label: "New Model", shortcut: "Ctrl+N", onSelect: () => act.guard(() => act.newModel()) },
    { id: "open", label: "Open…", shortcut: "Ctrl+O", onSelect: () => act.guard(() => act.openModelDialog()) },
    { id: "save", label: "Save", shortcut: "Ctrl+S", onSelect: () => act.guard(() => act.saveModel()) },
    { id: "saveas", label: "Save As…", shortcut: "Ctrl+Shift+S", onSelect: () => act.guard(() => act.saveModelAs()) },
    "separator",
    { id: "insert", label: "Insert Model…", onSelect: () => act.guard(() => act.insertModelDialog()) },
    {
      id: "import",
      label: "Import",
      items: formatItems(info?.importFormats ?? [], (f) => act.guard(() => act.importFormat(f))),
    },
    {
      id: "export",
      label: "Export",
      items: formatItems(info?.exportFormats ?? [], (f) => act.guard(() => act.exportFormat(f))),
    },
    "separator",
    {
      id: "recent",
      label: "Recent",
      items:
        recent.length === 0
          ? [{ id: "none", label: "No recent files", disabled: true }]
          : recent.map((p) => ({ id: `r-${p}`, label: baseName(p), onSelect: () => act.guard(() => act.openModel(p)) })),
    },
  ];

  const editMenu: MenuEntry[] = [
    { id: "undo", label: "Undo", shortcut: "Ctrl+Z", disabled: !canUndo, onSelect: () => act.guard(() => act.undo()) },
    { id: "redo", label: "Redo", shortcut: "Ctrl+Y", disabled: !canRedo, onSelect: () => act.guard(() => act.redo()) },
    "separator",
    { id: "cut", label: "Cut Component", shortcut: "Ctrl+X", disabled: !hasSel, onSelect: () => act.guard(() => act.cutSelected()) },
    { id: "copy", label: "Copy Component", shortcut: "Ctrl+C", disabled: !hasSel, onSelect: () => act.guard(() => act.copySelected()) },
    { id: "paste", label: "Paste Component", shortcut: "Ctrl+V", onSelect: () => act.guard(() => act.pasteGeom(false)) },
    { id: "pastechild", label: "Paste as Child", disabled: !hasSel, onSelect: () => act.guard(() => act.pasteGeom(true)) },
    "separator",
    { id: "delete", label: "Delete Component", shortcut: "Delete", disabled: !hasSel, danger: true, onSelect: () => act.guard(() => act.deleteSelected()) },
  ];

  const addMenu: MenuEntry[] =
    (info?.geomTypes ?? []).length === 0
      ? [{ id: "none", label: "Engine not ready", disabled: true }]
      : (info?.geomTypes ?? []).map((t) => ({
          id: `add-${t}`,
          label: prettyName(t),
          onSelect: () => act.guard(() => act.addGeom(t)),
        }));

  const analysisMenu: MenuEntry[] = ANALYSIS_GROUPS.map((group) => {
    const items = (info?.analyses ?? [])
      .filter((a) => a.group === group)
      .map((a) => ({ id: `an-${a.name}`, label: a.name, onSelect: () => act.focusAnalysis(a.name) }));
    return { id: `g-${group}`, label: group, items: items.length ? items : [{ id: "none", label: "None", disabled: true }] };
  });

  const themeItems: MenuEntry[] = (["system", "light", "dark"] as const).map((t) => ({
    id: `theme-${t}`,
    label: t === "system" ? "System" : t === "light" ? "Light" : "Dark",
    checked: theme === t,
    onSelect: () => ui().setTheme(t),
  }));

  const densityItems: MenuEntry[] = (["comfortable", "compact"] as const).map((d) => ({
    id: `density-${d}`,
    label: d === "compact" ? "Compact" : "Comfortable",
    checked: density === d,
    onSelect: () => ui().setDensity(d),
  }));

  const viewMenu: MenuEntry[] = [
    { id: "fit", label: "Fit View", shortcut: "F", onSelect: () => act.sendView("fit") },
    { id: "front", label: "Front", onSelect: () => act.sendView("front") },
    { id: "top", label: "Top", onSelect: () => act.sendView("top") },
    { id: "side", label: "Side", onSelect: () => act.sendView("side") },
    { id: "iso", label: "Isometric", onSelect: () => act.sendView("iso") },
    "separator",
    {
      id: "display",
      label: "Display",
      items: (
        [
          ["shaded", "Shaded"],
          ["shaded-wire", "Shaded + Wire"],
          ["wire", "Wire"],
        ] as [DisplayMode, string][]
      ).map(([m, label]) => ({
        id: `display-${m}`,
        label,
        checked: displayMode === m,
        onSelect: () => ui().setDisplayMode(m),
      })),
    },
    { id: "theme", label: "Theme", items: themeItems },
    { id: "density", label: "Density", items: densityItems },
    "separator",
    { id: "xsec-panel", label: "Cross-section editor", checked: xsecPanelOpen, onSelect: () => ui().toggleXsecPanel() },
    "separator",
    { id: "dock-results", label: "Results Panel", checked: dockOpen && dockTab === "results", onSelect: () => act.toggleDock("results") },
    { id: "dock-console", label: "Console", checked: dockOpen && dockTab === "console", onSelect: () => act.toggleDock("console") },
    { id: "dock-params", label: "Parameter Explorer", checked: dockOpen && dockTab === "params", onSelect: () => act.toggleDock("params") },
  ];

  const helpMenu: MenuEntry[] = [
    { id: "about", label: "About OpenVSP Studio", onSelect: () => act.openAbout() },
    { id: "settings", label: "Settings…", onSelect: () => act.openSettings() },
    "separator",
    { id: "restart", label: "Restart Engine", onSelect: () => act.guard(() => act.restartEngine()) },
  ];

  return (
    <header className={s.toolbar}>
      <div className={s.brand}>
        <AppMark />
        <span className={s.appName}>OpenVSP Studio</span>
        <span className={s.fileName} title={file ?? "Not saved yet"}>
          {title}
        </span>
        {dirty && <span className={s.dirtyDot} role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
      </div>

      <nav className={s.menus} aria-label="Main menu">
        <DropdownMenu items={fileMenu} ariaLabel="File">
          <Button size="sm" variant="ghost">File</Button>
        </DropdownMenu>
        <DropdownMenu items={editMenu} ariaLabel="Edit">
          <Button size="sm" variant="ghost">Edit</Button>
        </DropdownMenu>
        <DropdownMenu items={addMenu} ariaLabel="Add">
          <Button size="sm" variant="ghost">Add</Button>
        </DropdownMenu>
        <DropdownMenu items={analysisMenu} ariaLabel="Analysis">
          <Button size="sm" variant="ghost">Analysis</Button>
        </DropdownMenu>
        <DropdownMenu items={viewMenu} ariaLabel="View">
          <Button size="sm" variant="ghost">View</Button>
        </DropdownMenu>
        <DropdownMenu items={helpMenu} ariaLabel="Help">
          <Button size="sm" variant="ghost">Help</Button>
        </DropdownMenu>
      </nav>

      <div className={s.spacer} />

      <Button
        size="sm"
        variant="secondary"
        icon={<Search size={13} />}
        onClick={() => ui().setPaletteOpen(true)}
        title="Command palette"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <span className={s.searchLabel}>Search</span>
        <kbd className={s.kbd}>{IS_MAC ? "⌘K" : "Ctrl+K"}</kbd>
      </Button>
    </header>
  );
}
