"""Validate and normalise your own files into the layout the Spark reader expects.

The Spark ingest maps the orders columns by position, so a file with the same headers in a different
order (or different capitalisation) would silently be misread. This step matches headers by name,
re-writes the files in the right order and reports every problem in plain language.
"""
import csv, json
from pathlib import Path

CUSTOMER_COLS = ["customer_id", "city", "tier", "signup_date"]
PRODUCT_REQUIRED = ["product_id", "category"]
PRODUCT_OPTIONAL = ["product_name", "list_price"]


class Invalid(Exception):
    def __init__(self, errors): super().__init__("; ".join(errors)); self.errors = errors


def _norm(h): return h.replace("﻿", "").strip().lower()
def _open(p): return open(p, "r", encoding="utf-8-sig", errors="replace", newline="")


def check_csv(src, dst, label, required, optional=(), order=None):
    """Re-write a CSV with normalised headers. With `order`, output has exactly those columns in that order."""
    with _open(src) as fi:
        rd = csv.reader(fi)
        header = next(rd, None)
        if not header:
            raise Invalid([f"{label}: no header row."])
        idx = {}
        for i, h in enumerate(header): idx.setdefault(_norm(h), i)
        missing = [c for c in required if c not in idx]
        if missing:
            raise Invalid([f"{label}: missing column(s) {', '.join(missing)}. Found: {', '.join(_norm(h) for h in header)}."])
        cols = list(order) if order else list(required) + [c for c in optional if c in idx]
        pick = [idx.get(c) for c in cols]
        n = 0
        with open(dst, "w", encoding="utf-8", newline="") as fo:
            w = csv.writer(fo); w.writerow(cols)
            for row in rd:
                if not any(c.strip() for c in row): continue
                w.writerow([(row[i] if i is not None and i < len(row) else "") for i in pick]); n += 1
    if n == 0:
        raise Invalid([f"{label}: no data rows."])
    return n


def check_customers(src, dst):
    """Accept JSON lines or CSV; always write JSON lines (what the pipeline reads)."""
    label = "customers"
    with _open(src) as f:
        first = f.read(1)
        while first and first.isspace(): first = f.read(1)
    n = 0
    if first == "{":
        with _open(src) as fi, open(dst, "w", encoding="utf-8") as fo:
            for ln, line in enumerate(fi, 1):
                if not line.strip(): continue
                try: rec = {_norm(k): v for k, v in json.loads(line).items()}
                except (ValueError, AttributeError): raise Invalid([f"{label}: line {ln} is not a JSON object."])
                missing = [c for c in CUSTOMER_COLS if c not in rec]
                if missing: raise Invalid([f"{label}: line {ln} is missing {', '.join(missing)}."])
                fo.write(json.dumps({c: (None if rec[c] is None else str(rec[c])) for c in CUSTOMER_COLS}) + "\n"); n += 1
    else:
        tmp = Path(str(dst) + ".tmp")
        check_csv(src, tmp, label, CUSTOMER_COLS)
        with _open(tmp) as fi, open(dst, "w", encoding="utf-8") as fo:
            for rec in csv.DictReader(fi):
                fo.write(json.dumps({c: rec[c] or None for c in CUSTOMER_COLS}) + "\n"); n += 1
        tmp.unlink()
    if n == 0:
        raise Invalid([f"{label}: no records."])
    return n


def prepare(orders, customers, products, out_dir, order_cols):
    """Validate all three files and write them to out_dir. Returns row counts; raises Invalid with every problem."""
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    errors, counts = [], {}
    jobs = (("orders", lambda: check_csv(orders, out / "orders.csv", "orders", order_cols, order=order_cols)),
            ("customers", lambda: check_customers(customers, out / "customers.json")),
            ("products", lambda: check_csv(products, out / "products.csv", "products", PRODUCT_REQUIRED, PRODUCT_OPTIONAL)))
    for label, fn in jobs:
        try: counts[label] = fn()
        except Invalid as e: errors += e.errors
        except FileNotFoundError as e: errors.append(f"{label}: file not found ({e.filename}).")
    if errors:
        raise Invalid(errors)
    stale = out / "injected_defects.json"
    if stale.exists():          # a previous generated dataset's ground truth would not describe your data
        stale.unlink()
    return counts
