import { Box, Circle, Cylinder, Fan, Layers, Plane, Rocket, Square, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  WING: Plane,
  MS_WING: Plane,
  FUSELAGE: Rocket,
  POD: Cylinder,
  PROP: Fan,
  STACK: Layers,
  BLANK: Square,
  HINGE: Circle,
};

/** Icon for a geom type string from app.info.geomTypes. Falls back to a box. */
export function geomIcon(type: string): LucideIcon {
  return ICONS[type.toUpperCase()] ?? Box;
}
