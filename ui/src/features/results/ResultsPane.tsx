import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, RefreshCw, Trash2 } from "lucide-react";
import { dialogs, onEvent } from "../../api/client";
import type { ResultGetResult, ResultListItem } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, IconButton, Spinner, Tabs } from "../../components";
import { useAppStore } from "../../store/appStore";
import { ResultPlot } from "./ResultPlot";
import { ResultTable } from "./ResultTable";
import { buildModel, toTsv } from "./resultModel";
import { useResultOrder, useResultsFocus } from "./resultsStore";
import s from "./results.module.css";

type ViewTab = "table" | "plot";

interface Detail {
  id: string;
  data: ResultGetResult | null;
  error: string | null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "The engine did not answer.";
}

/** Bottom dock "Results" panel: list of results on the left, table or plot on the right. */
export function ResultsPane() {
  const focusId = useResultsFocus((st) => st.focusId);
  const setFocus = useResultsFocus((st) => st.setFocus);
  const seen = useResultOrder((st) => st.seen);
  const pushToast = useAppStore((st) => st.pushToast);

  const [items, setItems] = useState<ResultListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<ViewTab>("table");
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await vsp.resultsList();
      useResultOrder.getState().note(list.map((i) => i.id));
      setItems(list);
      setListError(null);
    } catch (err) {
      setListError(messageOf(err));
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh whenever any job finishes, since a new result may exist.
  useEffect(
    () =>
      onEvent((e) => {
        if (e.event === "job_done") void refresh();
      }),
    [refresh],
  );

  // Another pane asked for a specific result: select it and clear the request.
  useEffect(() => {
    if (!focusId) return;
    setSelected(focusId);
    setTab("table");
    setFocus(null);
    void refresh();
  }, [focusId, refresh, setFocus]);

  const sorted = useMemo(
    () => (items ?? []).slice().sort((a, b) => (seen[b.id] ?? 0) - (seen[a.id] ?? 0)),
    [items, seen],
  );

  // Keep a valid selection: the newest result when the current one is gone.
  useEffect(() => {
    if (items === null) return;
    if (selected && items.some((i) => i.id === selected)) return;
    setSelected(sorted[0]?.id ?? null);
  }, [items, selected, sorted]);

  // Load the selected result's data.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const id = selected;
    let alive = true;
    setDetail(null);
    setActionError(null);
    vsp
      .resultsGet(id)
      .then((data) => {
        if (alive) setDetail({ id, data, error: null });
      })
      .catch((err: unknown) => {
        if (alive) setDetail({ id, data: null, error: messageOf(err) });
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const model = useMemo(
    () => (detail?.data ? buildModel(detail.data.data) : null),
    [detail],
  );
  const selectedItem = items?.find((i) => i.id === selected) ?? null;
  const title = detail?.data?.name ?? selectedItem?.name ?? "Results";
  const ready = detail !== null && detail.id === selected && detail.data !== null && model !== null;

  const clearAll = async () => {
    setConfirmClear(false);
    try {
      await vsp.resultsClear();
      useResultOrder.getState().reset();
      setFocus(null);
      setItems([]);
      setSelected(null);
      setDetail(null);
    } catch (err) {
      setListError(messageOf(err));
    }
  };

  const copyTable = async () => {
    if (!model) return;
    try {
      await navigator.clipboard.writeText(toTsv(model));
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast("error", "Could not copy to the clipboard.");
    }
  };

  const exportCsv = async () => {
    if (!selected) return;
    const base = (detail?.data?.name ?? "result").replace(/[^A-Za-z0-9_.-]+/g, "_");
    setActionError(null);
    try {
      const path = await dialogs.save({
        title: "Export result as CSV",
        defaultPath: `${base}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      setExporting(true);
      await vsp.resultsExportCsv(selected, path);
      pushToast("success", "CSV exported.", path);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setExporting(false);
    }
  };

  const viewItems: Array<{ value: ViewTab; label: string }> = [
    { value: "table", label: "Table" },
    { value: "plot", label: "Plot" },
  ];

  return (
    <div className={s.pane}>
      <aside className={s.side} aria-label="Result list">
        <div className={s.sideHead}>
          <span className={s.sideTitle}>Results</span>
          <div className={s.sideActions}>
            <IconButton label="Refresh results" icon={<RefreshCw size={14} />} onClick={() => void refresh()} />
            {confirmClear ? (
              <>
                <Button size="sm" variant="danger" onClick={() => void clearAll()}>
                  Delete all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={13} />}
                disabled={sorted.length === 0}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </Button>
            )}
          </div>
        </div>

        <div className={s.sideScroll}>
          {listError && (
            <p className={s.error} role="alert">
              {listError}
            </p>
          )}
          {items === null ? (
            <div className={s.loading}>
              <Spinner label="Loading results" />
              <span>Loading results</span>
            </div>
          ) : sorted.length === 0 ? (
            <p className={s.muted}>No results yet.</p>
          ) : (
            <ul className={s.list}>
              {sorted.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={s.item}
                    aria-current={item.id === selected ? "true" : undefined}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className={s.itemName}>{item.name}</span>
                    <span className={s.itemId}>{item.id.slice(0, 8)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={s.main} aria-label="Result detail">
        {sorted.length === 0 && items !== null ? (
          <EmptyState title="No results yet" text="Run an analysis in the Analyses tab. Its results appear here." />
        ) : (
          <>
            <div className={s.mainHead}>
              <span className={s.mainTitle} title={title}>
                {title}
              </span>
              <Tabs<ViewTab> value={tab} items={viewItems} onChange={setTab} ariaLabel="Result view" />
              <div className={s.mainActions}>
                <IconButton
                  label={copied ? "Copied" : "Copy table"}
                  icon={copied ? <Check size={14} /> : <Copy size={14} />}
                  disabled={!ready}
                  onClick={() => void copyTable()}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Download size={13} />}
                  disabled={!selected || exporting}
                  onClick={() => void exportCsv()}
                >
                  Export CSV…
                </Button>
              </div>
            </div>

            {actionError && (
              <p className={s.error} role="alert">
                {actionError}
              </p>
            )}

            <div className={s.mainBody}>
              {selected === null ? (
                <EmptyState title="No result selected" text="Pick a result from the list." />
              ) : !ready && detail?.error ? (
                <EmptyState title="Could not load result" text={detail.error} />
              ) : !ready || !model ? (
                <div className={s.loading}>
                  <Spinner label="Loading result" />
                  <span>Loading result</span>
                </div>
              ) : tab === "table" ? (
                <ResultTable model={model} />
              ) : (
                <ResultPlot key={detail.id} model={model} />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
