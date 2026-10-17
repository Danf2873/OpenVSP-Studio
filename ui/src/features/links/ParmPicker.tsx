// Modal parameter picker shared by Variables and Links.
// Two ways to find a parameter: a search across the whole model (parms.search),
// or browsing one component's parameter groups (geom.parms). Picking a
// parameter calls onPick and then onClose.

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeomNode, Parm, ParmGroup, ParmSearchHit } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Modal, Select, Spinner, Tabs } from "../../components";
import { useModelStore } from "../../store/modelStore";
import s from "./parmPicker.module.css";

/** A parameter plus the name of the component that owns it. */
export type PickedParm = Parm & { containerName?: string };

export interface ParmPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (parm: PickedParm) => void;
  title?: string;
}

const SEARCH_LIMIT = 100;
const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;
const NO_GEOMS: GeomNode[] = [];

type PickerTab = "search" | "component";

/** Compact display of a parameter value. */
export function formatParmValue(v: number): string {
  if (!Number.isFinite(v)) return "--";
  return String(Number(v.toPrecision(6)));
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** Depth in the component tree (0 for top level), capped to avoid cycles. */
function depthOf(geoms: GeomNode[], id: string): number {
  const byId = new Map(geoms.map((g) => [g.id, g] as const));
  let depth = 0;
  let parent = byId.get(id)?.parentId ?? null;
  while (parent !== null && depth < 32) {
    depth += 1;
    parent = byId.get(parent)?.parentId ?? null;
  }
  return depth;
}

export function ParmPicker({ open, onClose, onPick, title = "Choose a parameter" }: ParmPickerProps) {
  const [tab, setTab] = useState<PickerTab>("search");

  const pick = (parm: PickedParm) => {
    onPick(parm);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} className={s.modal}>
      <Tabs<PickerTab>
        value={tab}
        onChange={setTab}
        ariaLabel="Parameter source"
        items={[
          { value: "search", label: "Search" },
          { value: "component", label: "From component" },
        ]}
        className={s.tabs}
      />
      {tab === "search" ? <SearchTab onPick={pick} /> : <ComponentTab onPick={pick} />}
    </Modal>
  );
}

// ---------- search ----------

function SearchTab({ onPick }: { onPick: (parm: PickedParm) => void }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ParmSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Debounce the query.
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // Search for the debounced term; only the newest request may update state.
  useEffect(() => {
    const id = ++seq.current;
    if (term.length < MIN_QUERY) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    vsp
      .parmsSearch(term, SEARCH_LIMIT, { silent: true })
      .then((res) => {
        if (id === seq.current) setHits(res);
      })
      .catch((e: unknown) => {
        if (id === seq.current) setError(errorText(e, "Search failed"));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [term]);

  let body;
  if (term.length < MIN_QUERY) {
    body = <p className={s.hint}>Type at least {MIN_QUERY} characters to search every component.</p>;
  } else if (error) {
    body = (
      <p className={s.error} role="alert">
        {error}
      </p>
    );
  } else if (loading && hits.length === 0) {
    body = (
      <div className={s.loading}>
        <Spinner label="Searching" />
      </div>
    );
  } else if (hits.length === 0) {
    body = <p className={s.hint}>No parameters match &ldquo;{term}&rdquo;.</p>;
  } else {
    body = (
      <>
        <ul className={s.results} aria-label="Search results">
          {hits.map((h) => (
            <li key={h.parm.id}>
              <button
                type="button"
                className={s.result}
                onClick={() => onPick({ ...h.parm, containerName: h.containerName })}
              >
                <span className={s.resultMain}>
                  <span className={s.resultTitle}>{h.parm.label || h.parm.name}</span>
                  <span className={s.resultMeta}>
                    {h.parm.group} &middot; {h.containerName}
                  </span>
                </span>
                <span className={s.resultValue}>
                  {formatParmValue(h.parm.value)}
                  {h.parm.units ? ` ${h.parm.units}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {hits.length >= SEARCH_LIMIT && (
          <p className={s.hint}>Showing the first {SEARCH_LIMIT} matches. Refine the search to narrow it.</p>
        )}
      </>
    );
  }

  return (
    <div className={s.section}>
      <input
        type="search"
        className={s.input}
        autoFocus
        placeholder="Name, label or description"
        aria-label="Search parameters"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {body}
    </div>
  );
}

// ---------- browse one component ----------

function ComponentTab({ onPick }: { onPick: (parm: PickedParm) => void }) {
  const geoms = useModelStore((st) => st.model?.geoms ?? NO_GEOMS);
  const selectedId = useModelStore((st) => st.selectedGeomId);
  const [chosen, setChosen] = useState<string | null>(selectedId);
  const [groups, setGroups] = useState<ParmGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Fall back to the first component if the chosen one was removed.
  const geomId = geoms.some((g) => g.id === chosen) ? chosen : (geoms[0]?.id ?? null);
  const geom = geoms.find((g) => g.id === geomId) ?? null;

  useEffect(() => {
    if (geomId === null) {
      setGroups(null);
      return;
    }
    let alive = true;
    setGroups(null);
    setError(null);
    vsp
      .geomParms(geomId, { silent: true })
      .then((g) => {
        if (alive) setGroups(g);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e, "Could not load parameters"));
      });
    return () => {
      alive = false;
    };
  }, [geomId]);

  const geomOptions = useMemo(
    () =>
      geoms.map((g) => ({
        value: g.id,
        label: "  ".repeat(depthOf(geoms, g.id)) + g.name,
      })),
    [geoms],
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (groups ?? [])
      .map((g) => ({
        g,
        parms: g.parms.filter(
          (p) => !q || p.label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
        ),
      }))
      .filter((x) => x.parms.length > 0);
  }, [groups, filter]);

  if (geoms.length === 0) {
    return (
      <div className={s.section}>
        <p className={s.hint}>The model has no components yet.</p>
      </div>
    );
  }

  let body;
  if (error) {
    body = (
      <p className={s.error} role="alert">
        {error}
      </p>
    );
  } else if (groups === null) {
    body = (
      <div className={s.loading}>
        <Spinner label="Loading parameters" />
      </div>
    );
  } else if (visible.length === 0) {
    body = <p className={s.hint}>No matching parameters.</p>;
  } else {
    body = (
      <div className={s.groups}>
        {visible.map(({ g, parms }) => (
          <div key={g.group} className={s.group}>
            <div className={s.groupTitle}>{g.label}</div>
            <ul className={s.results}>
              {parms.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={s.result}
                    onClick={() => onPick({ ...p, containerName: geom?.name })}
                  >
                    <span className={s.resultMain}>
                      <span className={s.resultTitle}>{p.label || p.name}</span>
                      <span className={s.resultMeta}>{p.name}</span>
                    </span>
                    <span className={s.resultValue}>
                      {formatParmValue(p.value)}
                      {p.units ? ` ${p.units}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={s.section}>
      <Select
        value={geomId ?? ""}
        options={geomOptions}
        onChange={setChosen}
        ariaLabel="Component"
        className={s.select}
      />
      <input
        type="search"
        className={s.input}
        placeholder="Filter this component's parameters"
        aria-label="Filter component parameters"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {body}
    </div>
  );
}
