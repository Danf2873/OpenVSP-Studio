// Static presentation data for analyses. Names come from the engine (analysis.list);
// anything not listed here falls back to a generic description.

import type { AnalysisGroup } from "../../api/types";

export const GROUP_ORDER: AnalysisGroup[] = ["Geometry", "Aero", "Mesh", "Other"];

/** One-line, plain-language description per engine analysis name. */
export const ANALYSIS_DESCRIPTIONS: Record<string, string> = {
  CompGeom: "Wetted area and volume",
  MassProp: "Mass, CG and inertia",
  DegenGeom: "Degenerate (panel-style) geometry",
  GeometryAnalysis: "Geometry measurements and reports",
  PlanarSlice: "Planar slices through the geometry",
  Projection: "Project geometry onto a plane",
  SurfacePatches: "Surface patch layout",
  BladeElement: "Propeller blade-element analysis",
  CpSlicer: "Pressure coefficient slices",
  EmintonLord: "Empirical aero estimate (Eminton-Lord)",
  ParasiteDrag: "Component build-up parasite drag",
  WaveDrag: "Supersonic wave drag",
  VSPAERODegenGeom: "Degenerate geometry for VSPAERO",
  VSPAEROComputeGeometry: "Prepare geometry for VSPAERO (run first)",
  VSPAEROSinglePoint: "VSPAERO solution at one condition",
  VSPAEROSweep: "VSPAERO sweep over alpha, beta or Mach",
  VSPAEROReadPreviousAnalysis: "Load an earlier VSPAERO solution",
  DegenGeomMesh: "Mesh of the degenerate geometry",
  FeaMeshAnalysis: "Finite-element mesh",
  CfdMeshAnalysis: "CFD surface and volume mesh",
  FeaMeshExport: "Export the finite-element mesh",
  SurfaceIntersection: "Surface intersection curves",
};

export function describeAnalysis(name: string): string {
  return ANALYSIS_DESCRIPTIONS[name] ?? "OpenVSP analysis";
}

/** Inputs shown above the "Advanced inputs" disclosure, in this order of appearance. */
export const COMMON_INPUTS: string[] = [
  "Set",
  "GeomSet",
  "DegenSet",
  "ThinGeomSet",
  "CGGeomSet",
  "CGDegenSet",
  "AlphaStart",
  "AlphaEnd",
  "AlphaNpts",
  "BetaStart",
  "BetaEnd",
  "BetaNpts",
  "MachStart",
  "MachEnd",
  "MachNpts",
  "ReCref",
  "ReCrefEnd",
  "ReCrefNpts",
  "Vinf",
  "Rho",
  "Sref",
  "bref",
  "cref",
  "NCPU",
  "HalfMeshFlag",
  "WriteCSVFlag",
];

/** Analyses that need a geometry-preparation analysis to have run first. */
export const PREP_ANALYSIS: Record<string, string> = {
  VSPAEROSweep: "VSPAEROComputeGeometry",
  VSPAEROSinglePoint: "VSPAEROComputeGeometry",
};
