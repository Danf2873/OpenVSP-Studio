// On-screen view navigation for pointers without a middle button: a 3x3
// pan pad (center = Fit), zoom in/out, and orbit left/right. Holding a
// button repeats its step. Commands go to CameraRig through viewNav.

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { IconButton, Tooltip } from "../../components";
import { useUiStore } from "../../store/uiStore";
import { sendNav } from "./viewNav";
import s from "./Viewport.module.css";

const HOLD_DELAY_MS = 350;
const HOLD_REPEAT_MS = 70;

type Step = (smooth: boolean) => void;

interface HoldButtonProps {
  label: string;
  icon: ReactNode;
  onStep: Step;
}

/** Fires once on press; keeps firing while held. Keyboard activation fires once. */
function HoldButton({ label, icon, onStep }: HoldButtonProps) {
  const timers = useRef<{ delay: number | null; repeat: number | null }>({ delay: null, repeat: null });

  const stop = () => {
    if (timers.current.delay !== null) window.clearTimeout(timers.current.delay);
    if (timers.current.repeat !== null) window.clearInterval(timers.current.repeat);
    timers.current = { delay: null, repeat: null };
  };

  useEffect(() => stop, []);

  const start = () => {
    stop();
    onStep(true);
    timers.current.delay = window.setTimeout(() => {
      timers.current.delay = null;
      timers.current.repeat = window.setInterval(() => onStep(false), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        title=""
        icon={icon}
        className={s.navBtn}
        onPointerDown={(e) => {
          if (e.button === 0) start();
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={(e) => {
          // detail === 0: activated from the keyboard, so there was no press.
          if (e.detail === 0) onStep(true);
        }}
      />
    </Tooltip>
  );
}

const pan = (dir: "up" | "down" | "left" | "right"): Step => (smooth) => sendNav({ kind: "pan", dir, smooth });
const zoom = (dir: "in" | "out"): Step => (smooth) => sendNav({ kind: "zoom", dir, smooth });
const orbit = (dir: "left" | "right"): Step => (smooth) => sendNav({ kind: "orbit", dir, smooth });

export function ViewNavPad() {
  const sendView = useUiStore((st) => st.sendView);

  return (
    <div className={s.nav} role="group" aria-label="View navigation">
      <div className={s.navPad}>
        <span />
        <HoldButton label="Pan up" icon={<ArrowUp size={15} />} onStep={pan("up")} />
        <span />
        <HoldButton label="Pan left" icon={<ArrowLeft size={15} />} onStep={pan("left")} />
        <Tooltip content="Fit all visible components (F)">
          <IconButton
            label="Fit view"
            title=""
            icon={<Maximize2 size={14} />}
            className={s.navBtn}
            onClick={() => sendView("fit")}
          />
        </Tooltip>
        <HoldButton label="Pan right" icon={<ArrowRight size={15} />} onStep={pan("right")} />
        <span />
        <HoldButton label="Pan down" icon={<ArrowDown size={15} />} onStep={pan("down")} />
        <span />
      </div>
      <div className={s.navSide}>
        <HoldButton label="Zoom in" icon={<Plus size={15} />} onStep={zoom("in")} />
        <HoldButton label="Zoom out" icon={<Minus size={15} />} onStep={zoom("out")} />
        <HoldButton label="Orbit left" icon={<RotateCcw size={14} />} onStep={orbit("left")} />
        <HoldButton label="Orbit right" icon={<RotateCw size={14} />} onStep={orbit("right")} />
      </div>
    </div>
  );
}
