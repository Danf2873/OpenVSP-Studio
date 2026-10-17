// Three.js colors read from the CSS tokens, so the 3D scene follows the theme.
// Re-reads when <html> data-theme / data-density change or the OS scheme flips.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

export interface ThemeColors {
  accent: THREE.Color;
  accentGreen: THREE.Color;
  danger: THREE.Color;
  wire: THREE.Color;
  gridCell: THREE.Color;
  gridSection: THREE.Color;
}

function parseToken(name: string): THREE.Color {
  const col = new THREE.Color();
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (raw) {
    try {
      col.setStyle(raw, THREE.SRGBColorSpace);
    } catch {
      // unparseable token; keep the default
    }
  }
  return col;
}

export function useThemeColors(): ThemeColors {
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-density"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);

  return useMemo(
    () => ({
      accent: parseToken("--accent-blue"),
      accentGreen: parseToken("--accent-green"),
      danger: parseToken("--danger"),
      wire: parseToken("--text-label"),
      gridCell: parseToken("--bg-tertiary"),
      gridSection: parseToken("--text-secondary"),
    }),
    // rev is the invalidation signal; the body reads the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rev],
  );
}
