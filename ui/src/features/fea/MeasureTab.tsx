// Measure tab: rulers (between two components) and probes (on one component).

import { useCallback, useEffect, useState } from "react";
import type { GeomNode, Id, MeasureList } from "../../api/types";
import { vsp } from "../../api/vsp";
import { Button, EmptyState, Spinner } from "../../components";
import { useModelStore } from "../../store/modelStore";
import { ConfirmDialog, GeomSelect, ItemRow, ParmsPanel, SectionHead, SplitPane, type ConfirmRequest, type Selection } from "./common";
import { errorText, report, useStructuralSeq } from "./feaData";
import css from "./fea.module.css";

const EMPTY_GEOMS: GeomNode[] = [];

export function MeasureTab() {
  const geoms = useModelStore((st) => st.model?.geoms ?? EMPTY_GEOMS);
  const selectedGeomId = useModelStore((st) => st.selectedGeomId);
  const seq = useStructuralSeq();

  const [data, setData] = useState<MeasureList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [sel, setSel] = useState<Selection | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  // Form picks; empty means "use the default" (selected component, then the first ones).
  const [pickA, setPickA] = useState<Id | null>(null);
  const [pickB, setPickB] = useState<Id | null>(null);
  const [pickProbe, setPickProbe] = useState<Id | null>(null);

  const refresh = useCallback(() => setRev((n) => n + 1), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);

  useEffect(() => {
    let live = true;
    vsp
      .measureList({ silent: true })
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [seq, rev]);

  const has = (id: Id | null) => geoms.some((g) => g.id === id);
  const first = geoms[0]?.id ?? "";
  const rulerA = has(pickA) && pickA ? pickA : has(selectedGeomId) && selectedGeomId ? selectedGeomId : first;
  const rulerB = has(pickB) && pickB ? pickB : (geoms.find((g) => g.id !== rulerA)?.id ?? rulerA);
  const probeGeom = has(pickProbe) && pickProbe ? pickProbe : rulerA;
  const canRuler = geoms.length >= 2 && rulerA !== "" && rulerB !== "" && rulerA !== rulerB;

  const addRuler = () => {
    if (!canRuler) return;
    vsp
      .measureAddRuler(rulerA, rulerB)
      .then(refresh)
      .catch(report);
  };

  const addProbe = () => {
    if (!probeGeom) return;
    vsp
      .measureAddProbe(probeGeom)
      .then(refresh)
      .catch(report);
  };

  const askDelete = (kind: string, name: string, id: Id) =>
    setConfirm({
      title: `Delete ${name}?`,
      text: `This removes the ${kind} "${name}" from the model.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        setSel((prev) => (prev?.id === id ? null : prev));
        vsp
          .measureDelete(id)
          .then(refresh)
          .catch(report);
      },
    });

  const top = (
    <div className={css.body}>
      <div className={css.addForm}>
        <SectionHead title="Add ruler" />
        <div className={css.fieldRow}>
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="ruler-a">
              From
            </label>
            <GeomSelect id="ruler-a" value={rulerA} geoms={geoms} onChange={setPickA} label="Ruler from component" />
          </div>
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="ruler-b">
              To
            </label>
            <GeomSelect id="ruler-b" value={rulerB} geoms={geoms} onChange={setPickB} label="Ruler to component" />
          </div>
        </div>
        <div>
          <Button size="sm" variant="secondary" disabled={!canRuler} onClick={addRuler}>
            Add ruler
          </Button>
        </div>
      </div>

      <div className={css.addForm}>
        <SectionHead title="Add probe" />
        <div className={css.field}>
          <label className={css.fieldLabel} htmlFor="probe-geom">
            Component
          </label>
          <GeomSelect id="probe-geom" value={probeGeom} geoms={geoms} onChange={setPickProbe} label="Probe component" />
        </div>
        <div>
          <Button size="sm" variant="secondary" disabled={!probeGeom} onClick={addProbe}>
            Add probe
          </Button>
        </div>
      </div>

      {data === null ? (
        error ? (
          <EmptyState title="Could not load measurements" text={error} />
        ) : (
          <div className={css.loading}>
            <Spinner label="Loading measurements" />
          </div>
        )
      ) : (
        <>
          <SectionHead title={`Rulers (${data.rulers.length})`} />
          {data.rulers.length === 0 ? (
            <div className={css.hint}>No rulers yet.</div>
          ) : (
            <div className={css.sectionBody}>
              {data.rulers.map((r) => (
                <ItemRow
                  key={r.id}
                  name={r.name}
                  selected={sel?.id === r.id}
                  onSelect={() => setSel({ id: r.id, label: r.name })}
                  onDelete={() => askDelete("ruler", r.name, r.id)}
                  deleteLabel={`Delete ruler ${r.name}`}
                />
              ))}
            </div>
          )}

          <SectionHead title={`Probes (${data.probes.length})`} />
          {data.probes.length === 0 ? (
            <div className={css.hint}>No probes yet.</div>
          ) : (
            <div className={css.sectionBody}>
              {data.probes.map((p) => (
                <ItemRow
                  key={p.id}
                  name={p.name}
                  selected={sel?.id === p.id}
                  onSelect={() => setSel({ id: p.id, label: p.name })}
                  onDelete={() => askDelete("probe", p.name, p.id)}
                  deleteLabel={`Delete probe ${p.name}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={css.tabBody}>
      <SplitPane
        label="measurement"
        top={top}
        bottom={<ParmsPanel containerId={sel?.id ?? null} title={sel?.label ?? null} />}
      />
      <ConfirmDialog request={confirm} onClose={closeConfirm} />
    </div>
  );
}
