// Overlays the selected analysis on the 3D model while the Analyses tab is open.
// Leaving the tab, selecting another analysis, or unmounting the detail clears it.

import { useEffect } from "react";
import { vsp } from "../../api/vsp";
import { useOverlayStore } from "../../store/overlayStore";
import { useUiStore } from "../../store/uiStore";

export function useAnalysisOverlay(name: string): void {
  const tab = useUiStore((st) => st.sidebarTab);

  useEffect(() => {
    if (tab !== "analyses") return;
    useOverlayStore.getState().show(name);

    let alive = true;
    vsp
      .overlayGet(name)
      .then((data) => {
        if (alive) useOverlayStore.getState().setData(name, data);
      })
      .catch(() => {
        if (alive) useOverlayStore.getState().setData(name, { analysis: name, items: [], note: "The overlay could not be read." });
      });

    return () => {
      alive = false;
      const active = useOverlayStore.getState().active;
      if (active?.analysis === name) useOverlayStore.getState().clear();
    };
  }, [name, tab]);
}
