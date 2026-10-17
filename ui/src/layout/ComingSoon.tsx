import { Sparkles } from "lucide-react";
import { EmptyState } from "../components";

/** Placeholder for panels that a later feature will fill in. */
export function ComingSoon({ label, text }: { label: string; text: string }) {
  return <EmptyState icon={<Sparkles size={18} />} title="Coming soon" text={`${label}. ${text}`} />;
}
