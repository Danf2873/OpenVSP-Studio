import { useEffect } from "react";
import { X } from "lucide-react";
import { useAppStore, type Toast } from "../store/appStore";
import s from "./ui.module.css";
import { IconButton } from "./Button";

const AUTO_MS: Record<Toast["kind"], number> = { info: 4000, success: 3000, error: 9000 };

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((st) => st.dismissToast);

  useEffect(() => {
    const t = window.setTimeout(() => dismiss(toast.id), AUTO_MS[toast.kind]);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.kind, dismiss]);

  return (
    <div className={s.toast} data-kind={toast.kind} role={toast.kind === "error" ? "alert" : "status"}>
      <span className={s.toastBar} aria-hidden="true" />
      <div className={s.toastText}>
        {toast.message}
        {toast.detail && <div className={s.toastDetail}>{toast.detail}</div>}
      </div>
      <IconButton icon={<X size={14} />} label="Dismiss" onClick={() => dismiss(toast.id)} />
    </div>
  );
}

/** Stack of transient messages, bottom-right. Mount once at the app root. */
export function ToastRegion() {
  const toasts = useAppStore((st) => st.toasts);
  return (
    <div className={s.toastRegion} aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
