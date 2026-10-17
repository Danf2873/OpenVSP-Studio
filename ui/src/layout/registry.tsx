// Panel registries. To plug in a real panel, replace the component for its id
// (or import one from your feature folder) here and nowhere else.
//
//   sidebarTabs: left sidebar icon rail (Model, Analyses, Sets, ...)
//   dockTabs:    bottom dock (Results, Console, Parameters). The cross-section
//                editor is a left panel, see AppShell and uiStore.xsecPanelOpen.

import type { ComponentType, FC, LazyExoticComponent } from "react";
import {
  Activity,
  Box,
  Layers,
  Link as LinkIcon,
  Network,
  Search,
  SlidersHorizontal,
  Table,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { ModelPane } from "../features/model-tree/ModelPane";
import { ConsoleView } from "../features/console/ConsoleView";
import { AnalysesPane } from "../features/analyses/AnalysesPane";
import { ResultsPane } from "../features/results/ResultsPane";
import { SetsPane } from "../features/sets/SetsPane";
import { VariablesPane } from "../features/vars/VariablesPane";
import { LinksPane } from "../features/links/LinksPane";
import { StructuresPane } from "../features/fea/StructuresPane";
import { ParamExplorer } from "../features/param-explorer/ParamExplorer";
import type { DockTabId, SidebarTabId } from "../store/uiStore";

export interface SidebarTabDef {
  id: SidebarTabId;
  label: string;
  icon: LucideIcon;
  component: LazyExoticComponent<ComponentType> | FC;
}

export interface DockTabDef {
  id: DockTabId;
  label: string;
  icon: LucideIcon;
  component: LazyExoticComponent<ComponentType> | FC;
}

export const sidebarTabs: SidebarTabDef[] = [
  { id: "model", label: "Model", icon: Box, component: ModelPane },
  {
    id: "analyses",
    label: "Analyses",
    icon: Activity,
    component: AnalysesPane,
  },
  {
    id: "sets",
    label: "Sets",
    icon: Layers,
    component: SetsPane,
  },
  {
    id: "vars",
    label: "Variables",
    icon: SlidersHorizontal,
    component: VariablesPane,
  },
  {
    id: "links",
    label: "Links",
    icon: LinkIcon,
    component: LinksPane,
  },
  {
    id: "fea",
    label: "Structures",
    icon: Network,
    component: StructuresPane,
  },
];

export const dockTabs: DockTabDef[] = [
  {
    id: "results",
    label: "Results",
    icon: Table,
    component: ResultsPane,
  },
  { id: "console", label: "Console", icon: Terminal, component: ConsoleView },
  {
    id: "params",
    label: "Parameters",
    icon: Search,
    component: ParamExplorer,
  },
];
