// Scene content: one group per shown geom (shaded and/or wire), plus the
// selected cross-section ring. Geometry buffers are built from the decoded
// mesh cache and disposed when the mesh is replaced.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import type { GeomMesh, GeomNode, SurfaceMesh, Vec3 } from "../../api/types";
import { vsp } from "../../api/vsp";
import { useModelStore } from "../../store/modelStore";
import type { DisplayMode } from "../../store/uiStore";
import type { ThemeColors } from "./useThemeColors";
import { registerPreviewGroup } from "./xformPreview";

const BLACK = new THREE.Color(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

function buildSolid(s: SurfaceMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(s.positions, 3));
  if (s.normals.length === s.positions.length) {
    g.setAttribute("normal", new THREE.BufferAttribute(s.normals, 3));
  } else {
    g.computeVertexNormals();
  }
  g.setIndex(new THREE.BufferAttribute(s.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function buildWire(s: SurfaceMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(s.positions, 3));
  g.setIndex(new THREE.BufferAttribute(s.wire, 1));
  g.computeBoundingSphere();
  return g;
}

interface GeomSurfacesProps {
  geom: GeomNode;
  mesh: GeomMesh;
  mode: DisplayMode;
  selected: boolean;
  colors: ThemeColors;
}

function GeomSurfaces({ geom, mesh, mode, selected, colors }: GeomSurfacesProps) {
  const [r, g, b] = geom.color;

  // Slightly lightened so thin parts read against the background.
  const tint = useMemo(() => {
    const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    return c.lerp(WHITE, 0.15);
  }, [r, g, b]);

  const solids = useMemo(() => mesh.surfaces.map(buildSolid), [mesh]);
  const wires = useMemo(() => mesh.surfaces.map(buildWire), [mesh]);

  useEffect(
    () => () => {
      solids.forEach((x) => x.dispose());
      wires.forEach((x) => x.dispose());
    },
    [solids, wires],
  );

  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useModelStore.getState().setSelected(geom.id);
  };

  // The transform gizmo previews drags by moving/scaling this group.
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    registerPreviewGroup(geom.id, groupRef.current);
    return () => registerPreviewGroup(geom.id, null);
  }, [geom.id]);

  return (
    <group ref={groupRef}>
      {mode !== "wire" &&
        solids.map((geo, i) => (
          <mesh key={`s${i}`} geometry={geo} onClick={pick}>
            <meshStandardMaterial
              color={tint}
              metalness={0.1}
              roughness={0.6}
              side={THREE.DoubleSide}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              emissive={selected ? colors.accent : BLACK}
              emissiveIntensity={selected ? 0.3 : 0}
            />
          </mesh>
        ))}
      {mode !== "shaded" &&
        wires.map((geo, i) => (
          <lineSegments key={`w${i}`} geometry={geo}>
            <lineBasicMaterial
              color={selected ? colors.accent : mode === "wire" ? tint : colors.wire}
              transparent
              opacity={mode === "wire" ? 0.9 : 0.3}
            />
          </lineSegments>
        ))}
    </group>
  );
}

/** Every shown geom that has a cached mesh. */
export function SceneGeoms({ mode, colors }: { mode: DisplayMode; colors: ThemeColors }) {
  const geoms = useModelStore((st) => st.model?.geoms);
  const meshes = useModelStore((st) => st.meshes);
  const selectedId = useModelStore((st) => st.selectedGeomId);

  return (
    <>
      {(geoms ?? [])
        .filter((g) => g.shown)
        .map((g) => {
          const mesh = meshes[g.id];
          if (!mesh) return null;
          return (
            <GeomSurfaces
              key={g.id}
              geom={g}
              mesh={mesh}
              mode={mode}
              selected={g.id === selectedId}
              colors={colors}
            />
          );
        })}
    </>
  );
}

/** Accent-green ring for the selected cross-section. */
export function XsecRing({ colors }: { colors: ThemeColors }) {
  const ref = useModelStore((st) => st.selectedXsec);
  const rev = useModelStore((st) => st.lastChange.seq);
  const [points, setPoints] = useState<Vec3[] | null>(null);

  const geomId = ref?.geomId;
  const surf = ref?.surf;
  const index = ref?.index;

  useEffect(() => {
    if (geomId === undefined || surf === undefined || index === undefined) {
      setPoints(null);
      return;
    }
    let alive = true;
    vsp
      .meshXsecRing(geomId, surf, index, 96, { silent: true })
      .then((res) => {
        if (alive) setPoints(res.points);
      })
      .catch(() => {
        if (alive) setPoints(null);
      });
    return () => {
      alive = false;
    };
  }, [geomId, surf, index, rev]);

  if (!points || points.length < 2) return null;
  return <Line points={points} color={colors.accentGreen} lineWidth={2} />;
}
