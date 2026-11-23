import { HBars, Panel, Loading } from "../charts";
import { STATIC, fmtInt, fmtPct, useMeta } from "../data";

const Api = ({ href, name }: { href: string; name: string }) => STATIC ? <code>{name}</code> : <a href={href}><code>{name}</code></a>;

export default function Pipeline() {
  const { data: m, error } = useMeta();
  if (error) return <div className="notice err">{error}</div>;
  if (!m) return <Loading />;
  const t = m.timings, s = m.storage, c = m.cleaning;
  const stages = [
    { n: "Ingestion", k: "1_ingestion", d: `${fmtInt(m.ingestion.raw_rows)} order rows read as text from CSV, plus customer JSON and product CSV. ${m.ingestion.corrupt_rows} corrupt lines.` },
    { n: "Cleaning", k: "2_cleaning", d: `Deduplicate, standardise, parse three date formats, validate with ${c.rules.length} rules, quarantine rejects.` },
    { n: "Processing", k: "3_processing", d: "Broadcast joins, aggregation cube, window ranking, RFM scoring." },
    { n: "Storage", k: "4_storage", d: `Parquet in ${s.partitions} month partitions, SQLite serving tables, query benchmark.` },
    { n: "Export", k: "5_export", d: "Forecast, anomaly scan and compact JSON for this site." },
  ];

  return (
    <>
      <div className="head">
        <div>
          <h1>Pipeline</h1>
          <p>How the data on this site was produced. Spark runs offline and writes small JSON files, because Vercel serves static files and short serverless functions and cannot run a Spark job.</p>
        </div>
      </div>
      <div className="stack">
        <Panel title="Five stages" sub={`${m.run.run_id} on ${m.run.finished_at}, Spark ${m.run.spark}, ${m.run.cores} cores, ${m.run.total_seconds} s end to end.`}>
          <div className="flow">
            {stages.map((s2) => (
              <div className="stage" key={s2.k}><h3>{s2.n}</h3><div className="t">{(t[s2.k] ?? 0).toFixed(1)} s</div><p>{s2.d}</p></div>
            ))}
          </div>
        </Panel>

        <div className="grid2">
          <Panel title="Storage: CSV against Parquet" sub="Part of the saving comes from the removed rows and dropped helper columns, not compression alone.">
            <HBars items={[{ label: "Raw CSV", value: s.csv_mb }, { label: "Clean Parquet", value: s.parquet_mb }]} fmt={(n) => `${n.toFixed(2)} MB`} labelWidth={110} zeroBars />
            <p className="sub" style={{ marginTop: 10 }}>{fmtPct(s.size_reduction_pct)} smaller, in {s.partitions} month partitions, Snappy compressed.</p>
          </Panel>
          <Panel title="Query benchmark" sub="Best of three runs on this machine. Reported as measured.">
            <HBars items={[{ label: "Sum on CSV", value: s.query_csv_s }, { label: "Sum on Parquet", value: s.query_parquet_s }, { label: "One month, pruned", value: s.query_pruned_s }]}
                   fmt={(n) => `${n.toFixed(2)} s`} labelWidth={130} color="var(--s3)" zeroBars />
            <p className="sub" style={{ marginTop: 10 }}>At this size Spark start-up dominates, so a full Parquet scan is not faster than CSV. Partition pruning is the part that helps; column pruning and compression pay off at gigabytes.</p>
          </Panel>
        </div>

        <Panel title="Cleaning rules" sub="Declared in pipeline/rules.yaml and evaluated top to bottom. The first failing rule is the reason. Change the file and re-run, no Spark code needed.">
          <div className="tablewrap"><table>
            <thead><tr><th>Order</th><th>Rule id</th><th>Reason recorded</th><th className="num">Rows rejected</th></tr></thead>
            <tbody>{m.rules_config.map((r, i) => (
              <tr key={r.id}><td>{i + 1}</td><td><code>{r.id}</code></td><td>{r.reason}</td><td className="num">{fmtInt(c.by_rule[r.id] ?? 0)}</td></tr>))}
            </tbody>
          </table></div>
        </Panel>

        <Panel title="Run history" sub="Every execution is logged. Sample runs process a fraction of the rows for fast development and do not publish data to the site.">
          <div className="tablewrap"><table>
            <thead><tr><th>Run</th><th>Finished</th><th>Mode</th><th className="num">Raw rows</th><th className="num">Clean rows</th><th className="num">Quarantined</th><th className="num">Seconds</th><th>Defects check</th></tr></thead>
            <tbody>{[...m.history].reverse().map((h) => (
              <tr key={h.run_id}><td>{h.run_id}</td><td>{h.finished_at}</td><td>{h.mode}</td><td className="num">{fmtInt(h.raw_rows)}</td><td className="num">{fmtInt(h.clean_rows)}</td>
                <td className="num">{fmtInt(h.quarantined)}</td><td className="num">{h.total_seconds}</td>
                <td>{h.ground_truth_match == null ? <span className="muted">Not applicable</span> : h.ground_truth_match ? <span className="badge good">✓ Exact</span> : <span className="badge bad">✗ Differs</span>}</td></tr>))}
            </tbody>
          </table></div>
        </Panel>

        <div className="grid2">
          <Panel title="API" sub={STATIC ? "Serverless functions that run on the Vercel deployment. This preview has no server, so they are listed but not linked." : "Serverless functions on Vercel, reading the same pipeline output."}>
            <div className="tablewrap"><table>
              <thead><tr><th>Endpoint</th><th>What it returns</th></tr></thead>
              <tbody>
                <tr><td><Api href="/api/health" name="/api/health" /></td><td>Liveness and data counts</td></tr>
                <tr><td><Api href="/api/summary?from=2025-01&country=India" name="/api/summary" /></td><td>KPIs and monthly revenue; filter by <code>from</code>, <code>to</code>, <code>country</code>, <code>category</code>, <code>payment</code>, <code>status</code></td></tr>
                <tr><td><Api href="/api/quarantine?rule=price_outlier&pageSize=5" name="/api/quarantine" /></td><td>Rejected rows; <code>rule</code>, <code>q</code>, <code>page</code>, <code>pageSize</code>, <code>format=csv</code></td></tr>
              </tbody>
            </table></div>
          </Panel>
          <Panel title="Run it yourself">
            <pre>{`pip install pyspark pandas numpy pyyaml pytest
python pipeline/generate_data.py   # seeded raw files
python pipeline/run_pipeline.py    # ~1 minute
python -m pytest -q tests          # 22 tests
npm install && npm run dev         # this site`}</pre>
          </Panel>
        </div>
      </div>
    </>
  );
}
