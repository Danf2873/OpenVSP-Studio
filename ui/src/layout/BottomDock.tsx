import { Suspense } from "react";
import { ChevronDown } from "lucide-react";
import { IconButton, Spinner, Tabs, type TabItem } from "../components";
import { useUiStore, type DockTabId } from "../store/uiStore";
import { dockTabs } from "./registry";
import s from "./layout.module.css";

/** Bottom dock: tab strip from the dockTabs registry, plus pop-out and collapse. */
export function BottomDock() {
  const tab = useUiStore((st) => st.dockTab);
  const openDock = useUiStore((st) => st.openDock);
  const def = dockTabs.find((t) => t.id === tab) ?? dockTabs[0];
  const Panel = def.component;

  const items: TabItem<DockTabId>[] = dockTabs.map((t) => {
    const Icon = t.icon;
    return { value: t.id, label: t.label, icon: <Icon size={13} /> };
  });

  return (
    <div className={s.dock}>
      <div className={s.dockHead}>
        <Tabs<DockTabId> value={tab} items={items} onChange={openDock} ariaLabel="Bottom panel" className={s.dockTabs} />
        <div className={s.dockActions}>
          <IconButton
            label="Hide bottom panel"
            icon={<ChevronDown size={16} />}
            onClick={() => useUiStore.getState().toggleDock()}
          />
        </div>
      </div>
      <div className={s.dockBody}>
        <Suspense fallback={<Spinner label="Loading panel" />}>
          <Panel />
        </Suspense>
      </div>
    </div>
  );
}
