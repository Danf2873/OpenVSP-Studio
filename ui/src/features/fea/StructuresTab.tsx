// Structures tab: FEA structures with their parts and subsurfaces, materials,
// properties, and the FeaMeshAnalysis job.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Grid3x3, Plus, Trash2 } from "lucide-react";
import type { FeaStruct, FeaTree, GeomNode, Id } from "../../api/types";
import { vsp } from "../../api/vsp";
import {
  Button,
  Disclosure,
  DropdownMenu,
  EmptyState,
  IconButton,
  Modal,
  Spinner,
  cx,
  type MenuEntry,
} from "../../components";
import { useModelStore } from "../../store/modelStore";
import { useUiStore } from "../../store/uiStore";
import {
  ConfirmDialog,
  EditableLabel,
  GeomSelect,
  ItemRow,
  ParmsPanel,
  SectionHead,
  SplitPane,
  type ConfirmRequest,
  type Selection,
} from "./common";
import {
  errorText,
  mutateTree,
  report,
  treeHasId,
  typeName,
  useFeaTree,
  useTypeOptions,
  type TypeState,
} from "./feaData";
import css from "./fea.module.css";

const MESH_ANALYSIS = "FeaMeshAnalysis";
const EMPTY_GEOMS: GeomNode[] = [];

type MeshState =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "done"; seconds: number }
  | { status: "error"; message: string };

/** Callbacks passed to each structure card. */
interface Handlers {
  select: (structId: Id, id: Id, label: string) => void;
  rename: (id: Id, name: string) => void;
  remove: (kind: string, label: string, id: Id) => void;
  addPart: (structId: Id, type: number) => void;
  addSub: (structId: Id, type: number) => void;
}

function typeItems(
  types: TypeState,
  pick: (value: number) => void,
  prefix: string,
): MenuEntry[] {
  if (types.options) {
    return types.options.map((t) => ({ id: `${prefix}${t.value}`, label: t.name, onSelect: () => pick(t.value) }));
  }
  return [{ id: `${prefix}none`, label: types.error ? "Types unavailable" : "Loading types", disabled: true }];
}

// ---------- structure card ----------

interface StructCardProps {
  st: FeaStruct;
  geomName: string;
  active: boolean;
  selectedId: Id | null;
  partTypes: TypeState;
  subTypes: TypeState;
  h: Handlers;
}

function StructCard({ st, geomName, active, selectedId, partTypes, subTypes, h }: StructCardProps) {
  const partMenu = typeItems(partTypes, (t) => h.addPart(st.id, t), "p");
  const subMenu = typeItems(subTypes, (t) => h.addSub(st.id, t), "s");

  return (
    <section className={cx(css.card, active && css.cardActive)} aria-label={`Structure ${st.name}`}>
      <div className={css.cardHead}>
        <EditableLabel
          name={st.name}
          meta={geomName}
          selected={selectedId === st.id}
          onSelect={() => h.select(st.id, st.id, st.name)}
          onRename={(n) => h.rename(st.id, n)}
          className={css.cardLabel}
        />
        <IconButton
          label={`Delete structure ${st.name}`}
          icon={<Trash2 size={13} />}
          onClick={() => h.remove("structure", st.name, st.id)}
        />
      </div>

      <div className={css.cardActions}>
        <DropdownMenu items={partMenu} ariaLabel={`Add part to ${st.name}`}>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={12} />}
            iconRight={<ChevronDown size={12} />}
            disabled={!partTypes.options}
          >
            Add part
          </Button>
        </DropdownMenu>
        <DropdownMenu items={subMenu} ariaLabel={`Add subsurface to ${st.name}`}>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={12} />}
            iconRight={<ChevronDown size={12} />}
            disabled={!subTypes.options}
          >
            Add subsurface
          </Button>
        </DropdownMenu>
      </div>

      {st.parts.length > 0 && (
        <div className={css.itemGroup}>
          <div className={css.groupLabel}>Parts</div>
          {st.parts.map((p) => (
            <ItemRow
              key={p.id}
              name={p.name}
              meta={typeName(partTypes.options, p.type)}
              selected={selectedId === p.id}
              onSelect={() => h.select(st.id, p.id, p.name)}
              onRename={(n) => h.rename(p.id, n)}
              onDelete={() => h.remove("part", p.name, p.id)}
              deleteLabel={`Delete part ${p.name}`}
            />
          ))}
        </div>
      )}

      {st.subsurfs.length > 0 && (
        <div className={css.itemGroup}>
          <div className={css.groupLabel}>Subsurfaces</div>
          {st.subsurfs.map((s) => (
            <ItemRow
              key={s.id}
              name={s.name}
              meta={typeName(subTypes.options, s.type)}
              selected={selectedId === s.id}
              onSelect={() => h.select(st.id, s.id, s.name)}
              onRename={(n) => h.rename(s.id, n)}
              onDelete={() => h.remove("subsurface", s.name, s.id)}
              deleteLabel={`Delete subsurface ${s.name}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- mesh status ----------

function MeshStatus({ mesh, onView }: { mesh: MeshState; onView: () => void }) {
  const running = mesh.status === "running";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  if (mesh.status === "idle") return null;

  if (mesh.status === "running") {
    const elapsed = Math.max(0, Math.floor((now - mesh.startedAt) / 1000));
    return (
      <div className={css.meshStatus} aria-live="polite">
        <span className={css.meshStatusText}>
          <Spinner label="Meshing structure" />
          Meshing... {elapsed}s
        </span>
      </div>
    );
  }

  if (mesh.status === "done") {
    return (
      <div className={css.meshStatus} aria-live="polite">
        <span>Mesh complete in {mesh.seconds}s.</span>
        <Button size="sm" variant="ghost" onClick={onView}>
          View results
        </Button>
      </div>
    );
  }

  return (
    <div className={css.meshStatus} data-error="true" role="alert">
      <span>Meshing failed: {mesh.message}</span>
    </div>
  );
}

// ---------- new structure dialog ----------

interface NewStructureDialogProps {
  open: boolean;
  geoms: GeomNode[];
  defaultGeomId: Id | null;
  onClose: () => void;
  onCreated: (tree: FeaTree) => void;
}

function NewStructureDialog({ open, geoms, defaultGeomId, onClose, onCreated }: NewStructureDialogProps) {
  const [geomId, setGeomId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fallback = geoms.find((g) => g.id === defaultGeomId)?.id ?? geoms[0]?.id ?? "";
    setGeomId(fallback);
    setBusy(false);
  }, [open, defaultGeomId, geoms]);

  const create = () => {
    if (!geomId || busy) return;
    setBusy(true);
    vsp
      .feaAddStruct(geomId)
      .then((t) => onCreated(t))
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New structure"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!geomId || busy} onClick={create}>
            Create structure
          </Button>
        </>
      }
    >
      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor="fea-new-geom">
          Component
        </label>
        <GeomSelect id="fea-new-geom" value={geomId} geoms={geoms} onChange={setGeomId} label="Component" />
      </div>
      <p className={css.hint}>Every new structure starts with a Skin part.</p>
    </Modal>
  );
}

// ---------- tab ----------

export function StructuresTab() {
  const geoms = useModelStore((st) => st.model?.geoms ?? EMPTY_GEOMS);
  const selectedGeomId = useModelStore((st) => st.selectedGeomId);
  const openDock = useUiStore((st) => st.openDock);
  const { tree, error, setTree } = useFeaTree();
  const partTypes = useTypeOptions("fea.partTypes");
  const subTypes = useTypeOptions("fea.subsurfTypes");

  const [sel, setSel] = useState<Selection | null>(null);
  const [activeId, setActiveId] = useState<Id | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [mesh, setMesh] = useState<MeshState>({ status: "idle" });

  const structs = tree?.structs ?? [];
  const active = structs.find((st) => st.id === activeId) ?? structs[0] ?? null;

  // Keep the selection valid after any tree change (deleting a parent clears children).
  const applyTree = useCallback(
    (t: FeaTree) => {
      setTree(t);
      setSel((prev) => (prev && treeHasId(t, prev.id) ? prev : null));
    },
    [setTree],
  );

  const closeNew = useCallback(() => setNewOpen(false), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);

  const handlers: Handlers = {
    select: (structId, id, label) => {
      setActiveId(structId);
      setSel({ id, label });
    },
    rename: (id, name) => mutateTree(() => vsp.feaRename(id, name), applyTree),
    remove: (kind, label, id) =>
      setConfirm({
        title: `Delete ${label}?`,
        text: `This removes the ${kind} "${label}" from the model.`,
        confirmLabel: "Delete",
        onConfirm: () => mutateTree(() => vsp.feaDelete(id), applyTree),
      }),
    addPart: (structId, type) => mutateTree(() => vsp.feaAddPart(structId, type), applyTree),
    addSub: (structId, type) => mutateTree(() => vsp.feaAddSubSurf(structId, type), applyTree),
  };

  const runMesh = async (st: FeaStruct) => {
    const index = structs.findIndex((x) => x.id === st.id);
    if (index < 0) return;
    const startedAt = Date.now();
    setMesh({ status: "running", startedAt });
    try {
      // The struct index input name is discovered at runtime (contains "Struct").
      const inputs = await vsp.analysisInputs(MESH_ANALYSIS, { silent: true });
      const pick = inputs.find((i) => i.type === "int" && /struct/i.test(i.name));
      if (pick) await vsp.analysisSetInput(MESH_ANALYSIS, pick.name, [index]);
      await vsp.analysisRunJob(MESH_ANALYSIS);
      setMesh({ status: "done", seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) });
    } catch (e) {
      setMesh({ status: "error", message: errorText(e) });
    }
  };

  const addMaterial = () => mutateTree(() => vsp.feaAddMaterial(), applyTree);
  const addProperty = () => mutateTree(() => vsp.feaAddProperty(0), applyTree);

  const geomNameOf = (id: Id) => geoms.find((g) => g.id === id)?.name ?? "Missing component";

  const top = (
    <div className={css.body}>
      <div className={css.toolbar}>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus size={13} />}
          disabled={geoms.length === 0}
          onClick={() => setNewOpen(true)}
        >
          New structure
        </Button>
        {active && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Grid3x3 size={13} />}
            disabled={mesh.status === "running"}
            title={`Mesh ${active.name}`}
            onClick={() => void runMesh(active)}
          >
            Mesh structure
          </Button>
        )}
      </div>

      <MeshStatus mesh={mesh} onView={() => openDock("results")} />

      {tree === null ? (
        error ? (
          <EmptyState title="Could not load structures" text={error} />
        ) : (
          <div className={css.loading}>
            <Spinner label="Loading structures" />
          </div>
        )
      ) : structs.length === 0 ? (
        <EmptyState
          title="No structures yet"
          text={
            geoms.length === 0
              ? "Add a component first, then create a structure on it."
              : "Create a structure on a component to add parts and subsurfaces."
          }
        />
      ) : (
        structs.map((st) => (
          <StructCard
            key={st.id}
            st={st}
            geomName={geomNameOf(st.geomId)}
            active={active?.id === st.id}
            selectedId={sel?.id ?? null}
            partTypes={partTypes}
            subTypes={subTypes}
            h={handlers}
          />
        ))
      )}

      {tree && (
        <>
          <Disclosure title={`Materials (${tree.materials.length})`} storageKey="fea:materials">
            <div className={css.sectionBody}>
              <SectionHead
                title="Library and custom"
                action={
                  <IconButton label="Add material" icon={<Plus size={14} />} onClick={addMaterial} />
                }
              />
              {tree.materials.map((m) => (
                <ItemRow
                  key={m.id}
                  name={m.name}
                  selected={sel?.id === m.id}
                  onSelect={() => setSel({ id: m.id, label: m.name })}
                  onRename={(n) => handlers.rename(m.id, n)}
                  onDelete={() => handlers.remove("material", m.name, m.id)}
                  deleteLabel={`Delete material ${m.name}`}
                />
              ))}
            </div>
          </Disclosure>

          <Disclosure title={`Properties (${tree.properties.length})`} storageKey="fea:properties">
            <div className={css.sectionBody}>
              <SectionHead
                title="Shell and beam"
                action={
                  <IconButton label="Add property" icon={<Plus size={14} />} onClick={addProperty} />
                }
              />
              {tree.properties.map((p) => (
                <ItemRow
                  key={p.id}
                  name={p.name}
                  selected={sel?.id === p.id}
                  onSelect={() => setSel({ id: p.id, label: p.name })}
                  onRename={(n) => handlers.rename(p.id, n)}
                  onDelete={() => handlers.remove("property", p.name, p.id)}
                  deleteLabel={`Delete property ${p.name}`}
                />
              ))}
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );

  return (
    <div className={css.tabBody}>
      <SplitPane
        label="structure"
        top={top}
        bottom={<ParmsPanel containerId={sel?.id ?? null} title={sel?.label ?? null} />}
      />
      <NewStructureDialog
        open={newOpen}
        geoms={geoms}
        defaultGeomId={selectedGeomId}
        onClose={closeNew}
        onCreated={(t) => {
          const before = new Set(structs.map((st) => st.id));
          const created = t.structs.find((st) => !before.has(st.id));
          applyTree(t);
          if (created) setActiveId(created.id);
          setNewOpen(false);
        }}
      />
      <ConfirmDialog request={confirm} onClose={closeConfirm} />
    </div>
  );
}
