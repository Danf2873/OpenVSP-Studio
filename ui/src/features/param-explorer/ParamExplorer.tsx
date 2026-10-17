// Parameter Explorer (dock pane): reach every parameter in the model.
// Left: parameter containers (components, settings, others). Right: a global
// search across all parameters, or the selected container's parameters.

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ContainerInfo, GeomNode, Id, ParmGroup, ParmSearchHit } from "../../api/types";
import { vsp } from "../../api/vsp";
import { EmptyState, ParmField, ParmGroupList, Spinner } from "../../components";
import { useModelStore } from "../../store/modelStore";
import { useParmStore } from "../../store/parmStore";
import { useUiStore } from "../../store/uiStore";
import css from "./param-explorer.module.css";

const EMPTY_GEOMS: GeomNode[] = [];
const MIN_QUERY = 2;
const SEARCH_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 180;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Bumps on structural model changes only; plain parameter edits do not reload lists. */
function useStructuralSeq(): number {
  const [seq, setSeq] = useState(0);
  useEffect(
    () =>
      useModelStore.subscribe((state, prev) => {
        if (state.lastChange.seq !== prev.lastChange.seq && !state.lastChange.parmsOnly) {
          setSeq((n) => n + 1);
        }
      }),
    [],
  );
  return seq;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function isSettingsName(name: string): boolean {
  return /settings$/i.test(name) || /^vehicle$/i.test(name);
}

// ---------- container list model ----------

interface ContainerItem {
  id: Id;
  label: string;
  sub: string;
}

interface ContainerSection {
  title: string;
  items: ContainerItem[];
}

/** Components first (in model order), then settings containers, then everything else. */
function buildSections(containers: ContainerInfo[], geoms: GeomNode[]): ContainerSection[] {
  const geomIds = new Set(geoms.map((g) => g.id));
  const components: ContainerItem[] = [];
  for (const g of geoms) {
    if (containers.some((c) => c.id === g.id)) {
      components.push({ id: g.id, label: g.name, sub: titleCase(g.type) });
    }
  }

  const settings: ContainerItem[] = [];
  const other: ContainerItem[] = [];
  for (const c of containers) {
    if (geomIds.has(c.id)) continue;
    if (isSettingsName(c.name)) settings.push({ id: c.id, label: c.name, sub: "Settings" });
    else other.push({ id: c.id, label: c.name, sub: "" });
  }

  return [
    { title: "Components", items: components },
    { title: "Settings", items: settings },
    { title: "Other", items: other },
  ].filter((sec) => sec.items.length > 0);
}

// ---------- search results model ----------

interface HitGroup {
  containerId: Id;
  containerName: string;
  rows: ParmSearchHit[];
}

function groupHits(rows: ParmSearchHit[]): HitGroup[] {
  const map = new Map<Id, HitGroup>();
  for (const r of rows) {
    let g = map.get(r.containerId);
    if (!g) {
      g = { containerId: r.containerId, containerName: r.containerName, rows: [] };
      map.set(r.containerId, g);
    }
    g.rows.push(r);
  }
  return [...map.values()];
}

// ---------- components ----------

interface ContainerViewProps {
  containerId: Id | null;
  label: string;
  groups: ParmGroup[] | null;
  error: string | null;
}

function ContainerView({ containerId, label, groups, error }: ContainerViewProps) {
  if (containerId === null) {
    return <EmptyState title="No parameter containers" text="The engine reported no containers for this model." />;
  }
  if (error) return <EmptyState title="Could not load parameters" text={error} />;
  if (groups === null) {
    return (
      <div className={css.loading}>
        <Spinner label="Loading parameters" />
      </div>
    );
  }
  return (
    <>
      <div className={css.containerHead}>{label}</div>
      <ParmGroupList groups={groups} />
    </>
  );
}

interface SearchResultsProps {
  query: string;
  rows: ParmSearchHit[] | null;
  error: string | null;
}

function SearchResults({ query, rows, error }: SearchResultsProps) {
  if (error) return <EmptyState title="Search failed" text={error} />;
  if (rows === null) {
    return (
      <div className={css.loading}>
        <Spinner label="Searching" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title="No matches" text={`No parameter matches "${query}".`} />;
  }
  const groups = groupHits(rows);
  return (
    <>
      <div className={css.resultsHead}>
        {rows.length} match{rows.length === 1 ? "" : "es"}
        {rows.length >= SEARCH_LIMIT ? ` (first ${SEARCH_LIMIT} shown; refine the query)` : ""}
      </div>
      {groups.map((g) => (
        <section key={g.containerId} className={css.hitGroup} aria-label={g.containerName}>
          <div className={css.hitGroupTitle}>
            <span>{g.containerName}</span>
            <span className={css.hitCount}>{g.rows.length}</span>
          </div>
          {g.rows.map((r) => (
            <div key={r.parm.id} className={css.hitRow}>
              <div className={css.hitMeta}>
                <span>{r.containerName}</span>
                <span aria-hidden="true">·</span>
                <span>{r.parm.group}</span>
              </div>
              <ParmField parm={r.parm} />
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

// ---------- pane ----------

export function ParamExplorer() {
  const paramQuery = useUiStore((st) => st.paramQuery);
  const geoms = useModelStore((st) => st.model?.geoms ?? EMPTY_GEOMS);
  const seq = useStructuralSeq();

  const [query, setQuery] = useState(paramQuery);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Id | null>(null);

  const [containers, setContainers] = useState<ContainerInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [groups, setGroups] = useState<{ id: Id; list: ParmGroup[] } | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [hits, setHits] = useState<{ q: string; rows: ParmSearchHit[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // The command palette sets paramQuery; adopt it whenever it changes.
  useEffect(() => {
    setQuery(paramQuery);
  }, [paramQuery]);

  const q = query.trim();
  const searching = q.length >= MIN_QUERY;

  // Container list.
  useEffect(() => {
    let live = true;
    vsp
      .parmsContainers({ silent: true })
      .then((c) => {
        if (!live) return;
        setContainers(c);
        setListError(null);
      })
      .catch((e: unknown) => {
        if (live) setListError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [seq]);

  const sections = useMemo(() => buildSections(containers ?? [], geoms), [containers, geoms]);
  const flat = useMemo(() => sections.flatMap((sec) => sec.items), [sections]);

  const needle = filter.trim().toLowerCase();
  const shownSections = useMemo(
    () =>
      needle
        ? sections
            .map((sec) => ({
              ...sec,
              items: sec.items.filter((it) => `${it.label} ${it.sub}`.toLowerCase().includes(needle)),
            }))
            .filter((sec) => sec.items.length > 0)
        : sections,
    [sections, needle],
  );

  const current = flat.find((it) => it.id === picked) ?? flat[0] ?? null;
  const currentId = current?.id ?? null;
  const currentLabel = current?.label ?? "";

  // Global search (debounced; stale responses are ignored).
  useEffect(() => {
    if (!searching) return undefined;
    let live = true;
    const t = window.setTimeout(() => {
      vsp
        .parmsSearch(q, SEARCH_LIMIT, { silent: true })
        .then((rows) => {
          if (!live) return;
          useParmStore.getState().reset();
          setHits({ q, rows });
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (live) setSearchError(errorText(e));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, searching, seq]);

  // Selected container's parameters (only shown when not searching).
  useEffect(() => {
    if (searching || currentId === null) return undefined;
    let live = true;
    vsp
      .parmsList(currentId, { silent: true })
      .then((list) => {
        if (!live) return;
        useParmStore.getState().reset();
        setGroups({ id: currentId, list });
        setGroupsError(null);
      })
      .catch((e: unknown) => {
        if (live) setGroupsError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [currentId, searching, seq]);

  const shownGroups = groups && groups.id === currentId ? groups.list : null;
  const searchRows = searching && hits && hits.q === q ? hits.rows : null;

  return (
    <div className={css.explorer}>
      <aside className={css.side} aria-label="Parameter containers">
        <div className={css.sideHead}>
          <input
            type="search"
            className={css.input}
            placeholder="Filter containers"
            aria-label="Filter containers"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className={css.sideList}>
          {listError && <div className={css.hint}>{listError}</div>}
          {containers === null && !listError && (
            <div className={css.loading}>
              <Spinner label="Loading containers" />
            </div>
          )}
          {shownSections.map((sec) => (
            <div key={sec.title} className={css.secGroup}>
              <div className={css.secTitle}>{sec.title}</div>
              {sec.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={css.containerBtn}
                  aria-pressed={it.id === currentId}
                  title={it.label}
                  onClick={() => setPicked(it.id)}
                >
                  <span className={css.containerName}>{it.label}</span>
                  {it.sub && <span className={css.containerSub}>{it.sub}</span>}
                </button>
              ))}
            </div>
          ))}
          {containers !== null && shownSections.length === 0 && (
            <div className={css.hint}>No containers match.</div>
          )}
        </div>
      </aside>

      <section className={css.main} aria-label="Parameters">
        <div className={css.searchBar}>
          <div className={css.searchField}>
            <Search size={13} aria-hidden="true" className={css.searchIcon} />
            <input
              type="search"
              className={css.searchInput}
              placeholder="Search all parameters"
              aria-label="Search all parameters"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
          </div>
          {q.length === 1 && <span className={css.hint}>Type at least 2 characters to search every parameter.</span>}
        </div>

        <div className={css.results}>
          {searching ? (
            <SearchResults query={q} rows={searchRows} error={searchError} />
          ) : (
            <ContainerView
              containerId={currentId}
              label={currentLabel}
              groups={shownGroups}
              error={groupsError}
            />
          )}
        </div>
      </section>
    </div>
  );
}
