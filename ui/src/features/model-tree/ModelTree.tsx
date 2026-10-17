import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight, Copy, Eye, EyeOff, Pencil, Scissors, ClipboardPaste, Trash2, Grid3x3 } from "lucide-react";
import type { GeomNode, Id } from "../../api/types";
import { ContextMenu, IconButton, type MenuEntry } from "../../components";
import { cx } from "../../components/cx";
import * as act from "../../layout/actions";
import { useAppStore } from "../../store/appStore";
import { useModelStore } from "../../store/modelStore";
import { useUiStore } from "../../store/uiStore";
import { geomIcon } from "./geomIcons";
import s from "./ModelTree.module.css";

interface Row {
  geom: GeomNode;
  depth: number;
  hasChildren: boolean;
}

/** Flatten the pre-order geom list into visible rows, honouring collapsed nodes. */
export function buildRows(geoms: GeomNode[], collapsed: Set<Id>): Row[] {
  const depth = new Map<Id, number>();
  const hidden = new Set<Id>();
  const rows: Row[] = [];
  for (const g of geoms) {
    const p = g.parentId;
    if (p !== null && (hidden.has(p) || collapsed.has(p))) {
      hidden.add(g.id);
      continue;
    }
    const d = p === null ? 0 : (depth.get(p) ?? 0) + 1;
    depth.set(g.id, d);
    rows.push({ geom: g, depth: d, hasChildren: g.children.length > 0 });
  }
  return rows;
}

function isWithinSubtree(
  target: Id | null,
  ancestor: Id,
  byId: Map<Id, GeomNode>,
): boolean {
  let cur: Id | null = target;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/** The Model sidebar tab: geom tree with visibility, rename, context menu and drag-to-reparent. */
export function ModelTree() {
  const geoms = useModelStore((st) => st.model?.geoms ?? null);
  const selectedId = useModelStore((st) => st.selectedGeomId);
  const engineRunning = useAppStore((st) => st.engine === "running");
  const [collapsed, setCollapsed] = useState<Set<Id>>(() => new Set());
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [dragId, setDragId] = useState<Id | null>(null);
  const [dropTarget, setDropTarget] = useState<Id | "root" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: Id } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => (geoms ? buildRows(geoms, collapsed) : []), [geoms, collapsed]);
  const byId = useMemo(() => new Map((geoms ?? []).map((g) => [g.id, g])), [geoms]);

  // Keep the selected row visible.
  useEffect(() => {
    if (!selectedId || !treeRef.current) return;
    const el = treeRef.current.querySelector<HTMLElement>(`[data-geom-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Drop renaming if the geom disappeared.
  useEffect(() => {
    if (renaming && !byId.has(renaming)) setRenaming(null);
  }, [renaming, byId]);

  const toggleCollapsed = (id: Id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const select = (id: Id | null) => useModelStore.getState().setSelected(id);

  const canDrop = (target: Id | null): boolean => {
    if (!dragId) return false;
    if (target === dragId) return false;
    if (target !== null && isWithinSubtree(target, dragId, byId)) return false;
    const current = byId.get(dragId)?.parentId ?? null;
    return current !== target;
  };

  const commitRename = (id: Id, value: string) => {
    setRenaming(null);
    const current = byId.get(id)?.name ?? "";
    if (value.trim() && value.trim() !== current) act.guard(() => act.renameGeom(id, value));
  };

  const menuItems = (id: Id): MenuEntry[] => {
    const g = byId.get(id);
    const shown = g?.shown ?? true;
    return [
      { id: "rename", label: "Rename", icon: <Pencil size={14} />, shortcut: "F2", onSelect: () => setRenaming(id) },
      "separator",
      {
        id: "copy",
        label: "Copy",
        icon: <Copy size={14} />,
        shortcut: "Ctrl+C",
        onSelect: () => {
          select(id);
          act.guard(() => act.copySelected());
        },
      },
      {
        id: "cut",
        label: "Cut",
        icon: <Scissors size={14} />,
        shortcut: "Ctrl+X",
        onSelect: () => {
          select(id);
          act.guard(() => act.cutSelected());
        },
      },
      {
        id: "paste-child",
        label: "Paste as Child",
        icon: <ClipboardPaste size={14} />,
        shortcut: "Ctrl+V",
        onSelect: () => {
          select(id);
          act.guard(() => act.pasteGeom(true));
        },
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 size={14} />,
        shortcut: "Delete",
        danger: true,
        onSelect: () => {
          select(id);
          act.guard(() => act.deleteSelected());
        },
      },
      "separator",
      {
        id: "xsec",
        label: "Edit Cross-Sections",
        icon: <Grid3x3 size={14} />,
        onSelect: () => {
          select(id);
          useUiStore.getState().openXsecPanel();
        },
      },
      {
        id: "visibility",
        label: shown ? "Hide" : "Show",
        icon: shown ? <EyeOff size={14} /> : <Eye size={14} />,
        onSelect: () => act.guard(() => act.setGeomShown([id], !shown)),
      },
    ];
  };

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, index: number, row: Row) => {
    if (renaming === row.geom.id) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const next = rows[index + (e.key === "ArrowDown" ? 1 : -1)];
        if (next) {
          select(next.geom.id);
          treeRef.current?.querySelector<HTMLElement>(`[data-geom-id="${CSS.escape(next.geom.id)}"]`)?.focus();
        }
        break;
      }
      case "ArrowRight":
        if (row.hasChildren && collapsed.has(row.geom.id)) {
          e.preventDefault();
          toggleCollapsed(row.geom.id);
        }
        break;
      case "ArrowLeft":
        if (row.hasChildren && !collapsed.has(row.geom.id)) {
          e.preventDefault();
          toggleCollapsed(row.geom.id);
        }
        break;
      case "F2":
        e.preventDefault();
        setRenaming(row.geom.id);
        break;
      case "Enter":
        e.preventDefault();
        useUiStore.getState().openXsecPanel();
        break;
      default:
        break;
    }
  };

  // ----- drag and drop -----

  const onDragStart = (e: DragEvent<HTMLDivElement>, id: Id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const onRowDragOver = (e: DragEvent<HTMLDivElement>, id: Id) => {
    if (!canDrop(id)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(id);
  };

  const onRowDrop = (e: DragEvent<HTMLDivElement>, id: Id) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragId;
    setDragId(null);
    setDropTarget(null);
    if (d && canDrop(id)) act.guard(() => act.reparentGeom(d, id));
  };

  const onTreeDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dragId || !canDrop(null)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget("root");
  };

  const onTreeDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const d = dragId;
    setDragId(null);
    setDropTarget(null);
    if (d && canDrop(null)) act.guard(() => act.reparentGeom(d, null));
  };

  const onTreeDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget((t) => (t === "root" ? null : t));
  };

  if (!geoms) {
    return (
      <div className={s.tree} role="status" aria-label="Loading model">
        {engineRunning ? "Loading model..." : "Connecting to engine..."}
      </div>
    );
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Components"
      className={cx(s.tree, dropTarget === "root" && s.treeDropRoot)}
      onDragOver={onTreeDragOver}
      onDrop={onTreeDrop}
      onDragLeave={onTreeDragLeave}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) select(null);
      }}
    >
      {rows.map((row, index) => {
        const { geom: g } = row;
        const selected = g.id === selectedId;
        const Icon = geomIcon(g.type);
        const isCollapsed = collapsed.has(g.id);
        return (
          <div
            key={g.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={selected}
            aria-expanded={row.hasChildren ? !isCollapsed : undefined}
            aria-label={g.name}
            tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
            data-geom-id={g.id}
            data-hidden={!g.shown}
            data-drop={dropTarget === g.id ? "into" : undefined}
            draggable={renaming !== g.id}
            className={s.row}
            style={{ paddingLeft: 6 + row.depth * 16 }}
            onClick={(e) => {
              e.stopPropagation();
              select(g.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(g.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              select(g.id);
              setMenu({ x: e.clientX, y: e.clientY, id: g.id });
            }}
            onKeyDown={(e) => onRowKey(e, index, row)}
            onDragStart={(e) => onDragStart(e, g.id)}
            onDragEnd={onDragEnd}
            onDragOver={(e) => onRowDragOver(e, g.id)}
            onDrop={(e) => onRowDrop(e, g.id)}
          >
            {row.hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                className={s.twisty}
                data-open={!isCollapsed}
                aria-label={isCollapsed ? `Expand ${g.name}` : `Collapse ${g.name}`}
                title={isCollapsed ? "Expand" : "Collapse"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(g.id);
                }}
              >
                <ChevronRight size={12} />
              </button>
            ) : (
              <span className={s.twistySpacer} aria-hidden="true" />
            )}
            <Icon size={15} className={s.icon} aria-hidden="true" />
            {renaming === g.id ? (
              <input
                className={s.renameInput}
                autoFocus
                aria-label={`Rename ${g.name}`}
                defaultValue={g.name}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(g.id, e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setRenaming(null);
                  }
                  e.stopPropagation();
                }}
                onBlur={(e) => commitRename(g.id, e.currentTarget.value)}
              />
            ) : (
              <span className={s.name}>{g.name}</span>
            )}
            {renaming !== g.id && (
              <IconButton
                className={s.eye}
                icon={g.shown ? <Eye size={14} /> : <EyeOff size={14} />}
                label={`${g.shown ? "Hide" : "Show"} ${g.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  act.guard(() => act.setGeomShown([g.id], !g.shown));
                }}
              />
            )}
          </div>
        );
      })}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Component actions"
          items={menuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
