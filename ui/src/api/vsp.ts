// Typed wrappers, one per method in docs/API.md.
// Methods whose return shape API.md does not specify are typed `unknown`.

import { call, runJob, type CallOptions } from "./client";
import type {
  AirfoilLibraryItem,
  AnalysisInput,
  AnalysisListItem,
  AnalysisRunResult,
  AppInfo,
  ConsoleExecResult,
  ConsoleRunScriptResult,
  ContainerInfo,
  ControlGroupItem,
  DesignVar,
  FeaTree,
  GeomAddResult,
  GeomPasteResult,
  IoExportResult,
  LinkBuildResult,
  LinkGetResult,
  LinkListItem,
  MeasureList,
  MeshGetResult,
  MeshXsecRingResult,
  OverlayData,
  OverlayProgress,
  ModelOpenResult,
  ModelState,
  Parm,
  ParmGroup,
  ParmSearchHit,
  ParmSetResult,
  PresetGroup,
  ResultGetResult,
  ResultListItem,
  SetListItem,
  SetsMatrix,
  SubsurfListItem,
  TypeOption,
  VarsPresets,
  XsecGetResult,
  XsecLayout,
  XsecListItem,
  XsecRef,
  XsecSurfaceInfo,
  Vec3,
  UV,
  Id,
} from "./types";

type Opts = CallOptions;
type Params = Record<string, unknown>;

const c = <T = unknown>(method: string, params?: Params, opts?: Opts) => call<T>(method, params, opts);
const job = <T = unknown>(method: string, params?: Params, opts?: Opts) => runJob<T>(method, params, opts);

export const vsp = {
  // ----- app -----
  appInfo: (opts?: Opts) => c<AppInfo>("app.info", undefined, opts),
  appPing: (opts?: Opts) => c<"pong">("app.ping", undefined, opts),

  // ----- model -----
  modelState: (opts?: Opts) => c<ModelState>("model.state", undefined, opts),
  modelNew: () => c<ModelState>("model.new"),
  modelOpen: (path: string) => c<ModelState>("model.open", { path }),
  modelSave: (path?: string) => c<ModelOpenResult>("model.save", path ? { path } : {}),
  modelInsert: (path: string, parentId?: Id) =>
    c<ModelState>("model.insert", parentId ? { path, parentId } : { path }),
  modelUndo: () => c<ModelState>("model.undo"),
  modelRedo: () => c<ModelState>("model.redo"),
  modelAutosave: () => c<ModelOpenResult>("model.autosave"),

  // ----- geom -----
  geomAdd: (type: string, parentId?: Id, name?: string) =>
    c<GeomAddResult>("geom.add", { type, ...(parentId ? { parentId } : {}), ...(name ? { name } : {}) }),
  geomDelete: (ids: Id[]) => c<ModelState>("geom.delete", { ids }),
  geomCopy: (ids: Id[]) => c<null>("geom.copy", { ids }),
  geomCut: (ids: Id[]) => c<ModelState>("geom.cut", { ids }),
  geomPaste: (parentId?: Id) => c<GeomPasteResult>("geom.paste", parentId ? { parentId } : {}),
  geomRename: (id: Id, name: string) => c<ModelState>("geom.rename", { id, name }),
  geomReparent: (id: Id, parentId: Id | null) => c<ModelState>("geom.reparent", { id, parentId }),
  geomSetShown: (ids: Id[], shown: boolean) => c<ModelState>("geom.setShown", { ids, shown }),
  geomSetColor: (id: Id, color: Vec3, coalesceKey?: string) =>
    c<ModelState>("geom.setColor", { id, color, ...(coalesceKey ? { coalesceKey } : {}) }),
  geomParms: (id: Id, opts?: Opts) => c<ParmGroup[]>("geom.parms", { id }, opts),

  // ----- parms -----
  parmsList: (containerId: Id, opts?: Opts) => c<ParmGroup[]>("parms.list", { containerId }, opts),
  parmsGet: (ids: Id[], opts?: Opts) => c<Parm[]>("parms.get", { ids }, opts),
  parmsSet: (id: Id, value: number, coalesceKey?: string) =>
    c<ParmSetResult>("parms.set", { id, value, ...(coalesceKey ? { coalesceKey } : {}) }, { silent: false }),
  parmsContainers: (opts?: Opts) => c<ContainerInfo[]>("parms.containers", undefined, opts),
  parmsSearch: (query: string, limit = 200, opts?: Opts) =>
    c<ParmSearchHit[]>("parms.search", { query, limit }, opts),

  // ----- mesh -----
  meshGet: (ids?: Id[], opts?: Opts) =>
    c<MeshGetResult>("mesh.get", ids ? { ids } : {}, opts),
  meshXsecRing: (geomId: Id, surf: number, index: number, n = 96, opts?: Opts) =>
    c<MeshXsecRingResult>("mesh.xsecRing", { geomId, surf, index, n }, opts),

  // ----- xsec -----
  xsecSurfaces: (geomId: Id, opts?: Opts) => c<XsecSurfaceInfo[]>("xsec.surfaces", { geomId }, opts),
  xsecList: (geomId: Id, surf: number, opts?: Opts) => c<XsecListItem[]>("xsec.list", { geomId, surf }, opts),
  xsecLayout: (geomId: Id, surf: number, opts?: Opts) => c<XsecLayout>("xsec.layout", { geomId, surf }, opts),
  xsecMoveTo: (geomId: Id, surf: number, index: number, pos: number, coalesceKey?: string) =>
    c<XsecLayout>("xsec.moveTo", { geomId, surf, index, pos, ...(coalesceKey ? { coalesceKey } : {}) }),
  xsecInsertAt: (geomId: Id, surf: number, pos: number) =>
    c<{ index: number; layout: XsecLayout }>("xsec.insertAt", { geomId, surf, pos }),
  xsecGet: (geomId: Id, surf: number, index: number, opts?: Opts) =>
    c<XsecGetResult>("xsec.get", { geomId, surf, index }, opts),
  xsecInsert: (geomId: Id, surf: number, index: number, shape?: number) =>
    c<{ index: number }>("xsec.insert", { geomId, surf, index, ...(shape !== undefined ? { shape } : {}) }),
  xsecDelete: (ref: XsecRef) => c<null>("xsec.delete", { ...ref }),
  xsecCut: (ref: XsecRef) => c<null>("xsec.cut", { ...ref }),
  xsecCopy: (ref: XsecRef) => c<null>("xsec.copy", { ...ref }),
  xsecPaste: (ref: XsecRef) => c<null>("xsec.paste", { ...ref }),
  xsecSetShape: (ref: XsecRef, shape: number) => c<XsecGetResult>("xsec.setShape", { ...ref, shape }),
  xsecSetEditCurve: (ref: XsecRef, points: UV[], coalesceKey?: string) =>
    c<XsecGetResult>("xsec.setEditCurve", { ...ref, points, ...(coalesceKey ? { coalesceKey } : {}) }),
  xsecConvertToEditCurve: (ref: XsecRef) => c<XsecGetResult>("xsec.convertToEditCurve", { ...ref }),
  /** Add a point at curve parameter u (0..1) without changing the shape (OpenVSP split). */
  xsecSplitEditCurve: (ref: XsecRef, u: number) => c<XsecGetResult>("xsec.splitEditCurve", { ...ref, u }),
  /** Delete point `point`; on cubic curves only anchors (index % 3 == 0) can be deleted. */
  xsecDeleteEditPoint: (ref: XsecRef, point: number) => c<XsecGetResult>("xsec.deleteEditPoint", { ...ref, point }),
  xsecSetEditSymmetry: (ref: XsecRef, mirrorX: boolean, mirrorY: boolean) =>
    c<XsecGetResult>("xsec.setEditSymmetry", { ...ref, mirrorX, mirrorY }),
  xsecLoadAirfoil: (ref: XsecRef, path: string) => c<XsecGetResult>("xsec.loadAirfoil", { ...ref, path }),
  xsecAirfoilLibrary: (opts?: Opts) => c<AirfoilLibraryItem[]>("xsec.airfoilLibrary", undefined, opts),

  // ----- analysis / results -----
  analysisList: (opts?: Opts) => c<AnalysisListItem[]>("analysis.list", undefined, opts),
  analysisInputs: (name: string, opts?: Opts) => c<AnalysisInput[]>("analysis.inputs", { name }, opts),
  analysisSetInput: (name: string, input: string, value: unknown[]) =>
    c<null>("analysis.setInput", { name, input, value }),
  analysisReset: (name: string) => c<null>("analysis.reset", { name }),
  /** Long method: returns {jobId}; prefer analysisRunJob. */
  analysisRun: (name: string) => c<{ jobId: string }>("analysis.run", { name }),
  analysisRunJob: (name: string) => job<AnalysisRunResult>("analysis.run", { name }),
  /** Analysis overlay for the viewport. Silent: an analysis without an overlay is not an error. */
  overlayGet: (analysis: string, resultId?: string, opts?: Opts) =>
    c<OverlayData>("overlay.get", { analysis, ...(resultId ? { resultId } : {}) }, opts ?? { silent: true }),
  /** Call right before a run starts so overlay.progress knows where the files will appear. */
  overlayPrepare: (analysis: string) => c<{ base: string }>("overlay.prepare", { analysis }, { silent: true }),
  /** Live state of a running analysis, answered while the engine is busy with the job. */
  overlayProgress: (analysis: string) => c<OverlayProgress>("overlay.progress", { analysis }, { silent: true }),
  resultsList: (opts?: Opts) => c<ResultListItem[]>("results.list", undefined, opts),
  resultsGet: (id: string, opts?: Opts) => c<ResultGetResult>("results.get", { id }, opts),
  resultsExportCsv: (id: string, path: string) => c<null>("results.exportCsv", { id, path }),
  resultsClear: () => c<null>("results.clear"),

  // ----- io -----
  ioImport: (path: string, format: number | string) => c<ModelState>("io.import", { path, format }),
  ioExport: (path: string, format: number | string, set = 0) =>
    c<IoExportResult>("io.export", { path, format, set }),
  ioExportOptions: (format: number | string, opts?: Opts) =>
    c<ParmGroup[]>("io.exportOptions", { format }, opts),

  // ----- sets -----
  setsList: (opts?: Opts) => c<SetListItem[]>("sets.list", undefined, opts),
  setsRename: (index: number, name: string) => c<unknown>("sets.rename", { index, name }),
  setsMatrix: (opts?: Opts) => c<SetsMatrix>("sets.matrix", undefined, opts),
  setsSetFlag: (geomId: Id, index: number, value: boolean) =>
    c<unknown>("sets.setFlag", { geomId, index, value }),
  setsShow: (index: number) => c<unknown>("sets.show", { index }),
  setsHide: (index: number) => c<unknown>("sets.hide", { index }),
  setsShowOnly: (index: number) => c<unknown>("sets.showOnly", { index }),

  // ----- vars -----
  varsPresets: (opts?: Opts) => c<VarsPresets>("vars.presets", undefined, opts),
  varsAddGroup: (name: string) => c<PresetGroup>("vars.addGroup", { name }),
  varsAddSetting: (groupId: Id, name: string) => c<unknown>("vars.addSetting", { groupId, name }),
  varsAddParm: (groupId: Id, parmId: Id) => c<unknown>("vars.addParm", { groupId, parmId }),
  varsApplySetting: (settingId: Id) => c<unknown>("vars.applySetting", { settingId }),
  varsSaveSetting: (settingId: Id) => c<unknown>("vars.saveSetting", { settingId }),
  varsDeleteGroup: (groupId: Id) => c<unknown>("vars.deleteGroup", { groupId }),
  varsDeleteSetting: (settingId: Id) => c<unknown>("vars.deleteSetting", { settingId }),
  varsDeleteParm: (groupId: Id, parmId: Id) => c<unknown>("vars.deleteParm", { groupId, parmId }),
  varsDesignVars: (opts?: Opts) => c<DesignVar[]>("vars.designVars", undefined, opts),
  varsAddDesignVar: (parmId: Id, type: "var" | "const") => c<unknown>("vars.addDesignVar", { parmId, type }),
  varsClearDesignVars: () => c<unknown>("vars.clearDesignVars"),
  varsWriteDes: (path: string) => c<unknown>("vars.writeDes", { path }),
  varsReadDes: (path: string) => c<unknown>("vars.readDes", { path }),
  varsWriteXddm: (path: string) => c<unknown>("vars.writeXddm", { path }),
  varsReadXddm: (path: string) => c<unknown>("vars.readXddm", { path }),
  varsUserParms: (opts?: Opts) => c<Parm[]>("vars.userParms", undefined, opts),
  varsAddUserParm: (type: "double" | "int", name: string, group: string) =>
    c<Parm>("vars.addUserParm", { type, name, group }),

  // ----- links -----
  linksList: (opts?: Opts) => c<LinkListItem[]>("links.list", undefined, opts),
  linksGet: (index: number, opts?: Opts) => c<LinkGetResult>("links.get", { index }, opts),
  linksAdd: (name: string) => c<unknown>("links.add", { name }),
  linksDelete: (index: number) => c<unknown>("links.delete", { index }),
  linksRename: (index: number, name: string) => c<unknown>("links.rename", { index, name }),
  linksSetCode: (index: number, code: string) => c<unknown>("links.setCode", { index, code }),
  linksAddInput: (index: number, parmId: Id, variable: string) =>
    c<unknown>("links.addInput", { index, parmId, var: variable }),
  linksAddOutput: (index: number, parmId: Id, variable: string) =>
    c<unknown>("links.addOutput", { index, parmId, var: variable }),
  linksRemoveInput: (index: number, variable: string) => c<unknown>("links.removeInput", { index, var: variable }),
  linksRemoveOutput: (index: number, variable: string) =>
    c<unknown>("links.removeOutput", { index, var: variable }),
  linksBuild: (index: number) => c<LinkBuildResult>("links.build", { index }),

  // ----- fea -----
  feaTree: (opts?: Opts) => c<FeaTree>("fea.tree", undefined, opts),
  feaPartTypes: (opts?: Opts) => c<TypeOption[]>("fea.partTypes", undefined, opts),
  feaSubsurfTypes: (opts?: Opts) => c<TypeOption[]>("fea.subsurfTypes", undefined, opts),
  feaAddStruct: (geomId: Id, surf = 0) => c<FeaTree>("fea.addStruct", { geomId, surf }),
  feaAddPart: (structId: Id, type: number) => c<FeaTree>("fea.addPart", { structId, type }),
  feaAddSubSurf: (structId: Id, type: number) => c<FeaTree>("fea.addSubSurf", { structId, type }),
  feaAddMaterial: () => c<FeaTree>("fea.addMaterial"),
  feaAddProperty: (type: number) => c<FeaTree>("fea.addProperty", { type }),
  feaDelete: (id: Id) => c<FeaTree>("fea.delete", { id }),
  feaRename: (id: Id, name: string) => c<FeaTree>("fea.rename", { id, name }),

  // ----- subsurf / measure / control groups -----
  subsurfTypes: (opts?: Opts) => c<TypeOption[]>("subsurf.types", undefined, opts),
  subsurfList: (geomId: Id, opts?: Opts) => c<SubsurfListItem[]>("subsurf.list", { geomId }, opts),
  subsurfAdd: (geomId: Id, type: number, surf = 0) => c<unknown>("subsurf.add", { geomId, type, surf }),
  subsurfDelete: (geomId: Id, id: Id) => c<unknown>("subsurf.delete", { geomId, id }),
  controlGroupsList: (opts?: Opts) => c<ControlGroupItem[]>("controlGroups.list", undefined, opts),
  controlGroupsAutoGroup: () => c<unknown>("controlGroups.autoGroup"),
  measureList: (opts?: Opts) => c<MeasureList>("measure.list", undefined, opts),
  measureAddRuler: (geomA: Id, geomB: Id) => c<unknown>("measure.addRuler", { geomA, geomB }),
  measureAddProbe: (geomId: Id) => c<unknown>("measure.addProbe", { geomId }),
  measureDelete: (id: Id) => c<unknown>("measure.delete", { id }),

  // ----- console -----
  consoleExec: (code: string) => c<ConsoleExecResult>("console.exec", { code }),
  consoleRunScript: (path: string) => c<ConsoleRunScriptResult>("console.runScript", { path }),
};
