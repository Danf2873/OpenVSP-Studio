// UI-only state: panels, theme, overlays, viewport display mode.

import { create } from "zustand";
import { saveSettings } from "../api/settings";
import type { Density, Theme } from "../api/types";

export type SidebarTabId = "model" | "analyses" | "sets" | "vars" | "links" | "fea";
export type DockTabId = "results" | "console" | "params";
export type DisplayMode = "shaded" | "shaded-wire" | "wire";
export type ViewKind = "front" | "top" | "side" | "iso" | "fit";

interface UiState {
  sidebarTab: SidebarTabId;
  setSidebarTab: (tab: SidebarTabId) => void;

  dockTab: DockTabId;
  dockOpen: boolean;
  openDock: (tab: DockTabId) => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: (tab?: DockTabId) => void;

  /** The cross-section editor is a left panel beside the viewport (not a dock tab). */
  xsecPanelOpen: boolean;
  setXsecPanelOpen: (open: boolean) => void;
  openXsecPanel: () => void;
  toggleXsecPanel: () => void;

  theme: Theme;
  density: Density;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
  /** Applied from loaded settings without re-saving. */
  applyLoaded: (theme: Theme, density: Density) => void;

  displayMode: DisplayMode;
  setDisplayMode: (mode: DisplayMode) => void;

  viewCommand: { kind: ViewKind; seq: number };
  sendView: (kind: ViewKind) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;

  /** Set by the command palette; the parameter explorer reads it. */
  paramQuery: string;
  openParams: (query: string) => void;

  /** Analysis to select when the Analyses sidebar tab opens. */
  analysisFocus: string | null;
  focusAnalysis: (name: string) => void;

  /** Set once the user asks for an empty model, so the welcome screen stays away. */
  welcomeDismissed: boolean;
  dismissWelcome: () => void;

  recentFiles: string[];
  setRecentFiles: (files: string[]) => void;
}

const XSEC_PANEL_KEY = "openvsp-studio.xsecPanelOpen";

/** Panel visibility is remembered per browser; storage may be unavailable. */
function readXsecPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(XSEC_PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeXsecPanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(XSEC_PANEL_KEY, open ? "1" : "0");
  } catch {
    // storage unavailable; the choice lasts for this session only
  }
}

function applyAppearance(theme: Theme, density: Density): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  root.setAttribute("data-density", density);
}

export const useUiStore = create<UiState>()((set, get) => ({
  sidebarTab: "model",
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  dockTab: "results",
  dockOpen: true,
  openDock: (tab) => set({ dockTab: tab, dockOpen: true }),
  setDockOpen: (open) => set({ dockOpen: open }),
  xsecPanelOpen: readXsecPanelOpen(),
  setXsecPanelOpen: (open) => {
    writeXsecPanelOpen(open);
    set({ xsecPanelOpen: open });
  },
  openXsecPanel: () => get().setXsecPanelOpen(true),
  toggleXsecPanel: () => get().setXsecPanelOpen(!get().xsecPanelOpen),
  toggleDock: (tab) => {
    const s = get();
    if (tab === undefined) {
      set({ dockOpen: !s.dockOpen });
    } else if (s.dockOpen && s.dockTab === tab) {
      set({ dockOpen: false });
    } else {
      set({ dockTab: tab, dockOpen: true });
    }
  },

  theme: "system",
  density: "comfortable",
  setTheme: (theme) => {
    applyAppearance(theme, get().density);
    set({ theme });
    void saveSettings({ theme });
  },
  setDensity: (density) => {
    applyAppearance(get().theme, density);
    set({ density });
    void saveSettings({ density });
  },
  applyLoaded: (theme, density) => {
    applyAppearance(theme, density);
    set({ theme, density });
  },

  displayMode: "shaded-wire",
  setDisplayMode: (mode) => set({ displayMode: mode }),

  viewCommand: { kind: "iso", seq: 0 },
  sendView: (kind) => set({ viewCommand: { kind, seq: get().viewCommand.seq + 1 } }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  aboutOpen: false,
  setAboutOpen: (open) => set({ aboutOpen: open }),

  paramQuery: "",
  openParams: (query) => set({ paramQuery: query, dockTab: "params", dockOpen: true }),

  analysisFocus: null,
  focusAnalysis: (name) => set({ analysisFocus: name, sidebarTab: "analyses" }),

  welcomeDismissed: false,
  dismissWelcome: () => set({ welcomeDismissed: true }),

  recentFiles: [],
  setRecentFiles: (files) => {
    const recentFiles = files.slice(0, 10);
    set({ recentFiles });
    void saveSettings({ recentFiles });
  },
}));
