// Loads the cross-section data for one component and keeps it current.
//
// - surfaces, list (thumbnails) and detail (profile, groups, edit curve) are
//   fetched for (geomId, surf, index). Each cached value is tagged with the key
//   it was loaded for, so a stale value is never returned for a new selection.
// - Any model change (lastChange.seq) refetches all three, so undo, parm edits
//   from the side form and structural edits elsewhere all show up here.
// - hold() suspends those refetches while a drag is in progress; release()
//   resumes them and refetches once.
// Background loads are silent: failures are shown inline, not as toasts.

import { useCallback, useEffect, useRef, useState } from "react";
import { vsp } from "../../api/vsp";
import type { Id, XsecGetResult, XsecListItem, XsecSurfaceInfo } from "../../api/types";
import { useModelStore } from "../../store/modelStore";
import { useParmStore } from "../../store/parmStore";

export interface XsecData {
  /** Surfaces of the component, or null while loading. */
  surfaces: XsecSurfaceInfo[] | null;
  /** Sections of the selected surface, or null while loading. */
  list: XsecListItem[] | null;
  /** The selected section, or null while loading or after a failed load. */
  detail: XsecGetResult | null;
  /** Message from the last failed detail load for this selection, or null. */
  error: string | null;
  /** Replace the detail with a payload returned by a mutation. */
  setDetail: (d: XsecGetResult) => void;
  /** Pause model-change refetches (drag in progress). */
  hold: () => void;
  /** Resume refetches and reload everything once. */
  release: () => Promise<void>;
}

interface Tagged<T> {
  key: string;
  value: T;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Could not load the cross-section";
}

export function useXsecData(geomId: Id | null, surf: number | null, index: number | null): XsecData {
  const [surfaces, setSurfaces] = useState<Tagged<XsecSurfaceInfo[]> | null>(null);
  const [list, setList] = useState<Tagged<XsecListItem[]> | null>(null);
  const [detail, setDetailState] = useState<Tagged<XsecGetResult> | null>(null);
  const [error, setError] = useState<Tagged<string> | null>(null);

  // Latest key, read by the refresh paths (which are stable callbacks).
  const keyRef = useRef({ geomId, surf, index });
  keyRef.current = { geomId, surf, index };

  // Request sequence numbers: only the newest response of each kind is applied.
  const seqRef = useRef({ surfaces: 0, list: 0, detail: 0 });
  const holdRef = useRef(false);

  const loadSurfaces = useCallback(async (g: Id) => {
    const my = ++seqRef.current.surfaces;
    try {
      const res = await vsp.xsecSurfaces(g, { silent: true });
      if (my === seqRef.current.surfaces) setSurfaces({ key: g, value: res });
    } catch {
      if (my === seqRef.current.surfaces) setSurfaces({ key: g, value: [] });
    }
  }, []);

  const loadList = useCallback(async (g: Id, s: number) => {
    const my = ++seqRef.current.list;
    try {
      const res = await vsp.xsecList(g, s, { silent: true });
      if (my === seqRef.current.list) setList({ key: `${g}|${s}`, value: res });
    } catch {
      if (my === seqRef.current.list) setList({ key: `${g}|${s}`, value: [] });
    }
  }, []);

  const loadDetail = useCallback(async (g: Id, s: number, i: number, resetParms: boolean) => {
    const my = ++seqRef.current.detail;
    const key = `${g}|${s}|${i}`;
    try {
      const res = await vsp.xsecGet(g, s, i, { silent: true });
      if (my !== seqRef.current.detail) return;
      // Structural changes can change parm values under the side form; drop
      // stale overrides the same way the inspector does.
      if (resetParms) useParmStore.getState().reset();
      setDetailState({ key, value: res });
      setError(null);
    } catch (err) {
      if (my !== seqRef.current.detail) return;
      // Keep the previous detail on a transient failure; report the message.
      setError({ key, value: messageOf(err) });
    }
  }, []);

  const refreshAll = useCallback(
    async (resetParms: boolean) => {
      const { geomId: g, surf: s, index: i } = keyRef.current;
      if (!g) return;
      const jobs: Promise<void>[] = [loadSurfaces(g)];
      if (s !== null) {
        jobs.push(loadList(g, s));
        if (i !== null) jobs.push(loadDetail(g, s, i, resetParms));
      }
      await Promise.all(jobs);
    },
    [loadSurfaces, loadList, loadDetail],
  );

  // Component changed: fetch its surfaces.
  useEffect(() => {
    if (geomId) void loadSurfaces(geomId);
  }, [geomId, loadSurfaces]);

  // Surface changed: fetch its sections.
  useEffect(() => {
    if (geomId && surf !== null) void loadList(geomId, surf);
  }, [geomId, surf, loadList]);

  // Section changed: fetch its detail.
  useEffect(() => {
    if (geomId && surf !== null && index !== null) void loadDetail(geomId, surf, index, false);
  }, [geomId, surf, index, loadDetail]);

  // Model changed somewhere (parm edit, undo, xsec edit, structural change).
  const seq = useModelStore((st) => st.lastChange.seq);
  const seenSeq = useRef(seq);
  useEffect(() => {
    if (seq === seenSeq.current) return;
    seenSeq.current = seq;
    if (holdRef.current) return;
    const resetParms = !useModelStore.getState().lastChange.parmsOnly;
    void refreshAll(resetParms);
  }, [seq, refreshAll]);

  const setDetail = useCallback((d: XsecGetResult) => {
    const { geomId: g, surf: s, index: i } = keyRef.current;
    seqRef.current.detail += 1; // invalidate any load still in flight
    if (g && s !== null && i !== null) setDetailState({ key: `${g}|${s}|${i}`, value: d });
    setError(null);
  }, []);

  const hold = useCallback(() => {
    holdRef.current = true;
  }, []);

  const release = useCallback(() => {
    holdRef.current = false;
    return refreshAll(false);
  }, [refreshAll]);

  // Only return values loaded for the current selection.
  const surfKey = geomId ?? "";
  const listKey = geomId && surf !== null ? `${geomId}|${surf}` : "";
  const detailKey = geomId && surf !== null && index !== null ? `${geomId}|${surf}|${index}` : "";

  return {
    surfaces: geomId && surfaces?.key === surfKey ? surfaces.value : null,
    list: listKey && list?.key === listKey ? list.value : null,
    detail: detailKey && detail?.key === detailKey ? detail.value : null,
    error: detailKey && error?.key === detailKey ? error.value : null,
    setDetail,
    hold,
    release,
  };
}
