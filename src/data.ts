import { useEffect, useRef, useState } from "react";

/** True for the static preview build (no serverless API available). */
export const STATIC = import.meta.env.VITE_STATIC === "1";
export const BASE = import.meta.env.BASE_URL;

export type Meta = {
  run: { run_id: string; finished_at: string; mode: string; spark: string; cores: number; raw_rows: number; clean_rows: number;
         quarantined: number; retention_pct: number; total_seconds: number; ground_truth_match: boolean | null; version: string };
  timings: Record<string, number>;
  ingestion: { raw_rows: number; corrupt_rows: number; customers: number; products: number; raw_csv_mb: number;
               null_profile: Record<string, number>; distinct_country_raw: number; distinct_status_raw: number };
  cleaning: { raw_rows: number; after_dedup: number; duplicates_removed: number; country_fixes: number; status_fixes: number;
              quarantined: number; clean_rows: number; retention_pct: number; reasons: Record<string, number>;
              by_rule: Record<string, number>; advisory: { order_before_signup: number };
              rules: { id: string; reason: string; injected_key: string | null }[] };
  quality: { before: Record<string, number>; after: Record<string, number>; completeness_columns: Record<string, number> };
  storage: { parquet_mb: number; csv_mb: number; partitions: number; size_reduction_pct: number; query_csv_s: number;
             query_parquet_s: number; query_pruned_s: number; sqlite_kb: number; sqlite_tables: Record<string, number>;
             sample_sql: string; sample_result: Record<string, string | number>[] };
  ground_truth: { rule: string; reason: string; action: string; injected: number; detected: number; match: boolean }[];
  history: { run_id: string; finished_at: string; mode: string; raw_rows: number; clean_rows: number; quarantined: number;
             retention_pct: number; total_seconds: number; ground_truth_match: boolean | null; spark: string }[];
  rules_config: { id: string; reason: string; injected_key?: string; min_quantity?: number; multiplier?: number }[];
  kpi: { revenue: number; orders: number; customers: number; units: number; aov: number };
};

export type Analytics = {
  kpi: Meta["kpi"];
  top_products: { product_id: string; category: string; revenue: number; units: number }[];
  top_by_category: { category: string; product_id: string; revenue: number; rank: number }[];
  by_city: { city: string; revenue: number; customers: number }[];
  by_tier: { tier: string; revenue: number; customers: number; revenue_per_customer: number }[];
  monthly_active_customers: { month: string; customers: number }[];
  rfm: { as_of: string; customers: number;
         segments: { segment: string; customers: number; revenue: number; avg_monetary: number; avg_orders: number; avg_recency_days: number }[];
         grid: { R: number; F: number; customers: number }[] };
  forecast: { method: string; mape_holdout_pct: number; growth_per_month_pct: number; festive_uplift_pct: number;
              fitted: { month: string; revenue: number }[];
              forecast: { month: string; revenue: number; low: number; high: number }[] };
  anomalies: { threshold: number; window_days: number;
               series: { d: string; revenue: number; expected: number; flag: boolean }[];
               flagged: { d: string; revenue: number; expected: number; z: number }[] };
  insights: { title: string; tone: "info" | "good" | "warn"; body: string }[];
};

export type Cube = {
  dims: { month: string[]; country: string[]; category: string[]; payment: string[]; status: string[] };
  columns: string[];
  rows: [number, number, number, number, number, number, number, number][];
};

// ---- which dataset is shown: the bundled demo run, or a user's upload processed by the backend
export const API_URL = ((import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const JOB_KEY = "riq-job";
export function getJob(): string | null { try { return localStorage.getItem(JOB_KEY); } catch { return null; } }
export function setJob(id: string | null) { try { id ? localStorage.setItem(JOB_KEY, id) : localStorage.removeItem(JOB_KEY); } catch { /* storage unavailable */ } }
export const dataUrl = (file: string) => { const j = getJob(); return j ? `${API_URL}/api/jobs/${j}/data/${file}` : `${BASE}data/${file}`; };

const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  const url = dataUrl(file);
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(getJob()
        ? "Your uploaded dataset is no longer available (results expire after a while, or the backend is offline). Switch back to the demo data from the banner above."
        : `Could not load ${file} (${r.status}). Run the pipeline and redeploy.`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url) as Promise<T>;
}

export function useJson<T>(file: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { load<T>(file).then(setData).catch((e) => setError(String(e.message || e))); }, [file]);
  return { data, error };
}
export const useMeta = () => useJson<Meta>("meta.json");
export const useAnalytics = () => useJson<Analytics>("analytics.json");
export const useCube = () => useJson<Cube>("cube.json");

// ---- formatting (international digit grouping, INR amounts)
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export function fmtMoney(n: number, digits = 1): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `₹${(n / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `₹${(n / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(digits)}K`;
  return `₹${n.toFixed(0)}`;
}
export const fmtRupee = (n: number) => `₹${Math.round(n).toLocaleString("en-US")}`;
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo - 1]} ${y.slice(2)}`;
};
export const dayLabel = (d: string) => {
  const [y, mo, da] = d.split("-");
  return `${+da} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo - 1]} ${y}`;
};

/** Animates a number toward its target (count-up on load, smooth change on filter). */
export function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { cur.current = target; setV(target); return; }
    const from = cur.current, t0 = performance.now(); let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      cur.current = from + (target - from) * e; setV(cur.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
