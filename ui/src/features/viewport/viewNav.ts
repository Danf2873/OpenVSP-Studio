// Tiny command bus between the on-screen navigation pad (DOM, outside the
// Canvas) and CameraRig (inside it). CameraRig applies each command to the
// camera and orbit target.

export type NavCommand =
  | { kind: "pan"; dir: "up" | "down" | "left" | "right"; smooth: boolean }
  | { kind: "zoom"; dir: "in" | "out"; smooth: boolean }
  | { kind: "orbit"; dir: "left" | "right"; smooth: boolean };

type NavListener = (cmd: NavCommand) => void;

const listeners = new Set<NavListener>();

export function subscribeNav(listener: NavListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `smooth` animates the step; held-key repeats pass false for snappy stepping. */
export function sendNav(cmd: NavCommand): void {
  for (const l of listeners) l(cmd);
}
