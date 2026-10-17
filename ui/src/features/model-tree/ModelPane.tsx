import { createElement } from "react";
import { Plus } from "lucide-react";
import { Button, DropdownMenu, EmptyState, IconButton, type MenuEntry } from "../../components";
import * as act from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useModelStore } from "../../store/modelStore";
import { geomIcon } from "./geomIcons";
import { prettyName } from "../palette/appCommands";
import { ModelTree } from "./ModelTree";
import s from "./ModelTree.module.css";

// Stable fallback so store selectors never return a fresh array.
const NO_ITEMS: never[] = [];

/** Sidebar "Model" tab: header with the Add menu, then the component tree. */
export function ModelPane() {
  const geomTypes = useAppStore((st) => st.appInfo?.geomTypes) ?? NO_ITEMS;
  const empty = useModelStore((st) => st.model !== null && st.model.geoms.length === 0);

  const addItems: MenuEntry[] = geomTypes.map((type) => ({
    id: `add-${type}`,
    label: prettyName(type),
    icon: createElement(geomIcon(type), { size: 14 }),
    onSelect: () => act.guard(() => act.addGeom(type)),
  }));

  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <span className={s.paneTitle}>Components</span>
        <DropdownMenu items={addItems} align="end" ariaLabel="Add component">
          <IconButton icon={<Plus size={16} />} label="Add component" disabled={geomTypes.length === 0} />
        </DropdownMenu>
      </div>
      {empty ? (
        <EmptyState
          title="No components yet"
          text="Add a fuselage, wing or other component to start building your aircraft."
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {["FUSELAGE", "WING"].filter((t) => geomTypes.includes(t)).map((t) => (
                <Button key={t} size="sm" variant="secondary" onClick={() => act.guard(() => act.addGeom(t))}>
                  Add {prettyName(t)}
                </Button>
              ))}
            </div>
          }
        />
      ) : (
        <ModelTree />
      )}
    </div>
  );
}
