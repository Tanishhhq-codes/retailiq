import { LineChart, Loading, Panel } from "../charts";
import { CalendarDots } from "../viz";
import { dayLabel, fmtInt, fmtMoney, monthLabel, useAnalytics, useMeta } from "../data";

export default function Insights() {
  const { data: a, error } = useAnalytics();
  const { data: m } = useMeta();
  if (error) return <div className="notice err">{error}</div>;
  if (!a) return <Loading />;
  const f = a.forecast;
  const known = f.fitted.map((x) => x.month);
  const actual = a.anomalies.series; // daily
  // monthly actuals from the daily series
  const monthlyActual: Record<string, number> = {};
  actual.forEach((d) => { const k = d.d.slice(0, 7); monthlyActual[k] = (monthlyActual[k] || 0) + d.revenue; });
  const labels = [...known, ...f.forecast.map((x) => x.month)];
  const nK = known.length;
  const pad = (arr: (number | null)[]) => arr;
  const actualVals = pad(labels.map((l, i) => (i < nK ? monthlyActual[l] ?? null : null)));
  const fitVals = labels.map((l, i) => (i < nK ? f.fitted[i].revenue : null));
  // the forecast line starts at the last actual point so the lines connect
  const fcVals = labels.map((l, i) => (i === nK - 1 ? f.fitted[i].revenue : i >= nK ? f.forecast[i - nK].revenue : null));
  const lo = labels.map((l, i) => (i === nK - 1 ? f.fitted[i].revenue : i >= nK ? f.forecast[i - nK].low : null));
  const hi = labels.map((l, i) => (i === nK - 1 ? f.fitted[i].revenue : i >= nK ? f.forecast[i - nK].high : null));
  const dLabels = actual.map((d) => d.d);
  const markers = a.anomalies.flagged.map((z) => ({ idx: dLabels.indexOf(z.d), label: `Unusual day: ${(z.z).toFixed(1)} robust z, expected ${fmtMoney(z.expected)}` }));
  const flaggedSet = new Set(a.anomalies.flagged.map((z) => z.d));
  const tone = { good: "✓", warn: "!", info: "i" } as const;
  const toneCls = { good: "good", warn: "warn", info: "muted" } as const;

  return (
    <>
      <div className="head">
        <div>
          <h1>Insights</h1>
          <p>What the cleaned data says, with a short forecast and a scan for unusual days. The statistics are deliberately simple and each one reports how reliable it is.</p>
        </div>
      </div>
      <div className="stack">
        <Panel title="Revenue forecast" sub={`Next ${f.forecast.length} months with a 90% range. Method: ${f.method}.`}
               actions={<span className="muted" style={{ fontSize: 13 }}>Hold-out error {f.mape_holdout_pct}% · trend +{f.growth_per_month_pct}% per month · festive uplift +{f.festive_uplift_pct}%</span>}>
          <LineChart labels={labels} xFmt={monthLabel} tipTitle={(l) => monthLabel(l) + (labels.indexOf(l) >= nK ? " (forecast)" : "")}
                     series={[
                       { name: "Forecast", color: "var(--s2)", values: fcVals, dash: true, band: { lo, hi } },
                       { name: "Fitted trend", color: "var(--neutral)", values: fitVals, width: 1.5 },
                       { name: "Actual", color: "var(--s1)", values: actualVals },
                     ]} yFmt={(n) => fmtMoney(n, n >= 1e7 ? 0 : 1)} height={280} />
        </Panel>

        <Panel title="Daily revenue and unusual days" sub={`Each day is compared with the median of the ${a.anomalies.window_days} days around it. Days beyond ${a.anomalies.threshold} robust z-scores are marked.`}>
          <LineChart labels={dLabels} xFmt={(d) => monthLabel(d.slice(0, 7))} tipTitle={dayLabel} xEvery={60} markers={markers}
                     series={[{ name: "Daily revenue", color: "var(--s1)", values: actual.map((d) => d.revenue), width: 1.25 }]} yFmt={(n) => fmtMoney(n, 1)} height={240} />
          {a.anomalies.flagged.length > 0 && (
            <div className="tablewrap" style={{ marginTop: 12 }}><table>
              <thead><tr><th>Day</th><th className="num">Revenue</th><th className="num">Expected</th><th className="num">Robust z</th></tr></thead>
              <tbody>{a.anomalies.flagged.map((z) => <tr key={z.d}><td>{dayLabel(z.d)}</td><td className="num">{fmtMoney(z.revenue, 0)}</td><td className="num">{fmtMoney(z.expected, 0)}</td><td className="num">{z.z.toFixed(2)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Panel>

        <Panel title="Every day at a glance" sub="One dot per day, darker for higher revenue. Orange rings mark the unusual days from the chart above.">
          <CalendarDots days={actual.map((d) => ({ d: d.d, revenue: d.revenue, flag: flaggedSet.has(d.d) }))} fmt={(n) => fmtMoney(n, 1)} dayLabel={dayLabel} />
        </Panel>

        <Panel title="Findings" sub={m ? `Computed from ${fmtInt(m.cleaning.clean_rows)} clean rows (${m.run.run_id}).` : undefined}>
          {a.insights.map((i) => (
            <div className="finding" key={i.title}>
              <span className={"badge " + toneCls[i.tone]} aria-hidden>{tone[i.tone]}</span>
              <div><h3>{i.title}</h3><p>{i.body}</p></div>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
