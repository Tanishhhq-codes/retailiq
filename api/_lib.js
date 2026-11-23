// Shared helpers for the serverless functions. Files starting with "_" are not exposed as routes.
import fs from "node:fs";
import path from "node:path";

const cache = new Map();
export function loadData(name) {
  if (!cache.has(name)) {
    const file = path.join(process.cwd(), "api", "_data", name);
    cache.set(name, JSON.parse(fs.readFileSync(file, "utf8")));
  }
  return cache.get(name);
}

export function params(req) {
  return new URL(req.url, "http://localhost").searchParams;
}

export function sendJson(res, status, body, cacheSeconds = 300) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", `public, max-age=60, s-maxage=${cacheSeconds}`);
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify(body));
}
