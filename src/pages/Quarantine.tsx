import { useEffect, useState } from "react";
import { Panel, Loading } from "../charts";
import { BASE, STATIC, fmtInt } from "../data";

type Raw = { columns: string[]; rows: (string | null)[][] };
let rawPromise: Promise<Raw> | null = null;
const loadRaw = () => (rawPromise ??= fetch(`${BASE}data/quarantine.json`).then((r) => { if (!r.ok) throw new Error("Could not load the rejected rows."); return r.json(); }));

/** Same filtering and paging as api/quarantine.js, done in the browser when the API is not available. */
function filterRows(raw: Raw, rule: string, q: string) {
  const iRule = raw.columns.indexOf("rule"), iReason = raw.columns.indexOf("reason");
  const reasons: Record<string, { rule: string; reason: string; count: number }> = {};
  for (const r of raw.rows) { const k = r[iRule]!; (reasons[k] ??= { rule: k, reason: r[iReason]!, count: 0 }).count++; }
  let rows = rule ? raw.rows.filter((r) => r[iRule] === rule) : raw.rows;
  const ql = q.trim().toLowerCase();
  if (ql) rows = rows.filter((r) => r.slice(0, 3).some((c) => c && c.toLowerCase().includes(ql)));
  return { rows, reasons: Object.values(reasons).sort((a, b) => b.count - a.count) };
}
function localPage(raw: Raw, rule: string, q: string, page: number, pageSize = 25) {
  const { rows, reasons } = filterRows(raw, rule, q);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), p = Math.min(Math.max(page, 1), pages);
  return { columns: raw.columns, total: rows.length, page: p, pages, pageSize, reasons, rows: rows.slice((p - 1) * pageSize, p * pageSize) };
}
const csvCell = (v: string | null) => (v == null ? "" : `"${v.replace(/"/g, '""')}"`);

type Resp = {
  columns: string[]; total: number; page: number; pages: number; pageSize: number;
  reasons: { rule: string; reason: string; count: number }[]; rows: (string | null)[][];
};

export default function Quarantine() {
  const [rule, setRule] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const [local, setLocal] = useState(STATIC);
  useEffect(() => {
    const ctl = new AbortController();
    const viaBrowser = () => loadRaw().then((raw) => { if (!ctl.signal.aborted) { setData(localPage(raw, rule, query, page)); setError(null); } });
    if (local) { viaBrowser().catch((e) => setError(e.message)); return () => ctl.abort(); }
    const p = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (rule) p.set("rule", rule); if (query) p.set("q", query);
    fetch(`/api/quarantine?${p}`, { signal: ctl.signal })
      .then((r) => { if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error("api"); return r.json(); })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => { if (e.name !== "AbortError") setLocal(true); });   // API unreachable: filter in the browser instead
    return () => ctl.abort();
  }, [rule, query, page, local]);

  const [copied, setCopied] = useState(false);
  const csvName = `quarantine${rule ? "-" + rule : ""}.csv`;
  const buildCsv = async () => { const raw = await loadRaw(); const { rows } = filterRows(raw, rule, query); return [raw.columns.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n"); };
  const download = async () => {
    const url = URL.createObjectURL(new Blob([await buildCsv()], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = csvName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(await buildCsv()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError("Your browser blocked copying. Use the deployed site to download the CSV."); } };
  const cell = (v: string | null) => (v === null || v === "" ? <span className="blank">(blank)</span> : v);
  const totalAll = data?.reasons.reduce((a, b) => a + b.count, 0) ?? 0;

  return (
    <>
      <div className="head">
        <div>
          <h1>Quarantine</h1>
          <p>Rows the pipeline rejected, shown exactly as they arrived with the rule that stopped them. Fix them at the source and reload, or export the list.</p>
        </div>
        {STATIC
          ? <button className="btn ghost" onClick={copy}>{copied ? "Copied" : `Copy ${data ? fmtInt(data.total) : ""} rows as CSV`}</button>
          : <button className="btn ghost" onClick={download}>Download {data ? fmtInt(data.total) : ""} rows as CSV</button>}
      </div>

      <div className="filters">
        <div className="fgroup"><span>Rule</span>
          <select className="select" value={rule} onChange={(e) => { setRule(e.target.value); setPage(1); }} style={{ minWidth: 260 }}>
            <option value="">All rules ({fmtInt(totalAll)})</option>
            {data?.reasons.map((r) => <option key={r.rule} value={r.rule}>{r.reason} ({fmtInt(r.count)})</option>)}
          </select></div>
        <div className="fgroup"><span>Search order, customer or product id</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example O0000418 or C07526" /></div>
        {(rule || q) && <button className="linkbtn" onClick={() => { setRule(""); setQ(""); }}>Clear</button>}
      </div>

      <Panel explain="Rejected rows" title={data ? `${fmtInt(data.total)} rejected rows` : "Rejected rows"} sub="Quantity, price and date are shown as raw text, so bad values such as “two” or 31/02/2025 stay visible.">
        {error && <div className="notice err">{error}</div>}
        {!error && !data && <Loading />}
        {data && data.rows.length === 0 && <div className="notice">No rejected rows match. Clear the filters to see all of them.</div>}
        {data && data.rows.length > 0 && (
          <>
            <div className="tablewrap"><table>
              <thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Date (raw)</th><th className="num">Qty (raw)</th><th className="num">Price (raw)</th><th>Country</th><th>Why it was rejected</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r[0]}>
                  <td>{r[0]}</td><td>{cell(r[1])}</td><td>{cell(r[2])}</td><td>{cell(r[3])}</td>
                  <td className="num">{cell(r[4])}</td><td className="num">{cell(r[5])}</td><td>{cell(r[6])}</td><td>{r[8]}</td>
                </tr>))}
              </tbody>
            </table></div>
            <div className="pager">
              <span className="muted">Page {data.page} of {fmtInt(data.pages)}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost" disabled={data.page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn ghost" disabled={data.page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
              </span>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
