// GET /api/quarantine?rule=&q=&page=1&pageSize=25&format=csv
// Browse (or export) the rows the pipeline rejected, each with the rule that rejected it.
import { loadData, params, sendJson } from "./_lib.js";

const csvCell = (v) => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`);

export default function handler(req, res) {
  const { columns, rows } = loadData("quarantine.json");
  const p = params(req);
  const rule = p.get("rule") || "";
  const q = (p.get("q") || "").trim().toLowerCase();
  const pageSize = Math.min(Math.max(parseInt(p.get("pageSize") || "25", 10) || 25, 1), 200);
  const iRule = columns.indexOf("rule"), iReason = columns.indexOf("reason");

  const reasons = {};
  for (const r of rows) {
    const k = r[iRule];
    reasons[k] = reasons[k] || { rule: k, reason: r[iReason], count: 0 };
    reasons[k].count += 1;
  }
  let filtered = rule ? rows.filter((r) => r[iRule] === rule) : rows;
  if (q) filtered = filtered.filter((r) => r.slice(0, 3).some((c) => c && String(c).toLowerCase().includes(q)));

  if (p.get("format") === "csv") {
    const body = [columns.join(","), ...filtered.map((r) => r.map(csvCell).join(","))].join("\n");
    res.statusCode = 200;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="quarantine${rule ? "-" + rule : ""}.csv"`);
    return res.end(body);
  }
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(parseInt(p.get("page") || "1", 10) || 1, 1), pages);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  sendJson(res, 200, {
    columns, total: filtered.length, page, pages, pageSize,
    reasons: Object.values(reasons).sort((a, b) => b.count - a.count),
    rows: slice,
  });
}
