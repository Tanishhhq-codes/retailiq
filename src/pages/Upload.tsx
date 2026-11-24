import { useEffect, useRef, useState } from "react";
import { Panel } from "../charts";
import { API_URL, fmtInt, getJob, setJob } from "../data";

type Health = { status: string; java: boolean; max_upload_mb: number; order_columns: string[]; customer_columns: string[]; product_columns: string[]; ttl_hours: number };
type Job = { job_id: string; state: "queued" | "running" | "done" | "failed"; stages: string[]; completed: string[]; current: string | null; error: string | null; seconds: number; rows?: Record<string, number> };
type Kind = "orders" | "customers" | "products";

const STAGE_LABEL: Record<string, string> = { "1_ingestion": "Ingestion", "2_cleaning": "Cleaning", "3_processing": "Processing", "4_storage": "Storage", "5_export": "Export" };
const FILES: { key: Kind; title: string; accept: string; hint: string }[] = [
  { key: "orders", title: "Orders", accept: ".csv,text/csv", hint: "CSV with a header row" },
  { key: "customers", title: "Customers", accept: ".json,.jsonl,.csv", hint: "JSON lines or CSV" },
  { key: "products", title: "Products", accept: ".csv,text/csv", hint: "CSV with a header row" },
];
const SAMPLE: Record<Kind, string> = {
  orders: "order_id,customer_id,product_id,order_date,quantity,unit_price,discount_pct,country,payment_method,status\nO000001,C00001,P0001,2024-01-15,2,1499.00,5,India,UPI,Delivered\n",
  customers: '{"customer_id":"C00001","city":"Delhi","tier":"Gold","signup_date":"2023-06-01"}\n',
  products: "product_id,category,product_name,list_price\nP0001,Electronics,Electronics Item 001,1499.00\n",
};
const SAMPLE_NAME: Record<Kind, string> = { orders: "orders.csv", customers: "customers.json", products: "products.csv" };

function download(kind: Kind) {
  const url = URL.createObjectURL(new Blob([SAMPLE[kind]], { type: "text/plain" }));
  const a = document.createElement("a"); a.href = url; a.download = SAMPLE_NAME[kind]; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function Upload() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [files, setFiles] = useState<Partial<Record<Kind, File>>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [job, setJobState] = useState<Job | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    fetch(`${API_URL}/api/health`).then((r) => r.json()).then(setHealth).catch(() => setOffline(true));
    return () => window.clearTimeout(timer.current);
  }, []);

  const poll = (id: string) => {
    fetch(`${API_URL}/api/jobs/${id}`).then((r) => { if (!r.ok) throw new Error("Lost track of the job."); return r.json(); })
      .then((j: Job) => { setJobState(j); if (j.state === "queued" || j.state === "running") timer.current = window.setTimeout(() => poll(id), 1500); else setBusy(false); })
      .catch((e) => { setErrors([String(e.message || e)]); setBusy(false); });
  };

  const submit = async () => {
    setErrors([]); setJobState(null); setBusy(true);
    const fd = new FormData();
    for (const f of FILES) fd.append(f.key, files[f.key]!);
    try {
      const r = await fetch(`${API_URL}/api/upload`, { method: "POST", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErrors(body.errors ?? [body.detail ?? `Upload failed (${r.status}).`]); setBusy(false); return; }
      poll(body.job_id);
    } catch { setErrors(["Could not reach the backend. Check that it is running."]); setBusy(false); }
  };

  const ready = FILES.every((f) => files[f.key]);
  const open = () => { setJob(job!.job_id); location.assign("/overview"); };

  return (
    <>
      <div className="head">
        <div>
          <h1>Upload your data</h1>
          <p>Send your own orders, customers and products. The backend runs the same Spark pipeline on them (clean, quarantine, aggregate) and this dashboard then shows your results.</p>
        </div>
      </div>
      <div className="stack">
        {offline && (
          <div className="notice err">
            The upload backend is not reachable at <code>{API_URL}</code>. Start it with <code>uvicorn backend.app:app --port 8000</code> (needs Java 17+), or set <code>VITE_BACKEND_URL</code> to where it is hosted.
          </div>
        )}
        {health && !health.java && <div className="notice err">The backend is running but Java is not installed, so Spark cannot run.</div>}
        {getJob() && <div className="notice">You are currently viewing an uploaded dataset. A new upload replaces it.</div>}

        <Panel title="1. Choose your files" sub={health ? `Up to ${health.max_upload_mb} MB each. Results are kept for ${health.ttl_hours} hours.` : undefined}>
          <div className="uplgrid">
            {FILES.map((f) => (
              <label key={f.key} className={"upl" + (files[f.key] ? " has" : "")}>
                <b>{f.title}</b>
                <span className="muted">{files[f.key]?.name ?? f.hint}</span>
                <input type="file" accept={f.accept} disabled={busy} onChange={(e) => setFiles((s) => ({ ...s, [f.key]: e.target.files?.[0] }))} />
              </label>
            ))}
          </div>
          <div className="uplactions">
            <button className="chip" aria-pressed="true" disabled={!ready || busy || offline || (health ? !health.java : false)} onClick={submit}>{busy ? "Processing…" : "Upload and run pipeline"}</button>
            <span className="muted">Templates:</span>
            {FILES.map((f) => <button key={f.key} className="linkbtn" onClick={() => download(f.key)}>{SAMPLE_NAME[f.key]}</button>)}
          </div>
          {errors.length > 0 && <ul className="uplerr" role="alert">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </Panel>

        {job && (
          <Panel title="2. Pipeline progress" sub={job.rows ? `${fmtInt(job.rows.orders)} orders, ${fmtInt(job.rows.customers)} customers, ${fmtInt(job.rows.products)} products accepted.` : undefined}>
            <ol className="steps">
              {job.stages.map((s) => {
                const st = job.completed.includes(s) ? "done" : job.current === s ? "now" : "todo";
                return <li key={s} className={st}><span>{st === "done" ? "✓" : st === "now" ? "…" : ""}</span>{STAGE_LABEL[s]}</li>;
              })}
            </ol>
            <p className="muted">{job.state === "queued" ? "Waiting for the server to be free." : job.state === "running" ? `Running for ${job.seconds} s.` : job.state === "done" ? `Finished in ${job.seconds} s.` : ""}</p>
            {job.state === "failed" && <div className="notice err">The pipeline failed: {job.error}</div>}
            {job.state === "done" && <button className="chip" aria-pressed="true" onClick={open}>Open the dashboard with your data</button>}
          </Panel>
        )}

        <Panel title="Required format">
          <div className="tablewrap"><table>
            <thead><tr><th>File</th><th>Columns</th><th>Notes</th></tr></thead>
            <tbody>
              <tr><td>orders</td><td><code>{(health?.order_columns ?? []).join(", ") || "order_id, customer_id, product_id, order_date, quantity, unit_price, discount_pct, country, payment_method, status"}</code></td><td>Header names are matched ignoring case and order. Dates: <code>yyyy-MM-dd</code>, <code>dd/MM/yyyy</code> or <code>MMM dd, yyyy</code>. Status: Delivered, Shipped, Cancelled, Returned.</td></tr>
              <tr><td>customers</td><td><code>customer_id, city, tier, signup_date</code></td><td><code>signup_date</code> as <code>yyyy-MM-dd</code>.</td></tr>
              <tr><td>products</td><td><code>product_id, category</code> (optional: <code>product_name, list_price</code>)</td><td>Every order must reference a product and a customer listed here, otherwise it is quarantined.</td></tr>
            </tbody>
          </table></div>
          <p className="sub" style={{ marginTop: 10 }}>Bad rows are never silently dropped: they land in the Quarantine page with the rule that stopped them. At least 8 months of orders are needed for the forecast.</p>
        </Panel>
      </div>
    </>
  );
}
