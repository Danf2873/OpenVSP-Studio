// Cross-Section Editor: edit the sections of the selected component.
//
// Shown as a left panel beside the viewport, or full window in the pop-out.
// Top to bottom: title bar, geometry line and tools, the square 2D canvas, the
// readout row (cursor coordinates, section stepper, mirror switches), the
// thumbnails disclosure, section actions, the Scale / Offset / Rotation grid,
// and the all-parameters disclosure. Every engine call lives here; the canvas
// reports gestures and shows drafts.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, ExternalLink, FolderOpen, MousePointerClick, PanelLeftClose, PenLine } from "lucide-react";
import type { Parm, UV, XsecRef } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Badge, Button, Disclosure, DropdownMenu, EmptyState, IconButton, ParmGroupList, Select, Spinner, type MenuEntry } from "../../components";
import type { SelectOption } from "../../components/Select";
import { cx } from "../../components/cx";
import * as act from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useModelStore } from "../../store/modelStore";
import { useParmStore } from "../../store/parmStore";
import { useUiStore } from "../../store/uiStore";
import { ConfirmModal } from "../vars/ConfirmModal";
import { AirfoilDialog } from "./AirfoilDialog";
import { clampParm, findParm, findSizeParms, movePoint, profileParam, type SizeParms } from "./geometry";
import { latestSender, type LatestSender } from "./sender";
import { SectionParms, type ParmGridRow } from "./SectionParms";
import { SectionMap } from "./SectionMap";
import { SectionStrip } from "./SectionStrip";
import s from "./XsecEditor.module.css";
import { XsecCanvas } from "./XsecCanvas";
import { useXsecData } from "./useXsecData";

// Stable fallback so store selectors never return a fresh array.
const NO_ITEMS: never[] = [];

/** Fewer sections than this and deleting one asks for confirmation. */
const MIN_SECTIONS_WITHOUT_CONFIRM = 3;

type Axis = "x" | "y";

interface SizeTarget {
  parm: Parm;
  /** Which dimension(s) the parm drives. */
  dims: "x" | "y" | "both";
}

interface SizeDrag {
  axis: Axis;
  target: SizeTarget;
  sender: LatestSender<number>;
  last: number;
}

interface PointDrag {
  points: UV[];
  sender: LatestSender<UV[]>;
}

interface ParmJob {
  value: number;
  key?: string;
}

/** Which parm a handle on `axis` drives: a width/height, or the diameter of a circle. */
function sizeTarget(axis: Axis, sp: SizeParms): SizeTarget | null {
  if (axis === "x") {
    if (sp.width) return { parm: sp.width, dims: "x" };
    if (sp.diameter) return { parm: sp.diameter, dims: "both" };
    return null;
  }
  if (sp.height) return { parm: sp.height, dims: "y" };
  if (sp.diameter) return { parm: sp.diameter, dims: "both" };
  return null;
}

/** Set a parm and feed the answer into the side form and the viewport. */
function sendParm(id: string, value: number, key?: string): Promise<void> {
  return vsp.parmsSet(id, value, key).then((res) => {
    useParmStore.getState().applyResult(res);
    if (res.dirtyGeoms.length > 0) useModelStore.getState().noteDirty(res.dirtyGeoms);
  });
}

/** Two decimals for the readout; the engine works in full precision. */
function fmtReadout(n: number): string {
  return n.toFixed(2);
}

function EmptyNoComponent() {
  return (
    <div className={s.centerFill}>
      <EmptyState
        icon={<MousePointerClick size={18} />}
        title="Select a component with cross-sections"
        text="Choose a component in the Model list or the viewport to edit its sections."
        action={
          <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => act.guard(() => act.openModelDialog())}>
            Open model…
          </Button>
        }
      />
    </div>
  );
}

export interface XsecEditorProps {
  /** Pop-out window: no title bar or panel close, and the canvas fits the window height. */
  inWindow?: boolean;
}

export function XsecEditor({ inWindow = false }: XsecEditorProps): JSX.Element {
  const geomId = useModelStore((st) => st.selectedGeomId);
  const geom = useModelStore((st) => (st.selectedGeomId ? st.model?.geoms.find((g) => g.id === st.selectedGeomId) ?? null : null));
  const selectedXsec = useModelStore((st) => st.selectedXsec);
  const setSelectedXsec = useModelStore((st) => st.setSelectedXsec);
  const shapes = useAppStore((st) => st.appInfo?.xsecShapes) ?? NO_ITEMS;
  const pushToast = useAppStore((st) => st.pushToast);

  // The selection only applies to the component it was made for.
  const sel: XsecRef | null = selectedXsec && geomId && selectedXsec.geomId === geomId ? selectedXsec : null;
  const surf = sel?.surf ?? null;
  const index = sel?.index ?? null;

  const data = useXsecData(geomId, surf, index);
  const { surfaces, list, detail } = data;

  const [fitToken, setFitToken] = useState(0);
  const [airfoilOpen, setAirfoilOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [selPoint, setSelPoint] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [stepDraft, setStepDraft] = useState<string | null>(null);
  const [draftSize, setDraftSize] = useState<{ width: number; height: number } | null>(null);
  const [draftPoints, setDraftPoints] = useState<UV[] | null>(null);
  const sizeDrag = useRef<SizeDrag | null>(null);
  const pointDrag = useRef<PointDrag | null>(null);
  const parmSenders = useRef(new Map<string, LatestSender<ParmJob>>());

  const sizeParms = useMemo<SizeParms>(() => (detail ? findSizeParms(detail.groups) : {}), [detail]);

  const closeAirfoil = useCallback(() => setAirfoilOpen(false), []);
  const closeConfirm = useCallback(() => setConfirmDelete(false), []);
  const onCursor = useCallback((x: number | null, y: number | null) => {
    if (x === null || y === null) {
      setCursor(null);
      return;
    }
    const nx = Number(x.toFixed(2));
    const ny = Number(y.toFixed(2));
    setCursor((prev) => (prev && prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
  }, []);

  // Select a section when none is selected for this component, and keep the
  // index inside the surface's range.
  useEffect(() => {
    if (!geomId || !surfaces || surfaces.length === 0) return;
    const cur = useModelStore.getState().selectedXsec;
    const owned = cur && cur.geomId === geomId ? surfaces.find((x) => x.index === cur.surf) : undefined;
    if (!cur || cur.geomId !== geomId || !owned) {
      const first = surfaces[0];
      setSelectedXsec({ geomId, surf: first.index, index: first.numXSecs > 1 ? 1 : 0 });
      return;
    }
    const maxIdx = Math.max(0, owned.numXSecs - 1);
    if (cur.index > maxIdx || cur.index < 0) {
      setSelectedXsec({ geomId, surf: cur.surf, index: Math.min(Math.max(cur.index, 0), maxIdx) });
    }
    // Runs when the surfaces (section counts) change, not on every selection: a
    // section just inserted is selected before the refreshed count arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geomId, surfaces, setSelectedXsec]);

  // A point index means nothing on another section.
  useEffect(() => {
    setSelPoint(null);
  }, [geomId, surf, index]);

  // ----- selection and section actions -----

  const count = list?.length ?? 0;

  const selectIndex = (i: number) => {
    if (!geomId || surf === null) return;
    setSelectedXsec({ geomId, surf, index: i });
  };

  const onSurfacePick = (v: string) => {
    if (!geomId) return;
    setSelectedXsec({ geomId, surf: Number(v), index: 0 });
  };

  /** Split: a new section after the selected one. */
  const insertAfter = () => {
    if (!sel) return;
    const r = sel;
    act.guard(async () => {
      const res = await vsp.xsecInsert(r.geomId, r.surf, r.index);
      setSelectedXsec({ geomId: r.geomId, surf: r.surf, index: res.index });
    });
  };

  const insertBefore = () => {
    if (!sel || sel.index === 0) return;
    const r = sel;
    act.guard(async () => {
      // The engine inserts after an index; inserting before `index` means after index - 1.
      const res = await vsp.xsecInsert(r.geomId, r.surf, r.index - 1);
      setSelectedXsec({ geomId: r.geomId, surf: r.surf, index: res.index });
    });
  };

  /** Extrude: a new section after the last one, then select it. */
  const extrude = () => {
    if (!sel || count === 0) return;
    const r = sel;
    const last = count - 1;
    act.guard(async () => {
      const res = await vsp.xsecInsert(r.geomId, r.surf, last);
      setSelectedXsec({ geomId: r.geomId, surf: r.surf, index: res.index });
    });
  };

  const removeSection = () => {
    if (!sel) return;
    const r = sel;
    const n = count;
    act.guard(async () => {
      await vsp.xsecDelete(r);
      // Keep the same position, or the new last section if we removed the last one.
      setSelectedXsec({ geomId: r.geomId, surf: r.surf, index: Math.max(0, Math.min(r.index, n - 2)) });
    });
  };

  const requestDelete = () => {
    if (!sel || count < 2) return;
    if (count - 1 < MIN_SECTIONS_WITHOUT_CONFIRM) setConfirmDelete(true);
    else removeSection();
  };

  const copySection = () => {
    if (!sel) return;
    const r = sel;
    act.guard(async () => {
      await vsp.xsecCopy(r);
      pushToast("success", "Section copied");
    });
  };

  const pasteSection = () => {
    if (!sel) return;
    const r = sel;
    act.guard(() => vsp.xsecPaste(r));
  };

  const onShapePick = (v: string) => {
    if (!sel) return;
    const r = sel;
    act.guard(async () => {
      data.setDetail(await vsp.xsecSetShape(r, Number(v)));
    });
  };

  const convertToEditCurve = () => {
    if (!sel) return;
    const r = sel;
    act.guard(async () => {
      data.setDetail(await vsp.xsecConvertToEditCurve(r));
    });
  };

  const pickAirfoil = (path: string) => {
    setAirfoilOpen(false);
    if (!sel) return;
    const r = sel;
    act.guard(async () => {
      data.setDetail(await vsp.xsecLoadAirfoil(r, path));
    });
  };

  const setMirror = (bit: 1 | 2, on: boolean) => {
    if (!sel || !detail?.editCurve) return;
    const next = on ? detail.editCurve.symmetric | bit : detail.editCurve.symmetric & ~bit;
    const r = sel;
    act.guard(async () => {
      data.setDetail(await vsp.xsecSetEditSymmetry(r, (next & 1) !== 0, (next & 2) !== 0));
    });
  };

  const stepTo = (i: number) => {
    if (count === 0) return;
    selectIndex(Math.min(Math.max(i, 0), count - 1));
  };

  const commitStep = () => {
    if (stepDraft === null) return;
    const n = Number.parseInt(stepDraft, 10);
    setStepDraft(null);
    if (Number.isFinite(n)) stepTo(n);
  };

  // Arrow keys step the selection; Insert and Delete act on it.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest?.("input,select,textarea,[contenteditable='true']")) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (!list || list.length === 0 || index === null) return;
      const next = Math.min(list.length - 1, Math.max(0, index + (e.key === "ArrowRight" ? 1 : -1)));
      if (next !== index) {
        e.preventDefault();
        selectIndex(next);
      }
    } else if (e.key === "Insert") {
      e.preventDefault();
      insertAfter();
    } else if (e.key === "Delete") {
      if (count < 2) return;
      e.preventDefault();
      requestDelete();
    }
  };

  // ----- size handles (parametric shapes) -----

  const onSizeStart = (axis: Axis) => {
    const target = sizeTarget(axis, sizeParms);
    if (!target) return;
    data.hold();
    const key = `${target.parm.id}:${Date.now()}`;
    const parmId = target.parm.id;
    sizeDrag.current = {
      axis,
      target,
      sender: latestSender<number>((value) => sendParm(parmId, value, key)),
      last: Number.NaN,
    };
  };

  const onSizeMove = (axis: Axis, coord: number) => {
    const drag = sizeDrag.current;
    if (!drag || drag.axis !== axis || !detail) return;
    const value = clampParm(2 * Math.abs(coord), drag.target.parm);
    if (drag.target.dims === "x") setDraftSize({ width: value, height: detail.height });
    else if (drag.target.dims === "y") setDraftSize({ width: detail.width, height: value });
    else setDraftSize({ width: value, height: value });
    if (value !== drag.last) {
      drag.last = value;
      drag.sender.push(value);
    }
  };

  const onSizeEnd = () => {
    const drag = sizeDrag.current;
    if (!drag) return;
    sizeDrag.current = null;
    void drag.sender
      .flush()
      .then(() => data.release())
      .then(() => setDraftSize(null));
  };

  const onSizeNudge = (axis: Axis, delta: number) => {
    if (!detail) return;
    const target = sizeTarget(axis, sizeParms);
    if (!target) return;
    const current = axis === "x" ? detail.width : detail.height;
    const value = clampParm(current + delta, target.parm);
    act.guard(() => sendParm(target.parm.id, value));
  };

  // ----- parameter grid (Scale / Offset / Rotation) -----

  /** Writes a parm; scrubs for one parm go through one sender, so only the newest value is in flight. */
  const setParm = (p: Parm, value: number, key?: string) => {
    const senders = parmSenders.current;
    let snd = senders.get(p.id);
    if (!snd) {
      const id = p.id;
      snd = latestSender<ParmJob>((job) => sendParm(id, job.value, job.key));
      senders.set(p.id, snd);
    }
    snd.push({ value: clampParm(value, p), key });
  };

  const parmRows: ParmGridRow[] = detail
    ? [
        { label: "Scale", cells: [sizeParms.width ?? null, sizeParms.height ?? null, null] },
        {
          label: "Offset",
          cells: [findParm(detail.groups, "XLocPercent"), findParm(detail.groups, "YLocPercent"), findParm(detail.groups, "ZLocPercent")],
        },
        {
          label: "Rotation",
          cells: [findParm(detail.groups, "XRotate"), findParm(detail.groups, "YRotate"), findParm(detail.groups, "ZRotate")],
        },
      ]
    : [];

  // ----- edit-curve points -----

  const onPointStart = (i: number) => {
    if (!detail?.editCurve || !sel) return;
    const r = sel;
    setSelPoint(i);
    data.hold();
    const key = `editcurve:${detail.id}:${Date.now()}`;
    pointDrag.current = {
      points: detail.editCurve.points.map(([u, v]): UV => [u, v]),
      sender: latestSender<UV[]>(async (pts) => {
        await vsp.xsecSetEditCurve(r, pts, key);
      }),
    };
  };

  const onPointMove = (i: number, x: number, y: number) => {
    const drag = pointDrag.current;
    if (!drag || !detail) return;
    // The engine works in unit space: world divided by width and height.
    const unit: UV = [x / (detail.width || 1), y / (detail.height || 1)];
    const next: UV[] = movePoint(drag.points, i, unit, detail.editCurve?.curveType === 2);
    drag.points = next;
    setDraftPoints(next);
    drag.sender.push(next);
  };

  const onPointEnd = () => {
    const drag = pointDrag.current;
    if (!drag) return;
    pointDrag.current = null;
    void drag.sender
      .flush()
      .then(() => data.release())
      .then(() => setDraftPoints(null));
  };

  /** Delete one point through the engine (anchors only on cubic curves). */
  const onPointRemove = (i: number) => {
    if (!detail?.editCurve || !sel) return;
    if (detail.editCurve.curveType === 2 && i % 3 !== 0) {
      pushToast("info", "Only anchor points can be deleted");
      return;
    }
    const r = sel;
    act.guard(async () => {
      data.setDetail(await vsp.xsecDeleteEditPoint(r, i));
      setSelPoint(null);
    });
  };

  /**
   * Add a point on the outline at world (x, y). The point is placed by its curve
   * parameter, so a parametric shape is first converted to an editable curve (the
   * outline is kept), and the parameter is taken from the converted profile.
   */
  const onAddPointAt = (x: number, y: number) => {
    if (!detail || !sel) return;
    const r = sel;
    const start = detail;
    act.guard(async () => {
      let d = start;
      if (!d.editCurve) {
        d = await vsp.xsecConvertToEditCurve(r);
        data.setDetail(d);
        if (!d.editCurve) return;
        pushToast("info", "Converted the section to an editable curve");
      }
      const u = profileParam(d.profile, x, y);
      if (u === null) return;
      data.setDetail(await vsp.xsecSplitEditCurve(r, u));
    });
  };

  // ----- early states -----

  if (!geomId || !geom) {
    return (
      <div className={cx(s.root, inWindow && s.inWindow)} role="region" aria-label="Cross-section editor">
        <EmptyNoComponent />
      </div>
    );
  }

  if (geom.numXSecSurfs === 0) {
    return (
      <div className={cx(s.root, inWindow && s.inWindow)} role="region" aria-label="Cross-section editor">
        <div className={s.centerFill}>
          <EmptyState title="This component has no cross-sections" text="Choose another component in the Model list." />
        </div>
      </div>
    );
  }

  // ----- render -----

  const shapeOptions: SelectOption[] = shapes.map((sh) => ({ value: String(sh.value), label: sh.name }));
  if (detail && !shapes.some((sh) => sh.value === detail.shape)) {
    shapeOptions.push({ value: String(detail.shape), label: detail.shapeName || `Shape ${detail.shape}` });
  }

  const surfOptions: SelectOption[] = (surfaces ?? []).map((x) => ({
    value: String(x.index),
    label: `Surface ${x.index} (${x.numXSecs})`,
  }));

  const canEdit = !!sel && !!detail;
  const isEdit = !!detail?.editCurve;
  const mirror = detail?.editCurve?.symmetric ?? 0;
  const mirrorTip = isEdit ? "" : "Convert to an editable curve to set mirroring";

  // Coordinates shown in the readout: the pointer while over the canvas, else the selected point.
  let selCoords: { label: string; x: number; y: number } | null = null;
  if (detail?.editCurve && selPoint !== null && selPoint < detail.editCurve.points.length) {
    const [u, v] = detail.editCurve.points[selPoint];
    selCoords = { label: `P${selPoint}`, x: u * detail.width, y: v * detail.height };
  }
  const readX = cursor ? fmtReadout(cursor.x) : selCoords ? fmtReadout(selCoords.x) : "--";
  const readY = cursor ? fmtReadout(cursor.y) : selCoords ? fmtReadout(selCoords.y) : "--";

  const toolItems: MenuEntry[] = [
    { id: "ins-after", label: "Insert section after", disabled: !sel, onSelect: insertAfter },
    { id: "ins-before", label: "Insert section before", disabled: !sel || index === 0, onSelect: insertBefore },
    "separator",
    { id: "convert", label: "Convert to editable curve", disabled: !detail || isEdit, onSelect: convertToEditCurve },
    { id: "airfoil", label: "Load airfoil…", disabled: !sel, onSelect: () => setAirfoilOpen(true) },
    "separator",
    { id: "fit", label: "Fit view", disabled: !detail, onSelect: () => setFitToken((t) => t + 1) },
  ];

  return (
    <div
      className={cx(s.root, inWindow && s.inWindow)}
      role="region"
      aria-label="Cross-section editor"
      onKeyDown={onKeyDown}
    >
      {!inWindow && (
        <header className={s.titleBar}>
          <span className={s.titleText}>Cross-section Editor</span>
          <div className={s.titleActions}>
            <IconButton
              icon={<ExternalLink size={14} />}
              label="Pop out cross-section editor"
              onClick={() => act.guard(() => act.popOutXsec())}
            />
            <IconButton
              icon={<PanelLeftClose size={15} />}
              label="Hide cross-section editor"
              onClick={() => useUiStore.getState().setXsecPanelOpen(false)}
            />
          </div>
        </header>
      )}

      <div className={s.topBlock}>
        <div className={s.geomRow}>
          <span className={s.geomName} title={geom.name}>
            {geom.name}
          </span>
          <Badge>{geom.type}</Badge>
        </div>

        <div className={s.toolRow} role="toolbar" aria-label="Cross-section tools">
          <DropdownMenu items={toolItems} ariaLabel="Tools" align="start">
            <Button size="sm" variant="secondary" iconRight={<ChevronDown size={13} />}>
              Tools
            </Button>
          </DropdownMenu>
          {surfaces && surfaces.length > 1 && sel && (
            <Select className={s.surfSelect} ariaLabel="Cross-section surface" value={String(sel.surf)} options={surfOptions} onChange={onSurfacePick} />
          )}
          {detail && (
            <Select className={s.shapeSelect} ariaLabel="Section shape" value={String(detail.shape)} options={shapeOptions} onChange={onShapePick} />
          )}
          <Button size="sm" variant="secondary" icon={<Copy size={13} />} disabled={!sel} onClick={copySection}>
            Copy
          </Button>
          <Button size="sm" variant="secondary" icon={<ClipboardPaste size={13} />} disabled={!sel} onClick={pasteSection}>
            Paste
          </Button>
          <span className={s.liveChip} role="status" title="Edits apply to the model immediately">
            <span className={s.liveDot} aria-hidden="true" />
            Live
          </span>
        </div>
      </div>

      {geomId && surf !== null && <SectionMap geomId={geomId} surf={surf} selected={index} onSelect={selectIndex} />}

      <div className={s.canvasWrap}>
        {detail && !isEdit && (
          <button
            type="button"
            className={s.editPointsBtn}
            onClick={convertToEditCurve}
            title="Show this section's control points so you can drag them. The shape is kept."
          >
            <PenLine size={13} aria-hidden="true" />
            Edit points
          </button>
        )}
        {detail ? (
          <XsecCanvas
            detail={detail}
            sizeParms={sizeParms}
            draftSize={draftSize}
            draftPoints={draftPoints}
            fitToken={fitToken}
            addMode={addMode}
            selectedPoint={selPoint}
            onPointSelect={setSelPoint}
            onSizeStart={onSizeStart}
            onSizeMove={onSizeMove}
            onSizeEnd={onSizeEnd}
            onSizeNudge={onSizeNudge}
            onPointStart={onPointStart}
            onPointMove={onPointMove}
            onPointEnd={onPointEnd}
            onPointRemove={onPointRemove}
            onAddPointAt={onAddPointAt}
            onCursor={onCursor}
          />
        ) : data.error ? (
          <div className={s.centerFill}>
            <EmptyState title="Could not load this section" text={data.error} />
          </div>
        ) : (
          <div className={s.centerFill}>
            <Spinner label="Loading section" />
          </div>
        )}
      </div>

      <div className={s.readRow}>
        <span className={s.coords} aria-label="Cursor coordinates">
          {selCoords && !cursor && <span className={s.coordsTag}>{selCoords.label}</span>}
          <span>X: {readX}</span>
          <span>Y: {readY}</span>
        </span>

        <div className={s.stepper} role="group" aria-label="Section stepper">
          <IconButton
            icon={<ChevronLeft size={15} />}
            label="Previous section"
            disabled={!sel || index === null || index <= 0}
            onClick={() => selectIndex((index ?? 0) - 1)}
          />
          <input
            type="number"
            className={s.stepInput}
            min={0}
            max={Math.max(0, count - 1)}
            step={1}
            value={stepDraft ?? (index === null ? "" : String(index))}
            disabled={!sel}
            aria-label="Section number"
            onChange={(e) => setStepDraft(e.target.value)}
            onBlur={commitStep}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <IconButton
            icon={<ChevronRight size={15} />}
            label="Next section"
            disabled={!sel || index === null || index >= count - 1}
            onClick={() => selectIndex((index ?? 0) + 1)}
          />
        </div>

        <div className={s.mirrors}>
          <label className={cx(s.check, !isEdit && s.checkDisabled)} title={mirrorTip || "Mirror the outline left to right"}>
            <input
              type="checkbox"
              checked={(mirror & 1) !== 0}
              disabled={!isEdit || !sel}
              onChange={(e) => setMirror(1, e.target.checked)}
            />
            X MIRROR
          </label>
          <label className={cx(s.check, !isEdit && s.checkDisabled)} title={mirrorTip || "Mirror the outline top to bottom"}>
            <input
              type="checkbox"
              checked={(mirror & 2) !== 0}
              disabled={!isEdit || !sel}
              onChange={(e) => setMirror(2, e.target.checked)}
            />
            Y MIRROR
          </label>
        </div>
      </div>

      <Disclosure title="Sections" storageKey="xsec-sections" defaultOpen={false} className={s.sectionsDisclosure}>
        {list ? (
          <SectionStrip items={list} selected={index ?? 0} onSelect={selectIndex} />
        ) : (
          <Spinner label="Loading sections" />
        )}
      </Disclosure>

      <div className={s.actionRow} role="group" aria-label="Section actions">
        <Button size="sm" variant="secondary" disabled={!sel || count < 2} onClick={requestDelete}>
          Delete Section
        </Button>
        <Button size="sm" variant="secondary" disabled={!sel} onClick={insertAfter}>
          Split Section
        </Button>
        <Button size="sm" variant="secondary" disabled={!sel} onClick={extrude}>
          Extrude Section
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={addMode}
          className={cx(addMode && s.actionOn)}
          disabled={!canEdit}
          title={addMode ? "Click the outline to add a point. Click again to leave Add Point mode." : "Add a point on the outline"}
          onClick={() => setAddMode((m) => !m)}
        >
          Add Point
        </Button>
      </div>

      {detail && <SectionParms rows={parmRows} onSet={setParm} />}

      <Disclosure title="All section parameters" storageKey="xsec-all-parms" defaultOpen={false} className={s.allParms}>
        {detail && <ParmGroupList groups={detail.groups} />}
      </Disclosure>

      <AirfoilDialog open={airfoilOpen} onClose={closeAirfoil} onPick={pickAirfoil} />
      <ConfirmModal
        open={confirmDelete}
        title="Delete this section?"
        message={`This surface would be left with ${count - 1} section${count - 1 === 1 ? "" : "s"}. Delete it anyway?`}
        confirmLabel="Delete section"
        onConfirm={removeSection}
        onClose={closeConfirm}
      />
    </div>
  );
}
