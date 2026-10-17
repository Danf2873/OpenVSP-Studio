import { Modal } from "../../components";
import { useAppStore } from "../../store/appStore";
import { useUiStore } from "../../store/uiStore";
import s from "./settings.module.css";

export function AboutModal() {
  const open = useUiStore((st) => st.aboutOpen);
  const setOpen = useUiStore((st) => st.setAboutOpen);
  const info = useAppStore((st) => st.appInfo);
  const engineVersion = useAppStore((st) => st.engineVersion);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="About OpenVSP Studio">
      <div className={s.section}>
        <div className={s.row}>
          <span className={s.label}>Studio</span>
          <span>0.1.0</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>OpenVSP</span>
          <span>{info?.version ?? "Not connected"}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>Engine</span>
          <span>{engineVersion ?? "Not connected"}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>Install folder</span>
          <span style={{ wordBreak: "break-all", textAlign: "right" }}>{info?.vspRoot || "Unknown"}</span>
        </div>
      </div>
    </Modal>
  );
}
