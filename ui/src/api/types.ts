// Types mirroring docs/API.md. The engine is the source of truth; keep these in sync.

export type Id = string;
export type Vec3 = [number, number, number];
export type UV = [number, number];

// ---------- Shared ----------

export type ParmType =
  | "double"
  | "int"
  | "bool"
  | "fraction"
  | "limited_int"
  | "power_int"
  | "noteq"
  | "other";

export interface ParmOption {
  value: number;
  label: string;
}

export interface Parm {
  id: Id;
  name: string;
  group: string;
  label: string;
  value: number;
  type: ParmType;
  min: number;
  max: number;
  descr: string;
  units?: string;
  options?: ParmOption[];
  bitmask?: boolean;
  advanced?: boolean;
}

export interface ParmGroup {
  group: string;
  label: string;
  parms: Parm[];
}

export interface GeomNode {
  id: Id;
  name: string;
  type: string;
  parentId: Id | null;
  children: Id[];
  shown: boolean;
  numXSecSurfs: number;
  /** 0..1 */
  color: Vec3;
}

export interface ModelState {
  file: string | null;
  dirty: boolean;
  /** Pre-order (tree) order. */
  geoms: GeomNode[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface ParmSetResult {
  parm: Parm;
  changed: { id: Id; value: number }[];
  dirtyGeoms: Id[];
}

export interface NamedId {
  id: Id;
  name: string;
}

export interface FormatInfo {
  value: number | string;
  name: string;
  ext: string;
}

export type AnalysisGroup = "Geometry" | "Aero" | "Mesh" | "Other";

export interface AnalysisInfo {
  name: string;
  group: AnalysisGroup;
}

export interface AppInfo {
  version: string;
  vspRoot: string;
  geomTypes: string[];
  analyses: AnalysisInfo[];
  xsecShapes: { value: number; name: string }[];
  importFormats: FormatInfo[];
  exportFormats: FormatInfo[];
  examples: { name: string; path: string }[];
}

// ---------- model / parms ----------

export interface ModelOpenResult {
  path: string;
}

export interface GeomAddResult {
  id: Id;
  state: ModelState;
}

export interface GeomPasteResult {
  ids: Id[];
  state: ModelState;
}

export interface ParmSearchHit {
  parm: Parm;
  containerId: Id;
  containerName: string;
}

export interface ContainerInfo {
  id: Id;
  name: string;
}

// ---------- mesh ----------

/** Raw wire form: base64 little-endian typed arrays. */
export interface SurfaceMeshRaw {
  positions: string;
  normals: string;
  indices: string;
  wire: string;
}

export interface GeomMeshRaw {
  geomId: Id;
  surfaces: SurfaceMeshRaw[];
  bbox: { min: Vec3; max: Vec3 };
}

export interface MeshGetResult {
  meshes: GeomMeshRaw[];
}

export interface SurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  wire: Uint32Array;
}

export interface GeomMesh {
  geomId: Id;
  surfaces: SurfaceMesh[];
  bbox: { min: Vec3; max: Vec3 };
}

export interface MeshXsecRingResult {
  points: Vec3[];
}

// ---------- xsec ----------

export interface XsecRef {
  geomId: Id;
  surf: number;
  index: number;
}

export interface XsecSurfaceInfo {
  index: number;
  numXSecs: number;
}

export interface XsecListItem {
  index: number;
  id: Id;
  shape: number;
  shapeName: string;
  width: number;
  height: number;
  /** 48 pts, local 2D. */
  thumb: UV[];
}

export interface XsecEditCurve {
  points: UV[];
  /** SymType: 0 none, 1 left/right (mirror X), 2 top/bottom (mirror Y), 3 both. */
  symmetric: number;
  /** 0 linear, 1 PCHIP, 2 cubic Bezier (anchor, handle, handle, anchor, ...). */
  curveType: number;
  closed: boolean;
}

export interface XsecGetResult {
  id: Id;
  shape: number;
  shapeName: string;
  width: number;
  height: number;
  /** 200 pts, local 2D, centered. */
  profile: UV[];
  neighbors: { prev?: UV[]; next?: UV[] };
  groups: ParmGroup[];
  editCurve?: XsecEditCurve;
  isAirfoil: boolean;
}

export interface AirfoilLibraryItem {
  name: string;
  path: string;
}

// ---------- analysis / results ----------

export interface AnalysisListItem {
  name: string;
  group: AnalysisGroup;
}

export type AnalysisInputType = "int" | "double" | "string" | "vec3d";

export interface AnalysisInput {
  name: string;
  type: AnalysisInputType;
  value: unknown[];
  label: string;
  options?: { value: number | string; label: string }[];
}

/** Result of analysis.run (delivered as job_done.result). */
export interface AnalysisRunResult {
  resultId: string;
  summary: { name: string; value: unknown }[];
}

export interface ResultListItem {
  id: string;
  name: string;
}

export type ResultDatumType = "int" | "double" | "string" | "vec3d" | "double_mat";

export interface ResultDatum {
  name: string;
  type: ResultDatumType;
  value: unknown;
  doc?: string;
}

export interface ResultGetResult {
  id: string;
  name: string;
  data: ResultDatum[];
}

// ---------- io ----------

export interface IoExportResult {
  path: string;
}

// ---------- sets ----------

export interface SetListItem {
  index: number;
  name: string;
}

export interface SetsMatrix {
  sets: SetListItem[];
  rows: { geomId: Id; name: string; flags: boolean[] }[];
}

// ---------- vars ----------

export interface PresetSetting {
  id: Id;
  name: string;
}

export interface PresetGroup {
  id: Id;
  name: string;
  settings: PresetSetting[];
  parms: Parm[];
}

export interface VarsPresets {
  groups: PresetGroup[];
}

export interface DesignVar {
  parm: Parm;
  type: "var" | "const";
}

// ---------- links ----------

export interface LinkListItem {
  index: number;
  name: string;
}

export interface LinkIO {
  var: string;
  parm: Parm;
}

export interface LinkGetResult {
  index: number;
  name: string;
  code: string;
  inputs: LinkIO[];
  outputs: LinkIO[];
}

export interface LinkBuildResult {
  ok: boolean;
  message: string;
}

// ---------- fea ----------

export interface TypedItem {
  id: Id;
  name: string;
  type: number;
}

export interface FeaStruct {
  id: Id;
  name: string;
  geomId: Id;
  parts: TypedItem[];
  subsurfs: TypedItem[];
}

export interface FeaTree {
  structs: FeaStruct[];
  materials: NamedId[];
  properties: NamedId[];
}

export interface TypeOption {
  value: number;
  name: string;
}

// ---------- subsurf / measure / control groups ----------

export interface SubsurfListItem {
  id: Id;
  name: string;
  type: number;
}

export interface ControlGroupItem {
  index: number;
  name: string;
}

export interface MeasureList {
  rulers: NamedId[];
  probes: NamedId[];
}

// ---------- console ----------

export interface ConsoleExecResult {
  stdout: string;
  result: string | null;
  error: string | null;
}

export interface ConsoleRunScriptResult {
  output: string;
  code: number;
}

// ---------- settings ----------

export type Theme = "system" | "light" | "dark";
export type Density = "compact" | "comfortable";

export interface Settings {
  python: string;
  openvspRoot: string;
  theme: Theme;
  density: Density;
  recentFiles: string[];
}

// ---------- transport ----------

export interface RpcErrorPayload {
  code: number;
  message: string;
  traceback: string | null;
}

export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  text: string;
}

export interface EngineStatus {
  running: boolean;
  code?: number;
}

export type EngineEvent =
  | { event: "ready"; data: { version: string } }
  | { event: "log"; data: LogEvent }
  | { event: "model_changed"; data: { method: string } }
  | { event: "job_progress"; data: { jobId: string; text: string } }
  | { event: "job_done"; data: { jobId: string; result?: unknown; error?: RpcErrorPayload | string } }
  | { event: string; data: unknown };

export interface FileFilter {
  name: string;
  extensions: string[];
}

// ----- analysis overlays (engine/api/overlay.py) -----

/** Named colour role; the viewport maps it to a theme token. */
export type OverlayColor = "accent" | "green" | "danger";

export type OverlayItem =
  | { kind: "strips"; quads: Vec3[][]; values: number[] }
  | { kind: "arrows"; origins: Vec3[]; vectors: Vec3[]; values?: number[]; color?: OverlayColor }
  | { kind: "polyline"; points: Vec3[]; color?: OverlayColor; closed?: boolean }
  | { kind: "marker"; position: Vec3; label: string; color?: OverlayColor; size?: "small" | "normal" }
  | { kind: "label"; position: Vec3; text: string };

export interface OverlayLegend {
  label: string;
  min: number;
  max: number;
  colormap: "cool-warm";
}

export interface OverlayData {
  analysis: string;
  title?: string;
  items: OverlayItem[];
  legend?: OverlayLegend;
  /** Why nothing (or less than expected) is drawn, e.g. "Run VSPAERO to see loads." */
  note?: string;
}

export interface OverlayProgressRow {
  Case?: number;
  Iter?: number;
  CLtot?: number;
  CDtot?: number;
  "L2 Residual"?: number;
}

export interface OverlayProgress {
  analysis: string;
  iteration: number;
  caseIndex: number;
  rows: OverlayProgressRow[];
  strips?: Extract<OverlayItem, { kind: "strips" }>;
}

/** A section's place along its component (xsec.layout). */
export interface XsecStation {
  index: number;
  /** Position along the component axis (length, span or radius fraction). */
  pos: number;
  /** Allowed move range: the neighbours (hi null = open past the tip). */
  lo: number;
  hi: number | null;
  fixed: boolean;
  /** Outline extent across the map (side view: Z; planform: chord X). */
  top: number;
  bottom: number;
}

export interface XsecLayout {
  kind: "fuselage" | "stack" | "wing" | "prop" | "other";
  axisLabel: string;
  viewLabel: string;
  canInsert: boolean;
  stations: XsecStation[];
}
