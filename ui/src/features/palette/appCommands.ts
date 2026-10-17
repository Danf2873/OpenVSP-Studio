// Commands generated from engine metadata (app.info): geom types, analyses,
// import/export formats and examples. Registered once appInfo is loaded.

import type { AppInfo } from "../../api/types";
import * as act from "../../layout/actions";
import { registerCommands, type Command } from "./commands";

/** "MS_WING" -> "Ms wing"; "WING" -> "Wing". */
export function prettyName(raw: string): string {
  const lower = raw.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function buildAppCommands(info: AppInfo): Command[] {
  const out: Command[] = [];

  for (const type of info.geomTypes) {
    out.push({
      id: `add:${type}`,
      title: `Add ${prettyName(type)}`,
      section: "Add",
      keywords: `create new component ${type}`,
      run: () => act.addGeom(type),
    });
  }

  for (const a of info.analyses) {
    out.push({
      id: `analysis:${a.name}`,
      title: `Run ${a.name}…`,
      section: "Analysis",
      keywords: `${a.group} analysis`,
      run: () => act.focusAnalysis(a.name),
    });
  }

  for (const f of info.importFormats) {
    out.push({
      id: `import:${f.name}`,
      title: `Import ${f.name}…`,
      section: "Import",
      keywords: f.ext,
      run: () => act.importFormat(f),
    });
  }

  for (const f of info.exportFormats) {
    out.push({
      id: `export:${f.name}`,
      title: `Export ${f.name}…`,
      section: "Export",
      keywords: f.ext,
      run: () => act.exportFormat(f),
    });
  }

  return out;
}

/** Register the metadata-driven commands. Returns the disposer. */
export function registerAppCommands(info: AppInfo): () => void {
  return registerCommands(buildAppCommands(info));
}
