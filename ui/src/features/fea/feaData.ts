// Shared data access for the Structures pane: cached type lists, the FEA tree,
// and refetching after structural model changes.

import { useEffect, useState } from "react";
import { RpcError } from "../../api/client";
import { vsp } from "../../api/vsp";
import type { FeaTree, Id, TypeOption } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { useModelStore } from "../../store/modelStore";

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Toast failures the client did not already report (engine errors are toasted there). */
export function report(e: unknown): void {
  if (e instanceof RpcError) return;
  useAppStore.getState().pushToast("error", errorText(e));
}

/** Counts structural model changes. Plain parameter edits do not bump it. */
export function useStructuralSeq(): number {
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

// ---------- type lists (static for the session; cached) ----------

export type TypeSource = "fea.partTypes" | "fea.subsurfTypes" | "subsurf.types";

const typeCache = new Map<TypeSource, Promise<TypeOption[]>>();

function loadTypes(src: TypeSource): Promise<TypeOption[]> {
  let p = typeCache.get(src);
  if (!p) {
    const req =
      src === "fea.partTypes"
        ? vsp.feaPartTypes({ silent: true })
        : src === "fea.subsurfTypes"
          ? vsp.feaSubsurfTypes({ silent: true })
          : vsp.subsurfTypes({ silent: true });
    p = req.catch((e: unknown) => {
      typeCache.delete(src); // allow a retry on the next mount
      throw e;
    });
    typeCache.set(src, p);
  }
  return p;
}

export interface TypeState {
  options: TypeOption[] | null;
  error: string | null;
}

export function useTypeOptions(src: TypeSource): TypeState {
  const [state, setState] = useState<TypeState>({ options: null, error: null });
  useEffect(() => {
    let live = true;
    loadTypes(src)
      .then((options) => {
        if (live) setState({ options, error: null });
      })
      .catch((e: unknown) => {
        if (live) setState({ options: null, error: errorText(e) });
      });
    return () => {
      live = false;
    };
  }, [src]);
  return state;
}

export function typeName(options: TypeOption[] | null, value: number): string {
  return options?.find((o) => o.value === value)?.name ?? `Type ${value}`;
}

// ---------- FEA tree ----------

export interface FeaTreeState {
  tree: FeaTree | null;
  error: string | null;
  setTree: (tree: FeaTree) => void;
}

/** The fea.tree payload, refetched after structural changes. Mutations return the tree too. */
export function useFeaTree(): FeaTreeState {
  const seq = useStructuralSeq();
  const [tree, setTree] = useState<FeaTree | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    vsp
      .feaTree({ silent: true })
      .then((t) => {
        if (!live) return;
        setTree(t);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [seq]);

  return { tree, error, setTree };
}

export function treeHasId(tree: FeaTree, id: Id): boolean {
  return (
    tree.structs.some(
      (st) => st.id === id || st.parts.some((p) => p.id === id) || st.subsurfs.some((p) => p.id === id),
    ) ||
    tree.materials.some((m) => m.id === id) ||
    tree.properties.some((p) => p.id === id)
  );
}

/** Run a mutation whose result is the fea.tree payload. */
export function mutateTree(fn: () => Promise<FeaTree>, apply: (tree: FeaTree) => void): void {
  fn().then(apply).catch(report);
}

/** Run a mutation with no useful result. */
export function mutate(fn: () => Promise<unknown>): void {
  fn().catch(report);
}
