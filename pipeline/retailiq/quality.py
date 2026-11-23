"""Data-quality scorecard (dimensions after Wang & Strong, 1996).

BEFORE is measured on the de-duplicated raw rows (uniqueness on the raw rows); AFTER is
measured by re-checking the cleaned output with independent tests, not by assuming success.
"""
from pyspark.sql import functions as F


def _blank(c):
    return F.col(c).isNull() | (F.trim(F.col(c)) == "")


def _pct(df, cond):
    row = df.agg(F.avg(cond.cast("int")).alias("p")).collect()[0]
    return round(100 * float(row["p"]), 2)


def score_before(tagged, n_raw, n_dedup, null_profile):
    completeness_cols = ["customer_id", "product_id", "order_date", "quantity", "unit_price"]
    complete = ~(_blank("customer_id") | _blank("product_id") | _blank("order_date")
                 | _blank("quantity") | _blank("unit_price"))
    valid = ~(((F.col("qty").isNotNull()) & (F.col("qty") < 1))
              | (~_blank("quantity") & F.col("qty").isNull())
              | (~_blank("order_date") & F.col("order_dt").isNull())
              | (F.col("price").isNotNull() & (F.col("price") > F.col("med_price") * 5)))
    consistent = (F.col("country") == F.col("country_clean")) & (F.col("status") == F.col("status_clean"))
    integrity = ~((~_blank("product_id") & F.col("category").isNull())
                  | (~_blank("customer_id") & F.col("_ck").isNull()))
    dims = {
        "Uniqueness": round(100 * n_dedup / n_raw, 2),
        "Completeness": _pct(tagged, complete),
        "Validity": _pct(tagged, valid),
        "Consistency": _pct(tagged, consistent),
        "Referential integrity": _pct(tagged, integrity),
    }
    cols = {c: round(100 * (1 - null_profile[c] / n_raw), 2) for c in completeness_cols}
    return dims, cols


def score_after(clean, cfg):
    canon_c = set(cfg["cleaning"]["standardise"]["country"].values())
    canon_s = cfg["cleaning"]["standardise"]["status_canonical"]
    n = clean.count()
    dup = n - clean.dropDuplicates().count()
    complete = F.col("order_id").isNotNull() & F.col("customer_id").isNotNull() & F.col("unit_price").isNotNull() \
        & F.col("quantity").isNotNull() & F.col("order_dt").isNotNull()
    valid = (F.col("quantity") >= 1) & (F.col("unit_price") > 0) & F.col("order_dt").between("2024-01-01", "2025-12-31")
    consistent = F.col("country").isin(sorted(canon_c)) & F.col("status").isin(canon_s)
    integrity = F.col("category").isNotNull() & F.col("city").isNotNull()
    return {
        "Uniqueness": round(100 * (1 - dup / n), 2),
        "Completeness": _pct(clean, complete),
        "Validity": _pct(clean, valid),
        "Consistency": _pct(clean, consistent),
        "Referential integrity": _pct(clean, integrity),
    }
