// GET /api/health: liveness plus which pipeline run the deployed data came from.
import { loadData, sendJson } from "./_lib.js";

export default function handler(req, res) {
  const q = loadData("quarantine.json");
  sendJson(res, 200, { status: "ok", quarantine_rows: q.rows.length, endpoints: ["/api/health", "/api/summary", "/api/quarantine"] }, 60);
}
