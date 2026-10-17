import { useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { EmptyState, Spinner, ToastRegion } from "../components";
import { CommandPalette } from "../features/palette/CommandPalette";
import { registerAppCommands } from "../features/palette/appCommands";
import { registerStaticCommands } from "./commands";
import { useGlobalShortcuts } from "./shortcuts";
import { Inspector } from "../features/inspector/Inspector";
import { Viewport } from "../features/viewport/Viewport";
import { XsecEditor } from "../features/xsec-editor/XsecEditor";
import { Welcome } from "../features/welcome/Welcome";
import { AboutModal } from "../features/settings/AboutModal";
import { SettingsModal } from "../features/settings/SettingsModal";
import { useAppStore } from "../store/appStore";
import { useModelStore } from "../store/modelStore";
import { useUiStore } from "../store/uiStore";
import { BottomDock } from "./BottomDock";
import { LeftSidebar } from "./LeftSidebar";
import { StatusBar } from "./StatusBar";
import { TopToolbar } from "./TopToolbar";
import s from "./layout.module.css";

function Connecting() {
  const engine = useAppStore((st) => st.engine);
  const err = useAppStore((st) => st.appInfoError);
  const running = engine === "running";
  const text =
    engine === "stopped"
      ? "The engine stopped. Use Help > Restart Engine, or check Settings for the Python path."
      : err && !running
        ? `The engine did not answer (${err}). Retrying.`
        : running
          ? "Loading the model from the engine."
          : "Starting the OpenVSP engine. This usually takes a few seconds.";
  return (
    <div className={s.connecting}>
      <EmptyState
        icon={<Spinner label="Connecting" />}
        title={running ? "Loading model…" : "Connecting to engine…"}
        text={text}
      />
    </div>
  );
}

/** Root layout: toolbar, workspace, status line, and global overlays. */
export function AppShell() {
  useGlobalShortcuts();

  useEffect(() => registerStaticCommands(), []);

  const appInfo = useAppStore((st) => st.appInfo);
  useEffect(() => (appInfo ? registerAppCommands(appInfo) : undefined), [appInfo]);

  const model = useModelStore((st) => st.model);
  const welcomeDismissed = useUiStore((st) => st.welcomeDismissed);
  const welcome = model !== null && !welcomeDismissed && model.geoms.length === 0 && model.file === null;
  const hasWorkspace = model !== null && !welcome;

  // The cross-section editor panel is sized in pixels (400, 320 to 640) but the
  // group works in percent, so convert with the measured workspace width.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyWidth, setBodyWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setBodyWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const xsecOpen = useUiStore((st) => st.xsecPanelOpen);
  const xsecPct = (px: number) => (px / Math.max(1, bodyWidth)) * 100;

  // Keep the bottom dock in step with uiStore.dockOpen.
  const dockOpen = useUiStore((st) => st.dockOpen);
  const dockRef = useRef<ImperativePanelHandle | null>(null);
  useEffect(() => {
    const h = dockRef.current;
    if (!h) return;
    if (dockOpen) h.expand();
    else h.collapse();
  }, [dockOpen, hasWorkspace]);

  let body;
  if (!model) body = <Connecting />;
  else if (welcome) body = <Welcome />;
  else
    body = (
      <PanelGroup direction="horizontal" autoSaveId="openvsp-studio-main">
        <Panel order={1} defaultSize={20} minSize={14} maxSize={32} className={s.glassPanel}>
          <LeftSidebar />
        </Panel>
        <PanelResizeHandle className={s.handleV} />
        {xsecOpen && (
          <Panel
            id="xsec-editor"
            order={2}
            defaultSize={xsecPct(400)}
            minSize={xsecPct(320)}
            maxSize={xsecPct(640)}
            className={s.xsecPanel}
          >
            <XsecEditor />
          </Panel>
        )}
        {xsecOpen && <PanelResizeHandle className={s.handleV} />}
        <Panel order={3} defaultSize={Math.max(30, 54 - (xsecOpen ? xsecPct(400) : 0))} minSize={30}>
          <PanelGroup direction="vertical" autoSaveId="openvsp-studio-center">
            <Panel defaultSize={70} minSize={25}>
              <Viewport />
            </Panel>
            <PanelResizeHandle className={s.handleH} />
            <Panel
              ref={dockRef}
              defaultSize={30}
              minSize={12}
              collapsible
              collapsedSize={0}
              onCollapse={() => useUiStore.getState().setDockOpen(false)}
              onExpand={() => useUiStore.getState().setDockOpen(true)}
            >
              <BottomDock />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className={s.handleV} />
        <Panel order={4} defaultSize={26} minSize={18} maxSize={38}>
          <Inspector />
        </Panel>
      </PanelGroup>
    );

  return (
    <div className={s.app}>
      <TopToolbar />
      <div className={s.body} ref={bodyRef}>
        {body}
      </div>
      <StatusBar />
      <ToastRegion />
      <CommandPalette />
      <SettingsModal />
      <AboutModal />
    </div>
  );
}
