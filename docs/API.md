# Engine RPC contract (source of truth for engine ↔ UI)

## Transport
Newline-delimited JSON, one message per line, UTF-8.
- Request (client → engine): `{"id": 7, "method": "geom.add", "params": {...}}`
- Response: `{"id": 7, "result": <any>}` or `{"id": 7, "error": {"code": int, "message": str, "traceback": str|null}}`
- Event (engine → client, no id): `{"event": "<name>", "data": {...}}`

Events:
| event | data |
|---|---|
| `ready` | `{version}`: sent once at startup |
| `log` | `{level: "info"\|"warn"\|"error", text}`: engine log lines (also used for captured VSPAERO output in ws mode) |
| `model_changed` | `{method}`: after any mutating call; UI refetches `model.state` |
| `job_progress` | `{jobId, text}` |
| `job_done` | `{jobId, result?, error?}` |

Methods flagged **long** return `{"jobId": str}` immediately; the real result arrives in `job_done`.
Methods flagged **mut** create an undo snapshot. They accept an optional `coalesceKey` param: consecutive calls with the same key share one snapshot. Use it when a slider is dragged (`coalesceKey = parmId + gestureStartTime`).

Stdio mode: `python engine/vsp_engine.py`. WebSocket mode: `python engine/vsp_engine.py --ws 8765` (endpoint `ws://127.0.0.1:8765/ws`, same JSON messages, one per WS text frame).

Binary arrays are base64-encoded little-endian typed arrays (`f32` = Float32Array, `u32` = Uint32Array).

## Shared types
```ts
type Id = string;                       // OpenVSP string ids
type Parm = {
  id: Id; name: string; group: string;  // group = OpenVSP group name e.g. "XForm"
  label: string;                         // friendly label (parmmeta) else name
  value: number;
  type: "double"|"int"|"bool"|"fraction"|"limited_int"|"power_int"|"noteq"|"other";
  min: number; max: number;              // limits clamped to ±1e12
  descr: string;
  units?: string;
  options?: {value: number; label: string}[];   // enum-like ints
  bitmask?: boolean;                     // options are OR-able flags (e.g. Sym_Planar_Flag)
  advanced?: boolean;                    // parmmeta: hide under "All parameters"
};
type ParmGroup = { group: string; label: string; parms: Parm[] };
type GeomNode = { id: Id; name: string; type: string; parentId: Id|null; children: Id[];
                  shown: boolean; numXSecSurfs: number; color: [number,number,number] };  // color 0..1
type ModelState = { file: string|null; dirty: boolean; geoms: GeomNode[];  // pre-order (tree) order
                    canUndo: boolean; canRedo: boolean };
type ParmSetResult = { parm: Parm; changed: {id: Id; value: number}[]; dirtyGeoms: Id[] };
```

## app.* (engine/api/app.py)
- `app.info` → `{version, vspRoot, geomTypes: string[], analyses: {name, group: "Geometry"|"Aero"|"Mesh"|"Other"}[], xsecShapes: {value, name}[], importFormats: {value, name, ext}[], exportFormats: {value, name, ext}[], examples: {name, path}[]}`. `examples` = *.vsp3 under `<root>/vspaero_ex` and `<root>/airfoil` (recursive).
- `app.ping` → `"pong"`
- `app.fileDialog {mode: "open"|"save", title?, filters?: {name, extensions}[], multiple?, defaultPath?}` → `string | string[] | null` (native tkinter dialog on the engine host; used by the UI in browser mode, where `window.prompt` is unavailable)

## model.* (engine/api/model.py)
- `model.state` → ModelState
- `model.new` **mut** → ModelState (clears undo history)
- `model.open {path}` → ModelState (clears undo history)
- `model.save {path?}` → `{path}` (path omitted → current file; RpcError if none)
- `model.insert {path, parentId?}` **mut** → ModelState
- `model.undo` / `model.redo` → ModelState
- `model.autosave` → `{path}`: writes `%TEMP%/openvsp_studio_autosave.vsp3`
- `geom.add {type, parentId?, name?}` **mut** → `{id, state: ModelState}`
- `geom.delete {ids}` **mut** → ModelState
- `geom.copy {ids}` → null · `geom.cut {ids}` **mut** → ModelState · `geom.paste {parentId?}` **mut** → `{ids, state}`
- `geom.rename {id, name}` **mut** → ModelState
- `geom.reparent {id, parentId|null}` **mut** → ModelState
- `geom.setShown {ids, shown}` **mut** → ModelState
- `geom.setColor {id, color:[r,g,b]}` **mut** → ModelState
- `geom.parms {id}` → `ParmGroup[]` (all geom parms; groups ordered by parmmeta tab order, XSec-related groups excluded since the XSec editor shows them)

## parms.* (engine/api/parms.py, engine/parmmeta.py)
- `parms.list {containerId}` → `ParmGroup[]` (any container: geom, vehicle, settings, fea part, xsec...)
- `parms.get {ids}` → `Parm[]`
- `parms.set {id, value}` **mut** → ParmSetResult. `changed` = other parms in the same container whose value changed. `dirtyGeoms` = owning geom + descendants, or all geoms when the owner isn't a geom (or is a xsec's geom: resolve to that geom)
- `parms.containers` → `{id, name}[]` (FindContainers)
- `parms.search {query, limit=200}` → `{parm: Parm, containerId, containerName}[]` (case-insensitive over name/label/group/container name)

## mesh.* (engine/api/mesh.py)
- `mesh.get {ids?}` (omit → all shown geoms) → `{meshes: {geomId, surfaces: {positions: b64 f32 (xyz), normals: b64 f32, indices: b64 u32, wire: b64 u32 (line-segment index pairs along u and w grid lines)}[], bbox: {min:[x,y,z], max:[x,y,z]}}[]}`. Built from GetTotalNumSurfs/GetUWTess01/CompVecPnt01; normals by finite differences or CompVecNorm01 if available.
- `mesh.xsecRing {geomId, surf, index, n=96}` → `{points: [x,y,z][]}` global coords of that cross-section curve (closed).

## xsec.* (engine/api/xsec.py): the Cross-Section Editor
- `xsec.surfaces {geomId}` → `{index, numXSecs}[]`
- `xsec.list {geomId, surf}` → `{index, id, shape: number, shapeName, width, height, thumb: [u,v][] (48 pts, local 2D)}[]`
- `xsec.get {geomId, surf, index}` → `{id, shape, shapeName, width, height, profile: [u,v][] (200 pts, local 2D: u=horizontal/width dir, v=vertical/height dir, centered on the outline's box; for edit curves the frame is pinned so control point 0 sits at `points[0]·(width,height)`, so outline and points always agree), neighbors: {prev?: [u,v][], next?: [u,v][]}, groups: ParmGroup[] (shape, position, skinning, planform/sect, airfoil modifiers…), editCurve?: {points: [u,v][] (unit-scaled: divide by width/height), symmetric: number (SymType: 0 none, 1 R/L, 2 T/B, 3 all), curveType: number (0 linear, 1 PCHIP, 2 cubic Bezier: anchor, handle, handle, anchor…), closed: boolean}, isAirfoil: boolean}`
- `xsec.insert {geomId, surf, index, shape?}` **mut** → inserts after `index`; returns `{index: newIndex}`
- `xsec.delete|cut {geomId, surf, index}` **mut** → null; `xsec.copy {…}` → null; `xsec.paste {geomId, surf, index}` **mut** → null
- `xsec.setShape {geomId, surf, index, shape}` **mut** → xsec.get payload
- `xsec.setEditCurve {geomId, surf, index, points: [u,v][]}` **mut** → xsec.get payload. Unit-scaled points. Same count: only changed points move (MoveEditXSecPnt, symmetry kept). Different count: SetEditXSecPnts with uniform u and symmetry off.
- `xsec.convertToEditCurve {geomId, surf, index}` **mut** → xsec.get payload. Shape is kept: fuselage-type shapes via ChangeXSecShape; airfoils (which ChangeXSecShape would reset) are refit as a 24-anchor cubic through clustered samples (error < 0.3% of thickness).
- `xsec.splitEditCurve {geomId, surf, index, u}` **mut** → xsec.get payload. Adds an anchor at curve parameter u (0..1, same parameter as `profile` sampling) without changing the shape (EditXSecSplit01; retried at mirrored u on symmetric curves). No-op if u is already an anchor.
- `xsec.deleteEditPoint {geomId, surf, index, point}` **mut** → xsec.get payload. Cubic curves: anchors only (i % 3 == 0), removed with their handles; error for handles or < 3 anchors. Turns symmetry off.
- `xsec.setEditSymmetry {geomId, surf, index, mirrorX, mirrorY}` **mut** → xsec.get payload (SymType bits: mirrorX=1, mirrorY=2)
- `xsec.loadAirfoil {geomId, surf, index, path}` **mut** → xsec.get payload (file airfoil shape + ReadFileAirfoil; fuselage → ReadFileXSec)
- `xsec.layout {geomId, surf}` → `{kind: "fuselage"|"stack"|"wing"|"prop"|"other", axisLabel, viewLabel, canInsert, stations: {index, pos, lo, hi: number|null, fixed, top, bottom}[]}` (engine/api/xsec_layout.py). `pos` is the place along the component: fuselage XLocPercent·Length, stack running XDelta, wing running Span (root 0), prop RadiusFrac. `top`/`bottom` are the outline extent across the map (bodies: global Z; wings/props: global X, leading edge = bottom).
- `xsec.moveTo {geomId, surf, index, pos, coalesceKey?}` **mut** → layout. Clamped between the neighbours; later sections keep their positions (stack/wing adjust the next offset). Error for fixed sections.
- `xsec.insertAt {geomId, surf, pos}` **mut** → `{index, layout}`. New section between neighbours (bodies: size/offset blended; wings: the segment is split with chord and twist interpolated, planform unchanged), or past the tip for stacks and wings.
- `xsec.airfoilLibrary` → `{name, path}[]` (files under `<root>/airfoil`, .dat/.af)

## analysis.* & results.* (engine/api/analysis.py)
- `analysis.list` → `{name, group}[]`
- `analysis.inputs {name}` → `{name, type: "int"|"double"|"string"|"vec3d", value: any[], label, options?}[]`
- `analysis.setInput {name, input, value: any[]}` → null (type looked up)
- `analysis.reset {name}` → null (SetAnalysisInputDefaults)
- `analysis.run {name}` **long** → `{resultId, summary: {name, value}[]}` (summary: up to 20 scalar entries)
- `results.list` → `{id, name}[]`
- `results.get {id}` → `{id, name, data: {name, type: "int"|"double"|"string"|"vec3d"|"double_mat", value: any, doc?}[]}`
- `results.exportCsv {id, path}` → null · `results.clear` → null

## io.* (engine/api/io.py)
- `io.import {path, format}` **mut** → ModelState
- `io.export {path, format, set=0}` → `{path}`
- `io.exportOptions {format}` → `ParmGroup[]` (relevant settings container parms, may be empty)

## sets.* (engine/api/sets.py)
- `sets.list` → `{index, name}[]` · `sets.rename {index, name}` **mut**
- `sets.matrix` → `{sets: {index,name}[], rows: {geomId, name, flags: boolean[]}[]}`
- `sets.setFlag {geomId, index, value}` **mut** · `sets.show|hide|showOnly {index}` **mut**

## vars.* (engine/api/vars.py)
- Presets: `vars.presets` → `{groups: {id, name, settings: {id,name}[], parms: Parm[]}[]}`; `vars.addGroup {name}` **mut**, `vars.addSetting {groupId, name}` **mut**, `vars.addParm {groupId, parmId}` **mut**, `vars.applySetting {settingId}` **mut**, `vars.saveSetting {settingId}` **mut** (store current values), `vars.deleteGroup|deleteSetting|deleteParm`
- Design vars: `vars.designVars` → `{parm: Parm, type: "var"|"const"}[]`; `vars.addDesignVar {parmId, type}` **mut**; `vars.clearDesignVars` **mut**; `vars.writeDes {path}`; `vars.readDes {path}` **mut**; `vars.writeXddm {path}`; `vars.readXddm {path}` **mut**
- User parms: `vars.userParms` → `Parm[]`; `vars.addUserParm {type:"double"|"int", name, group}` **mut** → Parm

## links.* (engine/api/links.py)
- `links.list` → `{index, name}[]`
- `links.get {index}` → `{index, name, code, inputs: {var, parm: Parm}[], outputs: {var, parm: Parm}[]}`
- `links.add {name}` **mut** · `links.delete {index}` **mut** · `links.rename {index, name}` **mut**
- `links.setCode {index, code}` **mut** · `links.addInput|addOutput {index, parmId, var}` **mut** · `links.removeInput|removeOutput {index, var}` **mut**
- `links.build {index}` → `{ok: boolean, message}`

## fea.* (engine/api/fea.py)
- `fea.tree` → `{structs: {id, name, geomId, parts: {id, name, type}[], subsurfs: {id, name, type}[]}[], materials: {id, name}[], properties: {id, name}[]}`
- `fea.partTypes` → `{value, name}[]`; `fea.subsurfTypes` → `{value, name}[]`
- `fea.addStruct {geomId, surf=0}` **mut** · `fea.addPart {structId, type}` **mut** · `fea.addSubSurf {structId, type}` **mut** · `fea.addMaterial` **mut** · `fea.addProperty {type}` **mut** · `fea.delete {id}` **mut** · `fea.rename {id, name}` **mut** → each returns `fea.tree` payload
- Item parms via `parms.list {containerId: id}`; meshing via `analysis.run {name: "FeaMeshAnalysis"}`

## subsurf.* & measure.* (engine/api/subsurf.py)
- `subsurf.types` → `{value, name}[]`; `subsurf.list {geomId}` → `{id, name, type}[]`; `subsurf.add {geomId, type, surf=0}` **mut**; `subsurf.delete {geomId, id}` **mut**
- `controlGroups.list` → `{index, name}[]`; `controlGroups.autoGroup` **mut**
- `measure.list` → `{rulers: {id,name}[], probes: {id,name}[]}`; `measure.addRuler {geomA, geomB}` **mut**; `measure.addProbe {geomId}` **mut**; `measure.delete {id}` **mut** (params of each via parms.list)

## console.* (engine/api/console.py)
- `console.exec {code}` **mut** → `{stdout, result: string|null, error: string|null}`. Persistent namespace with `vsp` pre-imported; Python stdout captured.
- `console.runScript {path}` → `{output, code}`: runs `<root>/vspscript.exe -script path` as a subprocess.

## overlay.* (engine/api/overlay.py): analysis overlays in the 3D view
Coordinates are global XYZ (Z-up). Items are drawn over the model by the UI.
- `overlay.get {analysis, resultId?}` → `{analysis, title?, items: OverlayItem[], legend?: {label, min, max, colormap: "cool-warm"}, note?}`. Never raises for unknown analyses: they return `items: []` and a `note`. Built from files and results: VSPAEROSweep/VSPAEROSinglePoint read `<base>.lod` (last case: load strips, lift arrows, a spanwise lift curve per vortex sheet, and a free-stream arrow); MassProp gives a `CG` marker (`Total_CG`) and smaller markers for each component (`Comp_CG`); CpSlicer draws each cut's Cp curve (`<base>.slc`) offset along the in-plane normal. CompGeom, VSPAEROComputeGeometry and others return a note only. `base` = the saved model's path without extension.
- `overlay.prepare {analysis}` → `{base}`: called by the UI right before a run starts, so `overlay.progress` knows where the files will appear. Not concurrent.
- `overlay.progress {analysis}` → `{analysis, iteration, caseIndex, rows: {Case?, Iter, CLtot, CDtot, "L2 Residual"}[] (last 50), strips?: StripsItem}`. **Concurrent**: answered by the server while a long job holds the OpenVSP worker. Reads files only (no `vsp` calls). `strips` is present once a `.lod` newer than `overlay.prepare` exists.

OverlayItem kinds:
| kind | fields |
|---|---|
| `strips` | `quads: [x,y,z]×4[]`, `values: number[]` (VSPAERO: one quad per strip, value = Cl) |
| `arrows` | `origins`, `vectors`, `values?`, `color?: "accent"\|"green"\|"danger"` |
| `polyline` | `points`, `color?`, `closed?` |
| `marker` | `position`, `label`, `color?`, `size?: "small"\|"normal"` |
| `label` | `position`, `text` |

Concurrent methods (`@method(..., concurrent=True)`) run on a side thread pool in the server and are not queued behind the FIFO worker. They must not touch `vsp`.
