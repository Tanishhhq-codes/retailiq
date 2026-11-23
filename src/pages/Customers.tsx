import { HBars, Heatmap, LineChart, Panel, Loading } from "../charts";
import { fmtInt, fmtMoney, monthLabel, useAnalytics } from "../data";

const SEG_HELP: Record<string, string> = {
  Champions: "Bought recently and often (R 4-5, F 4-5)",
  Loyal: "Regular buyers, reasonably recent (R 3+, F 3+)",
  Promising: "Recent but few orders so far (R 4-5, F 1-2)",
  "At risk": "Used to buy often, gone quiet (R 1-2, F 3+)",
  Hibernating: "Few orders, long ago (R 1-2, F 1-2)",
  "Needs attention": "Middle of the pack on both measures",
};

export default function Customers() {
  const { data: a, error } = useAnalytics();
  if (error) return <div className="notice err">{error}</div>;
  if (!a) return <Loading />;
  const cells: Record<string, number> = {};
  a.rfm.grid.forEach((g) => { cells[`${g.R}-${g.F}`] = g.customers; });
  const segs = a.rfm.segments;
  const tierTotal = a.by_tier.reduce((s, t) => s + t.revenue, 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Customers</h1>
          <p>{fmtInt(a.rfm.customers)} customers scored on recency, frequency and spend as of {a.rfm.as_of}. Scores are percentile bands, so tied values land in the same band.</p>
        </div>
      </div>
      <div className="stack">
        <div className="grid2">
          <Panel title="Customer segments" sub="Revenue by segment (fulfilled orders). Segments combine the recency (R) and frequency (F) scores.">
            <HBars items={segs.map((s) => ({ label: s.segment, value: s.revenue, note: `${fmtInt(s.customers)} customers · ${SEG_HELP[s.segment]}` }))} fmt={(n) => fmtMoney(n, 0)} labelWidth={118} />
          </Panel>
          <Panel title="Recency against frequency" sub="Number of customers in each score band. Scale: 5 is best on both axes.">
            <Heatmap cells={cells} rows={[5, 4, 3, 2, 1]} cols={[1, 2, 3, 4, 5]} rowLabel="Recency score" colLabel="frequency score"
                     tip={(r, c, v) => `${fmtInt(v)} customers · recency ${r}, frequency ${c}`} />
          </Panel>
        </div>

        <Panel title="Segment detail">
          <div className="tablewrap"><table>
            <thead><tr><th>Segment</th><th>Definition</th><th className="num">Customers</th><th className="num">Revenue</th><th className="num">Avg spend</th><th className="num">Avg orders</th><th className="num">Days since last order</th></tr></thead>
            <tbody>{segs.map((s) => (
              <tr key={s.segment}><td><b>{s.segment}</b></td><td className="muted">{SEG_HELP[s.segment]}</td><td className="num">{fmtInt(s.customers)}</td>
                <td className="num">{fmtMoney(s.revenue, 0)}</td><td className="num">{fmtMoney(s.avg_monetary, 0)}</td><td className="num">{s.avg_orders}</td><td className="num">{fmtInt(s.avg_recency_days)}</td></tr>))}
            </tbody>
          </table></div>
          <p className="sub" style={{ marginTop: 12 }}>This is generated data where orders are assigned to customers at random, so the segments describe statistical bands rather than real behaviour. On real data the same code surfaces genuine at-risk groups.</p>
        </Panel>

        <div className="grid2">
          <Panel title="Revenue by city" sub="Fulfilled orders, all time.">
            <HBars items={a.by_city.map((c) => ({ label: c.city, value: c.revenue, note: `${fmtInt(c.customers)} customers` }))} fmt={(n) => fmtMoney(n, 0)} labelWidth={96} />
          </Panel>
          <Panel title="Revenue by loyalty tier" sub="Spend per customer shows whether higher tiers actually spend more.">
            <div className="tablewrap"><table>
              <thead><tr><th>Tier</th><th className="num">Customers</th><th className="num">Revenue</th><th className="num">Share</th><th className="num">Per customer</th></tr></thead>
              <tbody>{a.by_tier.map((t) => (
                <tr key={t.tier}><td>{t.tier}</td><td className="num">{fmtInt(t.customers)}</td><td className="num">{fmtMoney(t.revenue, 0)}</td>
                  <td className="num">{((100 * t.revenue) / tierTotal).toFixed(1)}%</td><td className="num">{fmtMoney(t.revenue_per_customer, 0)}</td></tr>))}
              </tbody>
            </table></div>
          </Panel>
        </div>

        <Panel title="Active customers per month" sub="Distinct customers with at least one fulfilled order.">
          <LineChart labels={a.monthly_active_customers.map((m) => m.month)} xFmt={monthLabel} tipTitle={monthLabel}
                     series={[{ name: "Active customers", color: "var(--s1)", values: a.monthly_active_customers.map((m) => m.customers) }]} yFmt={fmtInt} height={220} />
        </Panel>
      </div>
    </>
  );
}
