// Sidebar "Variables" pane: presets, design variables and user parameters.

import { useState } from "react";
import { Tabs } from "../../components";
import { DesignVarsPanel } from "./DesignVarsPanel";
import { PresetsPanel } from "./PresetsPanel";
import { UserParmsPanel } from "./UserParmsPanel";
import s from "./vars.module.css";

type VarsTab = "presets" | "design" | "user";

export function VariablesPane() {
  const [tab, setTab] = useState<VarsTab>("presets");

  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <span className={s.paneTitle}>Variables</span>
      </div>

      <div className={s.tabsWrap}>
        <Tabs<VarsTab>
          value={tab}
          onChange={setTab}
          ariaLabel="Variable sections"
          items={[
            { value: "presets", label: "Presets" },
            { value: "design", label: "Design vars" },
            { value: "user", label: "User parms" },
          ]}
        />
      </div>

      <div className={s.body}>
        {tab === "presets" && <PresetsPanel />}
        {tab === "design" && <DesignVarsPanel />}
        {tab === "user" && <UserParmsPanel />}
      </div>
    </div>
  );
}
