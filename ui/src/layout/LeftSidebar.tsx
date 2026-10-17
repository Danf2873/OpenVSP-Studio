import { Suspense } from "react";
import { IconButton, Spinner } from "../components";
import { useUiStore } from "../store/uiStore";
import { sidebarTabs } from "./registry";
import s from "./layout.module.css";

/** Icon rail plus the active sidebar tab. */
export function LeftSidebar() {
  const tab = useUiStore((st) => st.sidebarTab);
  const setTab = useUiStore((st) => st.setSidebarTab);
  const def = sidebarTabs.find((t) => t.id === tab) ?? sidebarTabs[0];
  const Panel = def.component;

  return (
    <div className={s.sidebar}>
      <nav className={s.rail} aria-label="Sidebar sections">
        {sidebarTabs.map((t) => {
          const Icon = t.icon;
          return (
            <IconButton
              key={t.id}
              label={t.label}
              pressed={t.id === tab}
              className={s.railBtn}
              onClick={() => setTab(t.id)}
              icon={<Icon size={18} strokeWidth={1.75} />}
            />
          );
        })}
      </nav>
      <div className={s.sidebarBody}>
        <Suspense fallback={<Spinner label="Loading panel" />}>
          <Panel />
        </Suspense>
      </div>
    </div>
  );
}
