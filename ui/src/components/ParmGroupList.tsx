import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Parm, ParmGroup } from "../api/types";
import { Card } from "./Card";
import { Disclosure } from "./Disclosure";
import { EmptyState } from "./EmptyState";
import { ParmField } from "./ParmField";
import { cx } from "./cx";
import s from "./ui.module.css";

export interface ParmGroupListProps {
  groups: ParmGroup[];
  /** Initial filter text. */
  initialFilter?: string;
  /** Hide the filter box. */
  noFilter?: boolean;
  emptyText?: string;
}

function matches(p: Parm, q: string): boolean {
  if (!q) return true;
  return (
    p.label.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) ||
    p.descr.toLowerCase().includes(q)
  );
}

/**
 * Parameter groups as cards. Advanced parms sit behind an "All parameters"
 * disclosure at the end of each card. A filter box narrows by label, name or
 * description and opens every matching section.
 */
export function ParmGroupList({ groups, initialFilter = "", noFilter = false, emptyText }: ParmGroupListProps) {
  const [filter, setFilter] = useState(initialFilter);
  const q = filter.trim().toLowerCase();

  const visible = useMemo(
    () =>
      groups
        .map((g) => ({
          g,
          main: g.parms.filter((p) => !p.advanced && matches(p, q)),
          adv: g.parms.filter((p) => p.advanced && matches(p, q)),
        }))
        .filter((x) => x.main.length > 0 || x.adv.length > 0),
    [groups, q],
  );

  if (groups.length === 0) {
    return <EmptyState title="No parameters" text={emptyText} />;
  }

  return (
    <div>
      {!noFilter && (
        <div className={s.filterWrap}>
          <Search size={13} aria-hidden="true" className={s.filterIcon} />
          <input
            type="search"
            className={cx(s.input, s.filterInput)}
            placeholder="Filter parameters"
            aria-label="Filter parameters"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {visible.length === 0 && <EmptyState title="No matches" text={`Nothing matches "${filter.trim()}".`} />}

      <div className={s.cardStack}>
        {visible.map(({ g, main, adv }) => (
          <Card key={g.group} padded={false} className={s.cardClip}>
            <Disclosure title={g.label} storageKey={`parms:${g.group}`} forceOpen={q.length > 0}>
              <div className={s.parmGroupBody}>
                {main.map((p) => (
                  <ParmField key={p.id} parm={p} />
                ))}
                {adv.length > 0 && (
                  <Disclosure title="All parameters" storageKey={`parms-all:${g.group}`} nested defaultOpen={false} forceOpen={q.length > 0}>
                    {adv.map((p) => (
                      <ParmField key={p.id} parm={p} />
                    ))}
                  </Disclosure>
                )}
              </div>
            </Disclosure>
          </Card>
        ))}
      </div>
    </div>
  );
}
