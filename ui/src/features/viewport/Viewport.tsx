import { useState, type KeyboardEvent } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Maximize2 } from "lucide-react";
import { Button, EmptyState, SegmentedControl, type SegmentOption } from "../../components";
import { useModelStore } from "../../store/modelStore";
import { useUiStore, type DisplayMode, type ViewKind } from "../../store/uiStore";
import { CameraRig } from "./CameraRig";
import { SceneGeoms, XsecRing } from "./SceneGeoms";
import { useThemeColors } from "./useThemeColors";
import { XformGizmo, type GizmoMode } from "./XformGizmo";
import { ViewNavPad } from "./ViewNavPad";
import { OverlayLayer } from "./OverlayLayer";
import { OverlayLegend } from "./OverlayLegend";
import { justDraggedGizmo } from "./xformPreview";
import { sendNav } from "./viewNav";
import s from "./Viewport.module.css";

// Stable identities: Canvas re-reads these props on every render.
const CAMERA = { position: [12, -12, 8] as [number, number, number], up: [0, 0, 1] as [number, number, number], fov: 40, near: 0.01, far: 1e6 };
const GL = { antialias: true, alpha: true };

const MODE_OPTIONS: SegmentOption<DisplayMode>[] = [
  { value: "shaded", label: "Shaded", title: "Shaded surfaces" },
  { value: "shaded-wire", label: "Shaded + Wire", title: "Shaded surfaces with grid lines" },
  { value: "wire", label: "Wire", title: "Grid lines only" },
];

const GIZMO_OPTIONS: SegmentOption<GizmoMode>[] = [
  { value: "move", label: "Move", title: "Move the selected component (W)" },
  { value: "scale", label: "Scale", title: "Scale the selected component (R)" },
  { value: "off", label: "Off", title: "Hide transform handles (Esc)" },
];

const VIEW_BUTTONS: { kind: ViewKind; label: string }[] = [
  { kind: "front", label: "Front" },
  { kind: "top", label: "Top" },
  { kind: "side", label: "Side" },
  { kind: "iso", label: "Iso" },
];

interface ViewToolbarProps {
  gizmoMode: GizmoMode;
  onGizmoMode: (mode: GizmoMode) => void;
}

function ViewToolbar({ gizmoMode, onGizmoMode }: ViewToolbarProps) {
  const displayMode = useUiStore((st) => st.displayMode);
  const setDisplayMode = useUiStore((st) => st.setDisplayMode);
  const sendView = useUiStore((st) => st.sendView);
  const hasSelection = useModelStore((st) => st.selectedGeomId !== null);

  return (
    <div className={s.toolbar} role="toolbar" aria-label="View controls">
      <SegmentedControl<DisplayMode>
        value={displayMode}
        options={MODE_OPTIONS}
        onChange={setDisplayMode}
        ariaLabel="Display mode"
      />
      <span className={s.sep} aria-hidden="true" />
      {VIEW_BUTTONS.map((v) => (
        <Button key={v.kind} size="sm" variant="ghost" onClick={() => sendView(v.kind)} title={`${v.label} view`}>
          {v.label}
        </Button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        icon={<Maximize2 size={13} />}
        onClick={() => sendView("fit")}
        title="Fit all visible components (F)"
      >
        Fit
      </Button>
      <span className={s.sep} aria-hidden="true" />
      <SegmentedControl<GizmoMode>
        value={gizmoMode}
        options={GIZMO_OPTIONS}
        onChange={onGizmoMode}
        ariaLabel="Transform handles"
        disabled={!hasSelection}
      />
    </div>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** Center 3D viewport. Click empty space to clear the selection. */
export function Viewport() {
  const colors = useThemeColors();
  const displayMode = useUiStore((st) => st.displayMode);
  const noMeshes = useModelStore((st) => Object.keys(st.meshes).length === 0);
  const geomCount = useModelStore((st) => st.model?.geoms.length ?? 0);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("move");

  // Keys act only while focus is inside the viewport (this element).
  // Toolbar arrow-key handling calls preventDefault first, so it wins.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTextEntry(e.target)) return;
    const key = e.key;
    const lower = key.toLowerCase();
    let handled = true;
    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      const dir = key.slice(5).toLowerCase() as "up" | "down" | "left" | "right";
      sendNav({ kind: "pan", dir, smooth: !e.repeat });
    } else if (key === "+" || key === "=") {
      sendNav({ kind: "zoom", dir: "in", smooth: !e.repeat });
    } else if (key === "-" || key === "_") {
      sendNav({ kind: "zoom", dir: "out", smooth: !e.repeat });
    } else if (lower === "w" && !e.shiftKey) {
      setGizmoMode("move");
    } else if (lower === "r" || lower === "s") {
      setGizmoMode("scale");
    } else if (key === "Escape") {
      setGizmoMode("off");
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <div className={s.viewport} tabIndex={0} role="region" aria-label="3D view" onKeyDown={onKeyDown}>
      <Canvas
        dpr={[1, 2]}
        gl={GL}
        camera={CAMERA}
        onPointerMissed={() => {
          if (justDraggedGizmo()) return; // the click that ends a gizmo drag
          useModelStore.getState().setSelected(null);
        }}
      >
        <hemisphereLight args={[0xffffff, 0x444444, 0.6]} />
        <directionalLight position={[10, -10, 20]} intensity={0.9} />
        <directionalLight position={[-12, 12, -6]} intensity={0.4} />
        <CameraRig />
        <OrbitControls makeDefault enableDamping={false} />
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          cellSize={0.5}
          sectionSize={5}
          cellThickness={0.6}
          sectionThickness={1}
          cellColor={colors.gridCell}
          sectionColor={colors.gridSection}
          fadeDistance={200}
          fadeStrength={1.5}
          infiniteGrid
        />
        <SceneGeoms mode={displayMode} colors={colors} />
        <OverlayLayer colors={colors} />
        <XsecRing colors={colors} />
        <XformGizmo mode={gizmoMode} />
      </Canvas>

      <ViewToolbar gizmoMode={gizmoMode} onGizmoMode={setGizmoMode} />
      <ViewNavPad />
      <OverlayLegend />

      {noMeshes && (
        <div className={s.overlay}>
          <EmptyState
            title={geomCount === 0 ? "Empty model" : "Nothing visible"}
            text={
              geomCount === 0
                ? "Add a component from the Add menu or the + in the Components list."
                : "Show a component with its eye icon in the Components list."
            }
          />
        </div>
      )}
    </div>
  );
}
