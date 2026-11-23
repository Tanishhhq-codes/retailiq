// GET /api/summary?from=2025-01&to=2025-12&country=India,USA&category=Books&payment=UPI&status=Delivered,Shipped
// Aggregates the pre-computed cube on the server. Every filter is optional.
import { loadData, params, sendJson } from "./_lib.js";

export default function handler(req, res) {
  const cube = loadData("cube.json");
  const p = params(req);
  const { dims } = cube;
  const list = (k) => (p.get(k) ? p.get(k).split(",").map((s) => s.trim()).filter(Boolean) : null);
  const pick = (name, values, def) => {
    const want = values || def;
    return want ? new Set(want.map((v) => dims[name].indexOf(v)).filter((i) => i >= 0)) : null;
  };
  const sets = {
    country: pick("country", list("country")), category: pick("category", list("category")),
    payment: pick("payment", list("payment")), status: pick("status", list("status"), ["Delivered", "Shipped"]),
  };
  const from = p.get("from") || dims.month[0], to = p.get("to") || dims.month[dims.month.length - 1];
  const monthly = {}; let revenue = 0, orders = 0, units = 0;
  for (const [m, c, k, pay, s, o, u, r] of cube.rows) {
    const month = dims.month[m];
    if (month < from || month > to) continue;
    if (sets.country && !sets.country.has(c)) continue;
    if (sets.category && !sets.category.has(k)) continue;
    if (sets.payment && !sets.payment.has(pay)) continue;
    if (sets.status && !sets.status.has(s)) continue;
    revenue += r; orders += o; units += u;
    monthly[month] = (monthly[month] || 0) + r;
  }
  sendJson(res, 200, {
    filters: { from, to, country: list("country"), category: list("category"), payment: list("payment"),
               status: list("status") || ["Delivered", "Shipped"] },
    kpi: { revenue: Math.round(revenue * 100) / 100, orders, units, aov: orders ? Math.round((revenue / orders) * 100) / 100 : 0 },
    monthly: Object.entries(monthly).sort().map(([month, rev]) => ({ month, revenue: Math.round(rev * 100) / 100 })),
  });
}
