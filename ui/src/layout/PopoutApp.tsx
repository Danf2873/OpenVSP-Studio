import { Suspense, useEffect } from "react";
import { Spinner, ToastRegion } from "../components";
import { useUiStore } from "../store/uiStore";
import { XsecEditor } from "../features/xsec-editor/XsecEditor";
import s from "./layout.module.css";

/** Window opened from the cross-section pop-out button (#/xsec). */
export function PopoutApp() {
  const dark = useUiStore((st) => st.theme);
  useEffect(() => {
    document.title = "Cross-Section Editor - OpenVSP Studio";
  }, [dark]);

  return (
    <div className={s.popout}>
      <header className={s.popoutHead}>
        <span className={s.appName}>Cross-Section Editor</span>
      </header>
      <div className={s.popoutBody}>
        <Suspense fallback={<Spinner label="Loading editor" />}>
          <XsecEditor inWindow />
        </Suspense>
      </div>
      <ToastRegion />
    </div>
  );
}
