import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { AnalysisInfo } from "../../api/types";
import { EmptyState, IconButton, Spinner } from "../../components";
import { useAppStore } from "../../store/appStore";
import { useUiStore } from "../../store/uiStore";
import { AnalysisDetail } from "./AnalysisDetail";
import { describeAnalysis, GROUP_ORDER } from "./analysisInfo";
import { useRunStore } from "./runStore";
import s from "./analyses.module.css";

function StatusMark({ name }: { name: string }) {
  const run = useRunStore((st) => st.runs[name] ?? null);
  if (!run) return null;
  if (run.status === "running") return <Spinner label={`${name} running`} />;
  if (run.status === "done") return <Check size={13} className={s.doneMark} aria-label="Last run finished" />;
  return <X size={13} className={s.errorMark} aria-label="Last run failed" />;
}

/** Sidebar "Analyses" tab: searchable, grouped list, and the input form for the selected analysis. */
export function AnalysesPane() {
  const analyses = useAppStore((st) => st.appInfo?.analyses ?? null);
  const engineError = useAppStore((st) => st.appInfoError);
  const focus = useUiStore((st) => st.analysisFocus);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Consume a focus request (from the command palette or elsewhere) once.
  useEffect(() => {
    if (!focus) return;
    setSelected(focus);
    useUiStore.setState({ analysisFocus: null });
  }, [focus]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: AnalysisInfo[] = analyses ?? [];
    const matches = (a: AnalysisInfo) =>
      q === "" || a.name.toLowerCase().includes(q) || describeAnalysis(a.name).toLowerCase().includes(q);
    return GROUP_ORDER.map((group) => ({
      group,
      items: list.filter((a) => a.group === group && matches(a)),
    })).filter((g) => g.items.length > 0);
  }, [analyses, query]);

  if (selected !== null) {
    return (
      <div className={s.pane}>
        <div className={s.head}>
          <IconButton label="All analyses" icon={<ChevronLeft size={16} />} onClick={() => setSelected(null)} />
          <div className={s.headText}>
            <span className={s.paneTitle}>{selected}</span>
            <span className={s.paneSub}>{describeAnalysis(selected)}</span>
          </div>
        </div>
        <div className={s.scroll}>
          <AnalysisDetail key={selected} name={selected} />
        </div>
      </div>
    );
  }

  return (
    <div className={s.pane}>
      <div className={s.head}>
        <span className={s.paneTitle}>Analyses</span>
      </div>
      <div className={s.searchWrap}>
        <Search size={14} className={s.searchIcon} aria-hidden="true" />
        <input
          className={s.search}
          type="search"
          aria-label="Search analyses"
          placeholder="Search analyses"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
      </div>
      <div className={s.scroll}>
        {analyses === null ? (
          engineError ? (
            <EmptyState title="Engine not connected" text={engineError} />
          ) : (
            <div className={s.loading}>
              <Spinner label="Loading analyses" />
              <span>Loading analyses</span>
            </div>
          )
        ) : groups.length === 0 ? (
          <EmptyState title="No matches" text="Try a different search." />
        ) : (
          groups.map(({ group, items }) => (
            <section key={group} className={s.groupSection} aria-labelledby={`grp-${group}`}>
              <h3 id={`grp-${group}`} className={s.groupTitle}>
                {group}
                <span className={s.count}>{items.length}</span>
              </h3>
              <ul className={s.list}>
                {items.map((a) => (
                  <li key={a.name}>
                    <button type="button" className={s.item} onClick={() => setSelected(a.name)}>
                      <span className={s.itemText}>
                        <span className={s.itemName}>{a.name}</span>
                        <span className={s.itemDesc}>{describeAnalysis(a.name)}</span>
                      </span>
                      <span className={s.itemTrail}>
                        <StatusMark name={a.name} />
                        <ChevronRight size={14} aria-hidden="true" className={s.chev} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
