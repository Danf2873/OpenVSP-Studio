// Bumps when the model changed structurally (not for plain parm edits, which
// the parm store already reflects). Panels refetch their lists on each bump.

import { useEffect, useRef, useState } from "react";
import { useModelStore } from "../../store/modelStore";

export function useStructuralRevision(): number {
  const lastChange = useModelStore((st) => st.lastChange);
  const [rev, setRev] = useState(0);
  const seen = useRef(lastChange.seq);
  useEffect(() => {
    if (lastChange.seq === seen.current) return;
    seen.current = lastChange.seq;
    if (!lastChange.parmsOnly) setRev((r) => r + 1);
  }, [lastChange]);
  return rev;
}
