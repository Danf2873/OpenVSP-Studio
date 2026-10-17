// Variables > Design vars: the design variable table, add / clear, and
// import / export of .des and .xddm files.

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, FileDown, FileUp, Plus } from "lucide-react";
import type { DesignVar, FileFilter, Parm } from "../../api/types";
import { dialogs } from "../../api/client";
import { vsp } from "../../api/vsp";
import { Button, DropdownMenu, EmptyState, Select, type MenuEntry } from "../../components";
import { guard } from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useParmStore } from "../../store/parmStore";
import { formatParmValue, ParmPicker, type PickedParm } from "../links/ParmPicker";
import { ConfirmModal } from "./ConfirmModal";
import { useStructuralRevision } from "./useStructuralRevision";
import s from "./vars.module.css";

type DesignKind = "var" | "const";
type TransferKind = "des" | "xddm";

const TRANSFER: Record<TransferKind, { label: string; filters: FileFilter[] }> = {
  des: { label: ".des", filters: [{ name: "Design variables (.des)", extensions: ["des"] }] },
  xddm: { label: ".xddm", filters: [{ name: "XDDM (.xddm)", extensions: ["xddm"] }] },
};

const KIND_OPTIONS = [
  { value: "var", label: "Variable" },
  { value: "const", label: "Constant" },
];

function withExtension(path: string, ext: string): string {
  return new RegExp(`\\.${ext}$`, "i").test(path) ? path : `${path}.${ext}`;
}

function toast(kind: "success" | "info", message: string): void {
  useAppStore.getState().pushToast(kind, message);
}

export function DesignVarsPanel() {
  const rev = useStructuralRevision();
  const [vars, setVars] = useState<DesignVar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DesignKind>("var");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await vsp.varsDesignVars({ silent: true });
      if (id !== seq.current) return;
      setVars(res);
      setError(null);
    } catch (e: unknown) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load design variables");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, rev]);

  const add = (p: PickedParm) => {
    if (vars?.some((v) => v.parm.id === p.id)) {
      toast("info", `"${p.label || p.name}" is already a design variable.`);
      return;
    }
    guard(async () => {
      await vsp.varsAddDesignVar(p.id, kind);
      await load();
    });
  };

  const importFile = (type: TransferKind) =>
    guard(async () => {
      const path = await dialogs.open({ filters: TRANSFER[type].filters, title: `Import ${TRANSFER[type].label} file` });
      if (typeof path !== "string") return;
      if (type === "des") await vsp.varsReadDes(path);
      else await vsp.varsReadXddm(path);
      useParmStore.getState().reset();
      await load();
    });

  const exportFile = (type: TransferKind) =>
    guard(async () => {
      const chosen = await dialogs.save({
        filters: TRANSFER[type].filters,
        defaultPath: `design.${type}`,
        title: `Export ${TRANSFER[type].label} file`,
      });
      if (!chosen) return;
      const path = withExtension(chosen, type);
      if (type === "des") await vsp.varsWriteDes(path);
      else await vsp.varsWriteXddm(path);
      toast("success", `Exported design variables to ${path}`);
    });

  const transferItems: MenuEntry[] = [
    { id: "h-import", label: "Import", heading: true },
    { id: "import-des", label: "Design file (.des)", icon: <FileUp size={14} />, onSelect: () => importFile("des") },
    { id: "import-xddm", label: "XDDM file (.xddm)", icon: <FileUp size={14} />, onSelect: () => importFile("xddm") },
    "separator",
    { id: "h-export", label: "Export", heading: true },
    { id: "export-des", label: "Design file (.des)", icon: <FileDown size={14} />, onSelect: () => exportFile("des") },
    { id: "export-xddm", label: "XDDM file (.xddm)", icon: <FileDown size={14} />, onSelect: () => exportFile("xddm") },
  ];

  const count = vars?.length ?? 0;

  let body;
  if (error) {
    body = <EmptyState title="Could not load design variables" text={error} />;
  } else if (vars === null) {
    body = <p className={s.hint}>Loading design variables...</p>;
  } else if (vars.length === 0) {
    body = (
      <EmptyState
        title="No design variables"
        text="Add the parameters you want to vary, or import a .des or .xddm file."
      />
    );
  } else {
    body = (
      <div className={s.tableWrap}>
        <table className={s.table}>
          <caption className={s.srOnly}>Design variables</caption>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col" className={s.numHead}>
                Value
              </th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <DesignVarRow key={v.parm.id} dv={v} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={s.panel}>
      <div className={s.toolbar}>
        <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setPickerOpen(true)}>
          Add
        </Button>
        <Select
          value={kind}
          options={KIND_OPTIONS}
          onChange={(v) => setKind(v === "const" ? "const" : "var")}
          ariaLabel="Type for new design variables"
          title="Type given to parameters added with Add"
          className={s.kindSelect}
        />
        <Button
          size="sm"
          variant="secondary"
          icon={<Eraser size={13} />}
          disabled={count === 0}
          onClick={() => setConfirmClear(true)}
        >
          Clear all
        </Button>
        <DropdownMenu items={transferItems} align="end" ariaLabel="Import and export">
          <Button size="sm" variant="secondary" icon={<FileDown size={13} />}>
            Import / Export
          </Button>
        </DropdownMenu>
      </div>

      {body}

      <ParmPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a design variable"
        onPick={add}
      />

      <ConfirmModal
        open={confirmClear}
        title="Clear all design variables?"
        message={`This removes all ${count} design variable${count === 1 ? "" : "s"} from the list.`}
        confirmLabel="Clear all"
        onClose={() => setConfirmClear(false)}
        onConfirm={() =>
          guard(async () => {
            await vsp.varsClearDesignVars();
            await load();
          })
        }
      />
    </div>
  );
}

// ---------- row ----------

function DesignVarRow({ dv }: { dv: DesignVar }) {
  const live = useParmStore((st) => st.values[dv.parm.id]);
  const value = live ?? dv.parm.value;
  const parm: Parm = dv.parm;
  return (
    <tr>
      <th scope="row" className={s.nameCell} title={parm.descr || parm.name}>
        <span className={s.cellTitle}>{parm.label || parm.name}</span>
        <span className={s.cellMeta}>{parm.group}</span>
      </th>
      <td className={s.numCell}>
        {formatParmValue(value)}
        {parm.units ? <span className={s.unit}> {parm.units}</span> : null}
      </td>
      <td>
        <span className={dv.type === "var" ? s.badgeVar : s.badgeConst}>
          {dv.type === "var" ? "Variable" : "Constant"}
        </span>
      </td>
    </tr>
  );
}
