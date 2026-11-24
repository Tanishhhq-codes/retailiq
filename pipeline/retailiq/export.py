"""Stage 5: export compact JSON for the Vercel app.

Vercel serves static files and short-lived serverless functions; it cannot run Spark. The heavy
work therefore happens here, offline, and the web app reads the results:
  public/data/*.json   -> fetched by the browser
  api/_data/*.json     -> bundled into the serverless functions (quarantine explorer, summary API)
"""
import json, os
from . import analytics


def _dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"), default=str)
    return os.path.getsize(path)


def build_cube(rows):
    dims = {k: sorted({r[k] for r in rows}) for k in ("order_month", "country", "category", "payment_method", "status")}
    idx = {k: {v: i for i, v in enumerate(vs)} for k, vs in dims.items()}
    packed = [[idx["order_month"][r["order_month"]], idx["country"][r["country"]], idx["category"][r["category"]],
               idx["payment_method"][r["payment_method"]], idx["status"][r["status"]],
               int(r["orders"]), int(r["units"]), float(r["revenue"])] for r in rows]
    packed.sort()
    return {"dims": {"month": dims["order_month"], "country": dims["country"], "category": dims["category"],
                     "payment": dims["payment_method"], "status": dims["status"]},
            "columns": ["month", "country", "category", "payment", "status", "orders", "units", "revenue"],
            "rows": packed}


def insights(proc, cube_rows, fc, anom, clean_m, cfg):
    ful = cfg["metrics"]["revenue_statuses"]
    rows = [r for r in cube_rows if r["status"] in ful]
    tot = sum(r["revenue"] for r in rows)
    def share(key):
        agg = {}
        for r in rows: agg[r[key]] = agg.get(r[key], 0) + r["revenue"]
        return sorted(agg.items(), key=lambda x: -x[1]), agg
    cats, _ = share("category"); ctry, _ = share("country"); pay_rows = {}
    for r in rows: pay_rows[r["payment_method"]] = pay_rows.get(r["payment_method"], 0) + r["orders"]
    pay = max(pay_rows.items(), key=lambda x: x[1]); n_orders = sum(pay_rows.values())
    by_year = {}
    for r in rows: by_year[r["order_month"][:4]] = by_year.get(r["order_month"][:4], 0) + r["revenue"]
    years = sorted(by_year)
    pre = clean_m["advisory"]["order_before_signup"]
    top2 = f"; the top two categories ({cats[0][0]}, {cats[1][0]}) account for {100*(cats[0][1]+cats[1][1])/tot:.1f}%" if len(cats) > 1 else ""
    geo = f"{ctry[0][0]} generates {100*ctry[0][1]/tot:.1f}% of revenue" + (f", followed by {ctry[1][0]} ({100*ctry[1][1]/tot:.1f}%)." if len(ctry) > 1 else ".")
    if len(years) >= 2 and by_year[years[-2]] > 0:
        y0, y1 = years[-2], years[-1]
        q4 = sum(r["revenue"] for r in rows if r["order_month"] >= f"{y1}-10" and r["order_month"][:4] == y1)
        growth = (f"Revenue changed {100*(by_year[y1]/by_year[y0]-1):+.0f}% from {y0} to {y1} (note: {y1} may be a partial year), and Oct-Dec {y1} "
                  f"produced {100*q4/by_year[y1]:.0f}% of {y1} revenue. The fitted festive-season uplift is {fc['festive_uplift_pct']}%.")
    else:
        growth = f"The fitted monthly growth is {fc['growth_per_month_pct']}% and the festive-season (Oct-Dec) uplift is {fc['festive_uplift_pct']}%."
    out = [
        {"title": "Revenue concentration", "tone": "info",
         "body": f"{cats[0][0]} brings in {100*cats[0][1]/tot:.1f}% of fulfilled revenue{top2}."},
        {"title": "Geography", "tone": "info",
         "body": geo},
        {"title": "Growth and seasonality", "tone": "good",
         "body": growth},
        {"title": "Payments", "tone": "info",
         "body": f"{pay[0]} is the most used method ({100*pay[1]/n_orders:.1f}% of fulfilled orders)."},
        {"title": "Forecast reliability", "tone": "warn",
         "body": f"Hold-out MAPE is {fc['mape_holdout_pct']}% on the last 3 known months. The model is intentionally small (24 data points); treat the band as indicative."},
        {"title": "Finding the labels did not contain", "tone": "warn",
         "body": f"{pre:,} clean orders ({100*pre/max(clean_m['clean_rows'], 1):.1f}%) are dated before the customer's signup date. It is reported as an advisory flag, not rejected, because it needs a business decision."},
        {"title": "Anomaly scan", "tone": "good" if not anom["flagged"] else "warn",
         "body": f"{len(anom['flagged'])} day(s) exceeded |z| > {anom['threshold']} against a {anom['window_days']}-day rolling median." if anom["flagged"]
                 else f"No day exceeded |z| > {anom['threshold']} against a {anom['window_days']}-day rolling median, as expected for generated data with no injected spikes."},
    ]
    return out


def run(proc, quarantine_rows, meta_core, clean_m, cfg, root):
    ful = cfg["metrics"]["revenue_statuses"]
    pub = os.path.join(root, cfg["paths"]["web_public"]); api = os.path.join(root, cfg["paths"]["web_api"])
    cube = build_cube(proc["cube_rows"])
    monthly = {}
    for r in proc["cube_rows"]:
        if r["status"] in ful:
            m = monthly.setdefault(r["order_month"], {"order_month": r["order_month"], "revenue": 0.0, "orders": 0})
            m["revenue"] += r["revenue"]; m["orders"] += int(r["orders"])
    monthly = sorted(monthly.values(), key=lambda x: x["order_month"])
    if len(monthly) < 8:
        raise ValueError(f"Not enough data for the forecast: found {len(monthly)} month(s) of fulfilled orders, need at least 8.")
    fc = analytics.forecast(monthly, cfg["metrics"]["forecast_horizon_months"])
    a = cfg["metrics"]["anomaly"]
    anom = analytics.anomalies(proc["daily"], a["window_days"], a["robust_z"])
    sizes = {}
    sizes["cube.json"] = _dump(cube, os.path.join(pub, "cube.json"))
    _dump(cube, os.path.join(api, "cube.json"))
    sizes["analytics.json"] = _dump({
        "kpi": proc["kpi"], "top_products": proc["top_products"], "top_by_category": proc["top_by_category"],
        "by_city": proc["by_city"], "by_tier": proc["by_tier"], "monthly_active_customers": proc["monthly_active_customers"],
        "rfm": proc["rfm"], "forecast": fc, "anomalies": anom,
        "insights": insights(proc, proc["cube_rows"], fc, anom, clean_m, cfg),
    }, os.path.join(pub, "analytics.json"))
    sizes["meta.json"] = _dump(meta_core, os.path.join(pub, "meta.json"))
    q = {"columns": ["order_id", "customer_id", "product_id", "order_date", "quantity", "unit_price", "country", "status", "reason", "rule"],
         "rows": quarantine_rows}
    sizes["quarantine.json"] = _dump(q, os.path.join(api, "quarantine.json"))
    _dump(q, os.path.join(pub, "quarantine.json"))   # browser fallback when the API is unavailable
    return sizes
