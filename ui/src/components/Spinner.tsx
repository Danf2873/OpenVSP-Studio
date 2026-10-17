import s from "./ui.module.css";

export function Spinner({ label = "Working" }: { label?: string }) {
  return <span role="status" aria-label={label} title={label} className={s.spinner} />;
}
