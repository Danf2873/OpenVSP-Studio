// Subsurfaces tab: subsurfaces on a chosen component, and control surface groups.

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ControlGroupItem, GeomNode, Id, SubsurfListItem } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, DropdownMenu, EmptyState, Spinner, type MenuEntry } from "../../components";
import { useModelStore } from "../../store/modelStore";
import { ConfirmDialog, GeomSelect, ItemRow, ParmsPanel, SectionHead, SplitPane, type ConfirmRequest, type Selection } from "./common";
import { errorText, report, typeName, useStructuralSeq, useTypeOptions } from "./feaData";
import css from "./fea.module.css";

const EMPTY_GEOMS: GeomNode[] = [];

export function SubsurfacesTab() {
  const geoms = useModelStore((st) => st.model?.geoms ?? EMPTY_GEOMS);
  const selectedGeomId = useModelStore((st) => st.selectedGeomId);
  const seq = useStructuralSeq();
  const types = useTypeOptions("subsurf.types");

  const [pick, setPick] = useState<Id | null>(selectedGeomId);
  const [rev, setRev] = useState(0);
  const [list, setList] = useState<SubsurfListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ControlGroupItem[] | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  // Follow the viewport/sidebar selection when it changes.
  useEffect(() => {
    if (selectedGeomId) setPick(selectedGeomId);
  }, [selectedGeomId]);

  const geomId = geoms.some((g) => g.id === pick) ? pick : (geoms[0]?.id ?? null);
  const refresh = useCallback(() => setRev((n) => n + 1), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);

  useEffect(() => {
    if (geomId === null) return undefined;
    let live = true;
    vsp
      .subsurfList(geomId, { silent: true })
      .then((l) => {
        if (!live) return;
        setList(l);
        setListError(null);
      })
      .catch((e: unknown) => {
        if (live) setListError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [geomId, seq, rev]);

  useEffect(() => {
    let live = true;
    vsp
      .controlGroupsList({ silent: true })
      .then((g) => {
        if (live) setGroups(g);
      })
      .catch(() => {
        if (live) setGroups([]);
      });
    return () => {
      live = false;
    };
  }, [seq, rev]);

  const addItems: MenuEntry[] = types.options
    ? types.options.map((t) => ({
        id: `sub${t.value}`,
        label: t.name,
        onSelect: () => {
          if (geomId === null) return;
          vsp
            .subsurfAdd(geomId, t.value)
            .then(refresh)
            .catch(report);
        },
      }))
    : [{ id: "sub-none", label: types.error ? "Types unavailable" : "Loading types", disabled: true }];

  const askDelete = (item: SubsurfListItem) => {
    if (geomId === null) return;
    setConfirm({
      title: `Delete ${item.name}?`,
      text: `This removes the subsurface "${item.name}" from the component.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        setSel((prev) => (prev?.id === item.id ? null : prev));
        vsp
          .subsurfDelete(geomId, item.id)
          .then(refresh)
          .catch(report);
      },
    });
  };

  const top = (
    <div className={css.body}>
      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor="sub-geom">
          Component
        </label>
        <GeomSelect
          id="sub-geom"
          value={geomId ?? ""}
          geoms={geoms}
          onChange={(id) => setPick(id)}
          label="Component"
        />
      </div>

      <SectionHead
        title="Subsurfaces"
        action={
          <DropdownMenu items={addItems} ariaLabel="Subsurface types">
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={12} />}
              disabled={!types.options || geomId === null}
            >
              Add subsurface
            </Button>
          </DropdownMenu>
        }
      />

      {geomId === null ? (
        <EmptyState title="No components" text="Add a component to attach subsurfaces." />
      ) : listError ? (
        <EmptyState title="Could not load subsurfaces" text={listError} />
      ) : list === null ? (
        <div className={css.loading}>
          <Spinner label="Loading subsurfaces" />
        </div>
      ) : list.length === 0 ? (
        <div className={css.hint}>No subsurfaces on this component.</div>
      ) : (
        <div className={css.sectionBody}>
          {list.map((item) => (
            <ItemRow
              key={item.id}
              name={item.name}
              meta={typeName(types.options, item.type)}
              selected={sel?.id === item.id}
              onSelect={() => setSel({ id: item.id, label: item.name })}
              onDelete={() => askDelete(item)}
              deleteLabel={`Delete subsurface ${item.name}`}
            />
          ))}
        </div>
      )}

      <SectionHead title="Control surface groups" />
      {groups === null ? (
        <div className={css.loading}>
          <Spinner label="Loading control groups" />
        </div>
      ) : (
        <div className={css.sectionBody}>
          {groups.length === 0 && <div className={css.hint}>No control surface groups yet.</div>}
          {groups.map((g) => (
            <div key={g.index} className={css.row}>
              <span className={css.groupName}>{g.name}</span>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            vsp
              .controlGroupsAutoGroup()
              .then(refresh)
              .catch(report);
          }}
        >
          Auto group
        </Button>
      </div>
    </div>
  );

  return (
    <div className={css.tabBody}>
      <SplitPane
        label="subsurface"
        top={top}
        bottom={<ParmsPanel containerId={sel?.id ?? null} title={sel?.label ?? null} />}
      />
      <ConfirmDialog request={confirm} onClose={closeConfirm} />
    </div>
  );
}
