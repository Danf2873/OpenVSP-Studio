import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MousePointerClick } from "lucide-react";
import type { ParmGroup, Vec3 } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Badge, Button, Card, EmptyState, ParmGroupList, Spinner } from "../../components";
import * as act from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useModelStore } from "../../store/modelStore";
import { useParmStore } from "../../store/parmStore";
import { prettyName } from "../palette/appCommands";
import s from "./inspector.module.css";

// Stable fallback so store selectors never return a fresh array.
const NO_ITEMS: never[] = [];

const QUICK_ADD = ["FUSELAGE", "WING", "POD", "PROP", "STACK"];

function toHex(rgb: Vec3): string {
  const part = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return "#" + part(rgb[0]) + part(rgb[1]) + part(rgb[2]);
}

function fromHex(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function NoSelection() {
  const geomTypes = useModelStore((st) => st.model?.geoms.length ?? 0);
  const types = useInspectorTypes();
  return (
    <EmptyState
      icon={<MousePointerClick size={18} />}
      title="Select a component"
      text={geomTypes > 0 ? "Choose a component in the Components list or the viewport to edit its parameters." : "Start by adding a component."}
      action={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {types.map((t) => (
            <Button key={t} size="sm" variant="secondary" onClick={() => act.guard(() => act.addGeom(t))}>
              {prettyName(t)}
            </Button>
          ))}
        </div>
      }
    />
  );
}

function useInspectorTypes(): string[] {
  const geomTypes = useAppStore((st) => st.appInfo?.geomTypes) ?? NO_ITEMS;
  return QUICK_ADD.filter((t) => geomTypes.length === 0 || geomTypes.includes(t));
}

interface GeomInspectorProps {
  geomId: string;
}

function GeomInspector({ geomId }: GeomInspectorProps) {
  const geom = useModelStore((st) => st.model?.geoms.find((g) => g.id === geomId) ?? null);
  const lastChange = useModelStore((st) => st.lastChange);
  const [groups, setGroups] = useState<ParmGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(geom?.name ?? "");
  const [colorDraft, setColorDraft] = useState<Vec3 | null>(null);
  const colorTimer = useRef<number | null>(null);
  const colorKey = useRef<string | null>(null);

  useEffect(() => {
    setName(geom?.name ?? "");
  }, [geom?.name]);

  // Load the parameter groups for this geom.
  useEffect(() => {
    let alive = true;
    setGroups(null);
    setError(null);
    vsp
      .geomParms(geomId, { silent: true })
      .then((g) => {
        if (!alive) return;
        useParmStore.getState().reset();
        setGroups(g);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load parameters");
      });
    return () => {
      alive = false;
    };
  }, [geomId]);

  // Reload after structural changes (not after plain parm edits, which the
  // store already reflects).
  const seen = useRef(lastChange.seq);
  useEffect(() => {
    if (lastChange.seq === seen.current) return;
    seen.current = lastChange.seq;
    if (lastChange.parmsOnly) return;
    vsp
      .geomParms(geomId, { silent: true })
      .then((g) => {
        useParmStore.getState().reset();
        setGroups(g);
      })
      .catch(() => {
        // keep the previous groups on transient failures
      });
  }, [lastChange, geomId]);

  useEffect(
    () => () => {
      if (colorTimer.current !== null) window.clearTimeout(colorTimer.current);
    },
    [],
  );

  if (!geom) return <EmptyState title="Component removed" text="This component no longer exists." />;

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === geom.name) {
      setName(geom.name);
      return;
    }
    act.guard(() => act.renameGeom(geom.id, trimmed));
  };

  const onColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rgb = fromHex(e.target.value);
    setColorDraft(rgb);
    if (colorKey.current === null) colorKey.current = `color:${geom.id}:${Date.now()}`;
    if (colorTimer.current !== null) window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(() => {
      const key = colorKey.current ?? undefined;
      colorKey.current = null;
      colorTimer.current = null;
      act.guard(async () => {
        await act.setGeomColor(geom.id, rgb, key);
        setColorDraft(null);
      });
    }, 150);
  };

  const shownColor = colorDraft ?? geom.color;

  return (
    <div className={s.inspector}>
      <div className={s.head}>
        <Card padded className={s.headCard}>
          <div className={s.nameRow}>
            <input
              className={s.nameInput}
              aria-label="Component name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setName(geom.name);
                  e.currentTarget.blur();
                }
              }}
            />
            <Badge>{geom.type}</Badge>
          </div>
          <div className={s.metaRow}>
            <label className={s.metaLabel} htmlFor={`color-${geom.id}`}>
              Color
            </label>
            <input
              id={`color-${geom.id}`}
              type="color"
              className={s.swatch}
              value={toHex(shownColor)}
              onChange={onColorChange}
              title="Component color"
            />
          </div>
        </Card>
      </div>

      <div className={s.body}>
        {error ? (
          <EmptyState title="Could not load parameters" text={error} />
        ) : groups === null ? (
          <div className={s.loading}>
            <Spinner label="Loading parameters" />
            <span>Loading parameters</span>
          </div>
        ) : (
          <ParmGroupList groups={groups} />
        )}
      </div>
    </div>
  );
}

/** Right column: parameters of the selected geom, or quick-add when nothing is selected. */
export function Inspector() {
  const selectedId = useModelStore((st) => st.selectedGeomId);
  if (!selectedId) {
    return (
      <div className={s.inspector}>
        <NoSelection />
      </div>
    );
  }
  return <GeomInspector key={selectedId} geomId={selectedId} />;
}
