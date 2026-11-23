import { useMemo, useState, type ReactNode } from "react";
import { Bar, HBars, LineChart, Loading, Panel, Segments } from "../charts";
import { DotMatrix, Sparkline } from "../viz";
import { Cube, fmtInt, fmtMoney, fmtRupee, monthLabel, useAnalytics, useCountUp, useCube, useMeta } from "../data";

type Dim = "country" | "category" | "payment" | "status";
type Sel = Record<Dim, Set<string>>;
const FULFILLED = ["Delivered", "Shipped"];
const defaultSel = (): Sel => ({ country: new Set(), category: new Set(), payment: new Set(), status: new Set(FULFILLED) });

function aggregate(cube: Cube, sel: Sel, from: number, to: number, skip?: Dim) {
  const ok = (dim: Dim, idx: number) => dim === skip || sel[dim].size === 0 || sel[dim].has(cube.dims[dim][idx]);
  const monthly = new Array(cube.dims.month.length).fill(0), mOrders = new Array(cube.dims.month.length).fill(0), mUnits = new Array(cube.dims.month.length).fill(0);
  const by: Record<"country" | "category" | "payment", Record<string, number>> = { country: {}, category: {}, payment: {} };
  let revenue = 0, orders = 0, units = 0;
  for (const [m, c, k, p, s, o, u, r] of cube.rows) {
    if (m < from || m > to) continue;
    if (!ok("status", s) || !ok("country", c) || !ok("category", k) || !ok("payment", p)) continue;
    revenue += r; orders += o; units += u; monthly[m] += r; mOrders[m] += o; mUnits[m] += u;
  }
  // per-dimension totals ignore that dimension's own selection so every bar stays visible
  for (const dim of ["country", "category", "payment"] as const) {
    for (const [m, c, k, p, s, , , r] of cube.rows) {
      if (m < from || m > to) continue;
      const idx = { country: c, category: k, payment: p } as const;
      if (!ok("status", s)) continue;
      let pass = true;
      for (const d2 of ["country", "category", "payment"] as const) if (d2 !== dim && !ok(d2, idx[d2])) pass = false;
      if (!pass) continue;
      const key = cube.dims[dim][idx[dim]];
      by[dim][key] = (by[dim][key] || 0) + r;
    }
  }
  return { revenue, orders, units, monthly, mOrders, mUnits, by };
}

const KPI_HELP: Record<string, string> = {
  "Revenue": "Total sales after discount (fulfilled orders). The headline size of the business.",
  "Orders": "Count of fulfilled orders. Shows demand volume.",
  "Average order value": "Revenue / orders. Rising AOV means bigger baskets or higher prices.",
  "Units sold": "Total items sold. Separates volume growth from price growth.",
};
function Kpi({ label, value, fmt, spark, delta }: { label: string; value: number; fmt: (n: number) => string; spark: number[]; delta: ReactNode }) {
  const v = useCountUp(value);
  return <div className="kpi" title={KPI_HELP[label]}><div className="kpirow"><div className="v">{fmt(v)}</div><Sparkline values={spark} /></div><div className="l">{label}</div>{delta}</div>;
}

export default function Overview() {
  const { data: cube, error } = useCube();
  const { data: meta } = useMeta();
  const { data: an } = useAnalytics();
  const [sel, setSel] = useState<Sel>(defaultSel);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [compare, setCompare] = useState(false);
  const [table, setTable] = useState(false);
  const months = cube?.dims.month ?? [];
  const [from, to] = range ?? [Math.max(0, months.length - 12), months.length - 1];

  const cur = useMemo(() => cube && aggregate(cube, sel, from, to), [cube, sel, from, to]);
  const prev = useMemo(() => {
    if (!cube) return null;
    const n = to - from + 1, pf = from - n, pt = from - 1;
    return pf >= 0 ? aggregate(cube, sel, pf, pt) : null;
  }, [cube, sel, from, to]);
  const matrix = useMemo(() => {
    if (!cube) return null;
    const noCat = { ...sel, category: new Set<string>() };
    const nC = cube.dims.category.length, nM = cube.dims.month.length;
    const grid = Array.from({ length: nC }, () => new Array(nM).fill(0));
    const ok = (dim: Dim, idx: number) => noCat[dim].size === 0 || noCat[dim].has(cube.dims[dim][idx]);
    for (const [m, c, k, p, st, , , r] of cube.rows) if (ok("status", st) && ok("country", c) && ok("payment", p)) grid[k][m] += r;
    return cube.dims.category.map((label, i) => ({ label, values: grid[i].slice(from, to + 1), total: grid[i].slice(from, to + 1).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  }, [cube, sel, from, to]);
  const dimAgg = useMemo(() => {
    if (!cube) return null;
    return { country: aggregate(cube, sel, from, to, "country").by.country, category: aggregate(cube, sel, from, to, "category").by.category,
             payment: aggregate(cube, sel, from, to, "payment").by.payment };
  }, [cube, sel, from, to]);

  if (error) return <div className="notice err">{error}</div>;
  if (!cube || !cur || !dimAgg || !matrix) return <Loading />;

  const toggle = (dim: Dim) => (v: string) => setSel((s) => {
    const n = new Set(s[dim]); n.has(v) ? n.delete(v) : n.add(v); return { ...s, [dim]: n };
  });
  const filtered = sel.country.size + sel.category.size + sel.payment.size > 0 || sel.status.size !== 2 || !FULFILLED.every((f) => sel.status.has(f)) || range != null;
  const aov = cur.orders ? cur.revenue / cur.orders : 0;
  const delta = (a: number, b?: number) => (b && b > 0 ? ((a - b) / b) * 100 : null);
  const dRev = delta(cur.revenue, prev?.revenue), dOrd = delta(cur.orders, prev?.orders);
  const dAov = prev && prev.orders ? delta(aov, prev.revenue / prev.orders) : null;
  const dUn = delta(cur.units, prev?.units);
  const nm = to - from + 1;
  const sorted = (rec: Record<string, number>): Bar[] => Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const festive = months.slice(from, to + 1).reduce<{ from: number; to: number; label: string }[]>((acc, m, i) => {
    const mo = +m.slice(5, 7); if (mo < 10) return acc;
    const last = acc[acc.length - 1];
    if (last && last.to === i - 1) last.to = i; else acc.push({ from: i, to: i, label: "Festive season" });
    return acc;
  }, []);
  const topCats = an?.top_by_category.filter((t) => t.rank === 1) ?? [];

  const Delta = ({ v }: { v: number | null }) => v == null ? <span className="delta flat">no earlier period to compare</span> :
    <span className={"delta " + (v > 0.05 ? "up" : v < -0.05 ? "down" : "flat")}>{v > 0.05 ? "▲" : v < -0.05 ? "▼" : "■"} {Math.abs(v).toFixed(1)}% vs previous {nm} months</span>;
  const chips = (dim: Dim) => (
    <div className="chips">
      {cube.dims[dim].map((v) => <button key={v} className="chip" aria-pressed={sel[dim].has(v)} onClick={() => toggle(dim)(v)}>{v}</button>)}
    </div>
  );

  return (
    <>
      <div className="head">
        <div>
          <h1>Sales overview</h1>
          <p>Revenue is net of discount and counts fulfilled orders only (Delivered and Shipped) unless you change the order status filter. Click any bar to filter by it.</p>
        </div>
      </div>

      {meta && (
        <Panel title="Where the raw rows went" sub={`${fmtInt(meta.cleaning.raw_rows)} order rows in, ${fmtInt(meta.cleaning.clean_rows)} trusted rows out. Nothing is deleted without a recorded reason.`} className="trust">
          <Segments parts={[
            { label: "Clean", value: meta.cleaning.clean_rows, color: "var(--s1)", note: "Used for every figure on this page" },
            { label: "Exact duplicates", value: meta.cleaning.duplicates_removed, color: "var(--neutral)", note: "Identical copies, dropped" },
            { label: "Quarantined", value: meta.cleaning.quarantined, color: "var(--s2)", note: "Rejected with a reason code" },
          ]} />
        </Panel>
      )}

      <div className="filters sticky" style={{ marginTop: 16 }}>
        <div className="fgroup"><span>From</span>
          <select className="select" value={from} onChange={(e) => setRange([+e.target.value, Math.max(+e.target.value, to)])}>
            {months.map((m, i) => <option key={m} value={i}>{monthLabel(m)}</option>)}</select></div>
        <div className="fgroup"><span>To</span>
          <select className="select" value={to} onChange={(e) => setRange([Math.min(from, +e.target.value), +e.target.value])}>
            {months.map((m, i) => <option key={m} value={i} disabled={i < from}>{monthLabel(m)}</option>)}</select></div>
        <div className="fgroup"><span>Order status</span>{chips("status")}</div>
        <div className="fgroup"><span>Payment</span>{chips("payment")}</div>
        {filtered && <button className="linkbtn" onClick={() => { setSel(defaultSel()); setRange(null); }}>Reset filters</button>}
      </div>

      <div className="kpis">
        <Kpi label="Revenue" value={cur.revenue} fmt={(n) => fmtMoney(n)} spark={cur.monthly.slice(from, to + 1)} delta={<Delta v={dRev} />} />
        <Kpi label="Orders" value={cur.orders} fmt={fmtInt} spark={cur.mOrders.slice(from, to + 1)} delta={<Delta v={dOrd} />} />
        <Kpi label="Average order value" value={aov} fmt={fmtRupee} spark={cur.monthly.slice(from, to + 1).map((r, i) => (cur.mOrders[from + i] ? r / cur.mOrders[from + i] : 0))} delta={<Delta v={dAov} />} />
        <Kpi label="Units sold" value={cur.units} fmt={fmtInt} spark={cur.mUnits.slice(from, to + 1)} delta={<Delta v={dUn} />} />
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        <Panel title="Monthly revenue" sub={`${monthLabel(months[from])} to ${monthLabel(months[to])}. Drag across the chart to zoom into a period.`}
               actions={<div className="toggles">
                 <button className="chip" aria-pressed={compare} disabled={!prev} onClick={() => setCompare(!compare)}>Compare with previous period</button>
                 <button className="chip" aria-pressed={table} onClick={() => setTable(!table)}>Table</button>
               </div>}>
          {table ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Month</th><th className="num">Revenue</th><th className="num">Orders</th></tr></thead>
              <tbody>{months.slice(from, to + 1).map((m, i) => <tr key={m}><td>{monthLabel(m)}</td><td className="num">{fmtMoney(cur.monthly[from + i])}</td><td className="num">{fmtInt(cur.mOrders[from + i])}</td></tr>)}</tbody>
            </table></div>
          ) : (
            <LineChart key={`${from}-${to}-${compare}`} labels={months.slice(from, to + 1)} xFmt={monthLabel} tipTitle={monthLabel} area endLabel height={280}
                       bands={festive} onBrush={(a, b) => setRange([from + a, from + b])}
                       series={[{ name: "Revenue", color: "var(--s1)", values: cur.monthly.slice(from, to + 1) },
                                ...(compare && prev ? [{ name: "Previous period", color: "var(--neutral)", dash: true, values: prev.monthly.slice(from - nm, from) }] : [])]}
                       yFmt={(n) => fmtMoney(n, n >= 1e7 ? 0 : 1)} />
          )}
          {range && <button className="linkbtn zoomreset" onClick={() => setRange(null)}>Reset zoom</button>}
        </Panel>
        <Panel title="Category by month" sub="Dot size runs from each category's weakest to its strongest month in the window. Click a row to focus on it.">
          <DotMatrix rows={matrix} cols={months.slice(from, to + 1)} colFmt={monthLabel} fmt={(n) => fmtMoney(n)} selected={sel.category} onSelect={toggle("category")} />
        </Panel>
        <div className="grid3">
          <Panel title="Revenue by category" sub="Click a bar to focus on it.">
            <HBars items={sorted(dimAgg.category)} fmt={(n) => fmtMoney(n)} selected={sel.category} onSelect={toggle("category")} labelWidth={112} />
          </Panel>
          <Panel title="Revenue by country" sub="Click a bar to focus on it.">
            <HBars items={sorted(dimAgg.country)} fmt={(n) => fmtMoney(n)} selected={sel.country} onSelect={toggle("country")} labelWidth={84} />
          </Panel>
          <Panel title="Revenue by payment method" sub="Click a bar to focus on it.">
            <HBars items={sorted(dimAgg.payment)} fmt={(n) => fmtMoney(n)} selected={sel.payment} onSelect={toggle("payment")} labelWidth={100} />
          </Panel>
        </div>
        {topCats.length > 0 && (
          <Panel title="Best-selling product in each category" sub="All time, fulfilled orders. Not affected by the filters above.">
            <div className="tablewrap"><table>
              <thead><tr><th>Category</th><th>Product</th><th className="num">Revenue</th></tr></thead>
              <tbody>{topCats.map((t) => <tr key={t.category}><td>{t.category}</td><td>{t.product_id}</td><td className="num">{fmtMoney(t.revenue)}</td></tr>)}</tbody>
            </table></div>
          </Panel>
        )}
      </div>
    </>
  );
}
