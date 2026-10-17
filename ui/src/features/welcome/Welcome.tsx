import { FilePlus, FolderOpen, Clock } from "lucide-react";
import { Button } from "../../components";
import * as act from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useUiStore } from "../../store/uiStore";
import s from "./welcome.module.css";

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : "";
}

/** Shown when the engine has no model loaded and no file open. */
export function Welcome() {
  const appInfo = useAppStore((st) => st.appInfo);
  const recent = useUiStore((st) => st.recentFiles);

  return (
    <div className={s.welcome}>
      <section className={s.hero}>
        <div className={s.actions}>
          <Button size="lg" variant="primary" icon={<FilePlus size={16} />} onClick={() => act.guard(() => act.newModel())}>
            New model
          </Button>
          <Button
            size="lg"
            variant="secondary"
            icon={<FolderOpen size={16} />}
            onClick={() => act.guard(() => act.openModelDialog())}
          >
            Open…
          </Button>
        </div>
      </section>

      {recent.length > 0 && (
        <section className={s.section} aria-labelledby="welcome-recent">
          <h2 id="welcome-recent" className={s.sectionTitle}>
            <Clock size={14} aria-hidden="true" /> Recent
          </h2>
          <ul className={s.recentList}>
            {recent.slice(0, 8).map((p) => (
              <li key={p}>
                <button type="button" className={s.recentItem} title={p} onClick={() => act.guard(() => act.openModel(p))}>
                  <span className={s.recentName}>{baseName(p)}</span>
                  <span className={s.recentPath}>{dirName(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {appInfo && appInfo.examples.length > 0 && (
        <section className={s.section} aria-labelledby="welcome-examples">
          <h2 id="welcome-examples" className={s.sectionTitle}>
            Examples
          </h2>
          <div className={s.grid}>
            {appInfo.examples.map((ex) => (
              <button
                key={ex.path}
                type="button"
                className={s.card}
                title={ex.path}
                onClick={() => act.guard(() => act.openModel(ex.path))}
              >
                <span className={s.cardTitle}>{ex.name}</span>
                <span className={s.cardPath}>{baseName(dirName(ex.path)) || "examples"}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
