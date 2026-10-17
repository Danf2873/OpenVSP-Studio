// Sidebar pane for finite element structures: Structures, Subsurfaces, Measure.

import { useState } from "react";
import { Tabs, type TabItem } from "../../components";
import { MeasureTab } from "./MeasureTab";
import { StructuresTab } from "./StructuresTab";
import { SubsurfacesTab } from "./SubsurfacesTab";
import css from "./fea.module.css";

type FeaTab = "structures" | "subsurfaces" | "measure";

const ITEMS: TabItem<FeaTab>[] = [
  { value: "structures", label: "Structures" },
  { value: "subsurfaces", label: "Subsurfaces" },
  { value: "measure", label: "Measure" },
];

export function StructuresPane() {
  const [tab, setTab] = useState<FeaTab>("structures");

  return (
    <div className={css.pane}>
      <Tabs<FeaTab> value={tab} items={ITEMS} onChange={setTab} ariaLabel="Structures sections" className={css.paneTabs} />
      <div className={css.tabBody} role="tabpanel" aria-label={ITEMS.find((i) => i.value === tab)?.value}>
        {tab === "structures" && <StructuresTab />}
        {tab === "subsurfaces" && <SubsurfacesTab />}
        {tab === "measure" && <MeasureTab />}
      </div>
    </div>
  );
}
