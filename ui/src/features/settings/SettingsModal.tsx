import { useEffect, useState } from "react";
import { loadSettings, saveSettings } from "../../api/settings";
import { isTauri } from "../../api/client";
import { Button, Modal, SegmentedControl, type SegmentOption } from "../../components";
import * as act from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useUiStore } from "../../store/uiStore";
import type { Density, Theme } from "../../api/types";
import s from "./settings.module.css";

const THEME_OPTIONS: SegmentOption<Theme>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITY_OPTIONS: SegmentOption<Density>[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

/** Theme and density apply immediately; paths are saved with the button. */
export function SettingsModal() {
  const open = useUiStore((st) => st.settingsOpen);
  const setOpen = useUiStore((st) => st.setSettingsOpen);
  const theme = useUiStore((st) => st.theme);
  const density = useUiStore((st) => st.density);
  const setTheme = useUiStore((st) => st.setTheme);
  const setDensity = useUiStore((st) => st.setDensity);
  const pushToast = useAppStore((st) => st.pushToast);
  const [python, setPython] = useState("");
  const [root, setRoot] = useState("");

  useEffect(() => {
    if (!open) return;
    loadSettings().then((st) => {
      setPython(st.python);
      setRoot(st.openvspRoot);
    });
  }, [open]);

  const close = () => setOpen(false);

  const save = () => {
    saveSettings({ python: python.trim(), openvspRoot: root.trim() })
      .then(() => pushToast("success", "Settings saved"))
      .catch((err: unknown) => pushToast("error", err instanceof Error ? err.message : "Could not save settings"));
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Settings"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className={s.section}>
        <div className={s.row}>
          <span className={s.label} id="settings-theme">
            Appearance
          </span>
          <SegmentedControl<Theme> value={theme} options={THEME_OPTIONS} onChange={setTheme} ariaLabel="Appearance" />
        </div>
        <div className={s.row}>
          <span className={s.label} id="settings-density">
            Density
          </span>
          <SegmentedControl<Density>
            value={density}
            options={DENSITY_OPTIONS}
            onChange={setDensity}
            ariaLabel="Density"
          />
        </div>
      </div>

      <div className={s.section}>
        <label className={s.field}>
          <span className={s.label}>Python executable</span>
          <input
            className={s.input}
            value={python}
            placeholder={isTauri ? "Bundled engine" : "python"}
            onChange={(e) => setPython(e.target.value)}
          />
        </label>
        <label className={s.field}>
          <span className={s.label}>OpenVSP folder</span>
          <input
            className={s.input}
            value={root}
            placeholder="C:\\OpenVSP-3.54.0-win64"
            onChange={(e) => setRoot(e.target.value)}
          />
        </label>
        <p className={s.hint}>
          Paths take effect the next time the engine starts.
          {!isTauri && " Browser mode keeps only appearance settings."}
        </p>
      </div>

      {isTauri && (
        <div className={s.section}>
          <Button variant="secondary" size="sm" onClick={() => act.guard(() => act.restartEngine())}>
            Restart engine
          </Button>
        </div>
      )}
    </Modal>
  );
}
