import { EmptyState } from "../../components";
import { cellDisplay, formatNumber, type ResultModel } from "./resultModel";
import s from "./results.module.css";

/** Table view: scalars as a list, each equal-length column set as a table, matrices as grids. */
export function ResultTable({ model }: { model: ResultModel }) {
  const empty = model.scalars.length === 0 && model.groups.length === 0 && model.matrices.length === 0;
  if (empty) return <EmptyState title="No data" text="This result has no entries to show." />;

  return (
    <div className={s.tables}>
      {model.scalars.length > 0 && (
        <section className={s.section} aria-label="Scalar values">
          <h3 className={s.sectionTitle}>Values</h3>
          <dl className={s.scalars}>
            {model.scalars.map((item) => (
              <div key={item.name} className={s.scalarRow} title={item.doc}>
                <dt>{item.name}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {model.groups.map((g, gi) => (
        <section key={gi} className={s.section} aria-label={`Table of ${g.length} rows`}>
          <h3 className={s.sectionTitle}>
            {g.columns.length} {g.columns.length === 1 ? "column" : "columns"}, {g.length} rows
          </h3>
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  {g.columns.map((c) => (
                    <th key={c.key} scope="col" className={c.numeric ? s.num : s.txt}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: g.length }, (_, r) => (
                  <tr key={r}>
                    {g.columns.map((c) => (
                      <td key={c.key} className={c.numeric ? s.num : s.txt}>
                        {cellDisplay(c.values[r])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {model.matrices.map((m, mi) => (
        <section key={mi} className={s.section} aria-label={m.name}>
          <h3 className={s.sectionTitle}>
            {m.name} ({m.rows.length} × {m.rows[0]?.length ?? 0})
          </h3>
          <div className={s.tableScroll}>
            <table className={s.table}>
              <tbody>
                {m.rows.map((row, r) => (
                  <tr key={r}>
                    <th scope="row" className={s.rowIndex}>
                      {r + 1}
                    </th>
                    {row.map((v, c) => (
                      <td key={c} className={s.num}>
                        {v === null ? "—" : formatNumber(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
