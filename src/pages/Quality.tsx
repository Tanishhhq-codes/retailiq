import { Link } from "react-router-dom";
import { HBars, Loading, Panel, Segments } from "../charts";
import { RejectionFlow } from "../viz";
import { fmtInt, fmtPct, useMeta } from "../data";

const DIM_HELP: Record<string, string> = {
  Uniqueness: "Share of raw rows that are not exact copies of another row.",
  Completeness: "Rows with customer, product, date, quantity and price all present.",
  Validity: "Quantity is a positive number, the date exists, the price is not an outlier.",
  Consistency: "Country and order status use one canonical spelling.",
  "Referential integrity": "Every customer and product id exists in its master file.",
};

export default function Quality() {
  const { data: m, error } = useMeta();
  if (error) return <div className="notice err">{error}</div>;
  if (!m) return <Loading />;
  const c = m.cleaning;
  const allMatch = m.ground_truth.length > 0 && m.ground_truth.every((g) => g.match);
  const reasons = Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const dims = Object.keys(m.quality.before);

  return (
    <>
      <div className="head">
        <div>
          <h1>Data quality</h1>
          <p>The pipeline repairs what it can fix without guessing and quarantines the rest with a reason code. Because the defects were injected in known numbers, each rule can be checked against the truth.</p>
        </div>
      </div>

      <div className="stack">
        <Panel title="Row reconciliation" sub="Every raw row ends up in exactly one place, so the three counts always add up to the input.">
          <Segments parts={[
            { label: "Clean", value: c.clean_rows, color: "var(--s1)", note: `${fmtPct(c.retention_pct, 2)} of the raw input retained` },
            { label: "Exact duplicates", value: c.duplicates_removed, color: "var(--neutral)", note: "Removed first so copies are not cleaned twice" },
            { label: "Quarantined", value: c.quarantined, color: "var(--s2)", note: "Stored with a reason; fix at source and reload" },
          ]} />
          <p className="sub" style={{ marginTop: 10 }}>{fmtInt(c.raw_rows)} − {fmtInt(c.duplicates_removed)} − {fmtInt(c.quarantined)} = {fmtInt(c.clean_rows)}</p>
        </Panel>

        <Panel title="Where the removed rows went" sub={`${fmtInt(c.duplicates_removed + c.quarantined)} rows left the pipeline. Ribbon width is proportional to row count; the first failing rule is the recorded reason, so no row is counted twice. Hover a reason to isolate it.`}>
          <RejectionFlow duplicates={c.duplicates_removed} reasons={reasons.map((r) => ({ label: r.label.split(" (")[0], value: r.value }))} rawRows={c.raw_rows} />
        </Panel>

        <div className="grid2">
          <Panel title="Quality scorecard" sub="Before is measured on the raw rows; after is re-checked on the cleaned output with independent tests.">
            <div className="legend"><span><i className="sw sq" style={{ color: "var(--neutral)" }} />Before cleaning</span><span><i className="sw sq" style={{ color: "var(--s1)" }} />After cleaning</span></div>
            <div className="scores">
              {dims.map((d) => (
                <div className="score" key={d} title={DIM_HELP[d]}>
                  <div className="name">{d}<span className="muted" style={{ fontWeight: 400 }}> · {DIM_HELP[d]}</span></div>
                  {(["before", "after"] as const).map((k) => (
                    <div className="row" key={k}>
                      <span className="tag">{k === "before" ? "Before" : "After"}</span>
                      <span className="tr"><span className="fill" style={{ width: `${m.quality[k][d]}%`, background: k === "before" ? "var(--neutral)" : "var(--s1)" }} /></span>
                      <span className="n">{fmtPct(m.quality[k][d], 2)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Panel>

          <div className="stack">
            <Panel title="A finding the labels did not contain">
              <div className="callout">
                <b>{fmtInt(c.advisory.order_before_signup)} clean orders</b> ({fmtPct((100 * c.advisory.order_before_signup) / c.clean_rows)}) are dated before the customer's signup date.
                This was not an injected defect, so no rule was written for it. It is flagged but not rejected, because deciding whether those orders are errors is a business call, not a cleaning rule. <Link to="/quarantine">Browse rejected rows</Link>
              </div>
            </Panel>
          <Panel title="Raw completeness by column" sub="Share of raw rows with a value in each required column.">
            <HBars items={Object.entries(m.quality.completeness_columns).map(([label, value]) => ({ label, value }))} fmt={(n) => fmtPct(n, 2)} labelWidth={110} zeroBars />
          </Panel>
          <Panel title="Spelling variants found" sub="Repaired in place, no rows lost.">
            <div className="tablewrap"><table>
              <thead><tr><th>Field</th><th className="num">Raw spellings</th><th className="num">Rows repaired</th></tr></thead>
              <tbody>
                <tr><td>Country</td><td className="num">{m.ingestion.distinct_country_raw} → 5</td><td className="num">{fmtInt(c.country_fixes)}</td></tr>
                <tr><td>Order status</td><td className="num">{m.ingestion.distinct_status_raw} → 4</td><td className="num">{fmtInt(c.status_fixes)}</td></tr>
              </tbody>
            </table></div>
          </Panel>
          </div>
        </div>

        {m.ground_truth.length === 0 ? (
          <Panel title="Detection against injected defects" sub="Not applicable to this dataset.">
            <p className="sub">Ground-truth validation compares the pipeline with defects a data generator injected in known numbers. Your own data has no such record, so use the Quarantine page to audit what each rule rejected.</p>
          </Panel>
        ) : (
        <Panel title="Detection against injected defects"
               sub={allMatch ? "Every count matches the number injected by the generator." : "Some counts differ from the injected numbers. Check the rule configuration."}
               actions={<span className={"badge " + (allMatch ? "good" : "bad")}>{allMatch ? "✓ All 11 exact" : "✗ Mismatch"}</span>}>
          <div className="tablewrap"><table>
            <thead><tr><th>Check</th><th>Action</th><th className="num">Injected</th><th className="num">Detected</th><th>Result</th></tr></thead>
            <tbody>{m.ground_truth.map((g) => (
              <tr key={g.rule}>
                <td>{g.action === "Quarantined" ? g.reason : g.rule}</td><td>{g.action}</td>
                <td className="num">{fmtInt(g.injected)}</td><td className="num">{fmtInt(g.detected)}</td>
                <td><span className={"badge " + (g.match ? "good" : "bad")}>{g.match ? "✓ Exact match" : `✗ Off by ${fmtInt(Math.abs(g.detected - g.injected))}`}</span></td>
              </tr>))}
            </tbody>
          </table></div>
          <p className="sub" style={{ marginTop: 12 }}>The price-outlier rule first used a per-category fence and flagged 526 rows against 300 injected. The extra 226 were real orders for expensive products. It now compares a price with its own product's median, and a unit test covers that case.</p>
        </Panel>
        )}

      </div>
    </>
  );
}
