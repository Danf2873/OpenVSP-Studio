// Camera control: Z-up, animated standard views and fit, first auto-fit,
// and the on-screen navigation pad / arrow keys (pan, zoom, orbit).

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useModelStore } from "../../store/modelStore";
import { useUiStore, type ViewKind } from "../../store/uiStore";
import { subscribeNav, type NavCommand } from "./viewNav";

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

type StandardView = Exclude<ViewKind, "fit">;

// OpenVSP: X is the nose direction, Y spans the wing, Z is up.
// Directions are from the target toward the camera; the tiny offsets keep
// lookAt well-defined for the top view (Z is also the up vector).
const VIEW_DIRS: Record<StandardView, THREE.Vector3> = {
  front: new THREE.Vector3(1, 0, 0.0001).normalize(),
  top: new THREE.Vector3(0.0001, 0.0001, 1).normalize(),
  side: new THREE.Vector3(0, -1, 0.0001).normalize(),
  iso: new THREE.Vector3(0.6, -0.8, 0.5).normalize(),
};

const UP_AXIS = new THREE.Vector3(0, 0, 1);
const TWEEN_MS = 300;
const NAV_TAP_MS = 220;
const NAV_HOLD_MS = 90;
const PAN_FRACTION = 0.1;
const ZOOM_IN = 0.8;
const ZOOM_OUT = 1.25;
const ORBIT_STEP_DEG = 15;
const MIN_DIST = 0.05;
const MAX_DIST = 1e5;

/** Center and radius of every shown mesh, or null when nothing is shown. */
function sceneBounds(): { center: THREE.Vector3; radius: number } | null {
  const st = useModelStore.getState();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let any = false;
  for (const g of st.model?.geoms ?? []) {
    if (!g.shown) continue;
    const m = st.meshes[g.id];
    if (!m) continue;
    any = true;
    min.min(new THREE.Vector3(...m.bbox.min));
    max.max(new THREE.Vector3(...m.bbox.max));
  }
  if (!any) return null;
  const center = min.clone().add(max).multiplyScalar(0.5);
  const radius = Math.max(max.clone().sub(min).length() * 0.5, 1e-3);
  return { center, radius };
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Tween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t0: number;
  ms: number;
}

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const tween = useRef<Tween | null>(null);
  const autoFitted = useRef(false);
  const viewCmd = useUiStore((s) => s.viewCommand);
  const meshRev = useModelStore((s) => s.meshRevision);

  useEffect(() => {
    camera.up.set(0, 0, 1);
    camera.updateProjectionMatrix();
  }, [camera]);

  /** Move camera and target to the given pose, tweened over ms (instant if 0 or reduced motion). */
  const animateTo = (toPos: THREE.Vector3, toTarget: THREE.Vector3, ms: number) => {
    if (!controls) return;
    if (ms <= 0 || reducedMotion()) {
      tween.current = null;
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      return;
    }
    tween.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget: toTarget.clone(),
      t0: performance.now(),
      ms,
    };
  };

  const goTo = (dir: THREE.Vector3, distance: number, target: THREE.Vector3) => {
    const toPos = target.clone().add(dir.clone().normalize().multiplyScalar(distance));
    animateTo(toPos, target, TWEEN_MS);
  };

  const fit = (dir?: THREE.Vector3) => {
    const b = sceneBounds();
    if (!b || !controls) return;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const distance = (b.radius / Math.sin(fovRad / 2)) * 1.15;
    const viewDir =
      dir ?? (camera.position.clone().sub(controls.target).lengthSq() > 1e-9
        ? camera.position.clone().sub(controls.target)
        : VIEW_DIRS.iso.clone());
    goTo(viewDir, distance, b.center);
  };

  /** Apply one navigation step: pan the view, zoom toward the target, or orbit about Z. */
  const nav = (cmd: NavCommand) => {
    if (!controls) return;
    const pos = camera.position.clone();
    const target = controls.target.clone();
    const offset = pos.clone().sub(target);
    const dist = Math.max(offset.length(), 1e-6);
    const ms = cmd.smooth ? NAV_TAP_MS : NAV_HOLD_MS;
    let toPos = pos.clone();
    let toTarget = target.clone();

    if (cmd.kind === "pan") {
      const forward = offset.clone().negate().normalize();
      const right = forward.clone().cross(camera.up).normalize();
      const upScreen = right.clone().cross(forward).normalize();
      const visibleHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const step = visibleHeight * PAN_FRACTION;
      const dirVec =
        cmd.dir === "right" ? right
        : cmd.dir === "left" ? right.clone().negate()
        : cmd.dir === "up" ? upScreen
        : upScreen.clone().negate();
      const delta = dirVec.multiplyScalar(step);
      toPos.add(delta);
      toTarget.add(delta);
    } else if (cmd.kind === "zoom") {
      const nd = THREE.MathUtils.clamp(dist * (cmd.dir === "in" ? ZOOM_IN : ZOOM_OUT), MIN_DIST, MAX_DIST);
      toPos = target.clone().add(offset.normalize().multiplyScalar(nd));
    } else {
      const sign = cmd.dir === "left" ? 1 : -1;
      const o = offset.clone().applyAxisAngle(UP_AXIS, THREE.MathUtils.degToRad(ORBIT_STEP_DEG) * sign);
      toPos = target.clone().add(o);
    }
    animateTo(toPos, toTarget, ms);
  };

  // Subscribe once; the ref always points at the handler from the latest render.
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => subscribeNav((cmd) => navRef.current(cmd)), []);

  // Toolbar / shortcut commands.
  useEffect(() => {
    if (viewCmd.seq === 0) return;
    if (viewCmd.kind === "fit") fit();
    else fit(VIEW_DIRS[viewCmd.kind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCmd.seq]);

  // One automatic fit when the first meshes arrive.
  useEffect(() => {
    if (autoFitted.current || !controls) return;
    if (!sceneBounds()) return;
    autoFitted.current = true;
    fit(VIEW_DIRS.iso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshRev, controls]);

  useFrame(() => {
    const tw = tween.current;
    if (!tw || !controls) return;
    const t = Math.min(1, (performance.now() - tw.t0) / tw.ms);
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    controls.update();
    if (t >= 1) tween.current = null;
  });

  return null;
}
