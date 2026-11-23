"""Stage 2: cleaning. Repair what can be repaired without guessing, quarantine the rest.

Validation rules are declared in rules.yaml; this module only knows how to turn a rule id
into a Spark expression. `clean_orders` is a pure function of its inputs so it can be unit
tested on a handful of rows.
"""
from pyspark.sql import functions as F


def _blank(c):
    return F.col(c).isNull() | (F.trim(F.col(c)) == "")


# rule id -> builder(params) -> boolean Column (True = the row FAILS the rule)
RULES = {
    "missing_customer_id":   lambda p: _blank("customer_id"),
    "missing_unit_price":    lambda p: F.col("price").isNull(),
    "non_numeric_quantity":  lambda p: F.col("qty").isNull(),
    "non_positive_quantity": lambda p: F.col("qty") < p.get("min_quantity", 1),
    "invalid_date":          lambda p: F.col("order_dt").isNull(),
    "orphan_product":        lambda p: F.col("category").isNull(),
    "orphan_customer":       lambda p: F.col("_ck").isNull(),
    "price_outlier":         lambda p: F.col("price") > F.col("med_price") * p.get("multiplier", 5),
}


def clean_orders(raw, customers, products, cfg):
    cc = cfg["cleaning"]
    n_raw = raw.count()
    dedup = raw.dropDuplicates() if cc.get("deduplicate", True) else raw
    n_dedup = dedup.count()

    # --- repair: spelling / casing (never drops a row)
    cmap = cc["standardise"]["country"]
    cm = F.create_map(*[x for kv in cmap.items() for x in (F.lit(kv[0]), F.lit(kv[1]))])
    std = (dedup.withColumn("_c", F.lower(F.trim("country")))
           .withColumn("country_clean", F.coalesce(cm[F.col("_c")], F.initcap(F.trim("country"))))
           .withColumn("status_clean", F.initcap(F.trim(F.lower("status")))))
    n_country_fix = std.filter(F.col("country") != F.col("country_clean")).count()
    n_status_fix = std.filter(F.col("status") != F.col("status_clean")).count()

    # --- safe typing: try_* returns NULL instead of raising under Spark 4 ANSI mode
    parts = [F.expr(f"try_to_date(order_date,'{fmt}')") for fmt in cc["date_formats"]]
    typed = (std.withColumn("order_dt", F.coalesce(*parts))
             .withColumn("qty", F.expr("try_cast(quantity as int)"))
             .withColumn("price", F.expr("try_cast(unit_price as double)"))
             .withColumn("disc", F.expr("try_cast(discount_pct as double)"))
             .join(F.broadcast(products.select("product_id", "category")), "product_id", "left"))

    # per-product median price (the outlier rule compares a price to its own product's median)
    med = (typed.filter(F.col("price") > 0).groupBy("product_id")
           .agg(F.percentile_approx("price", 0.5).alias("med_price")))
    cust = customers.select("customer_id", "city", "tier",
                            F.to_date("signup_date").alias("signup_dt")).withColumn("_ck", F.lit(1))
    tagged = (typed.join(F.broadcast(med), "product_id", "left")
              .join(F.broadcast(cust), "customer_id", "left"))

    # --- validation: first failing rule wins
    reason = rid = None
    active = []
    for r in cc["validation"]:
        if not r.get("enabled", True):
            continue
        cond = RULES[r["id"]](r)
        active.append(r)
        reason = F.when(cond, F.lit(r["reason"])) if reason is None else reason.when(cond, F.lit(r["reason"]))
        rid = F.when(cond, F.lit(r["id"])) if rid is None else rid.when(cond, F.lit(r["id"]))
    tagged = (tagged.withColumn("reject_reason", reason).withColumn("rule_id", rid)
              .withColumn("pre_signup", F.col("order_dt") < F.col("signup_dt"))).cache()

    reasons = {r["reject_reason"]: r["n"] for r in
               tagged.filter("reject_reason is not null").groupBy("reject_reason").agg(F.count("*").alias("n")).collect()}
    by_rule = {r["rule_id"]: r["n"] for r in
               tagged.filter("rule_id is not null").groupBy("rule_id").agg(F.count("*").alias("n")).collect()}

    quarantine = tagged.filter("reject_reason is not null").select(
        "order_id", "customer_id", "product_id", "order_date", "quantity", "unit_price",
        "country", "status", "reject_reason", "rule_id")

    clean = (tagged.filter("reject_reason is null")
             .select("order_id", "customer_id", "product_id", "category", "order_dt",
                     F.col("qty").alias("quantity"), F.col("price").alias("unit_price"),
                     F.col("disc").alias("discount_pct"), F.col("country_clean").alias("country"),
                     "payment_method", F.col("status_clean").alias("status"), "city", "tier", "pre_signup")
             .withColumn("revenue", F.round(F.col("quantity") * F.col("unit_price") * (1 - F.col("discount_pct") / 100), 2))
             .withColumn("order_month", F.date_format("order_dt", "yyyy-MM")))
    n_clean = clean.count()
    n_pre_signup = clean.filter("pre_signup").count()

    metrics = {
        "raw_rows": n_raw, "after_dedup": n_dedup, "duplicates_removed": n_raw - n_dedup,
        "country_fixes": n_country_fix, "status_fixes": n_status_fix,
        "quarantined": n_dedup - n_clean, "clean_rows": n_clean,
        "retention_pct": round(100 * n_clean / n_raw, 2),
        "reasons": reasons, "by_rule": by_rule,
        "advisory": {"order_before_signup": n_pre_signup},
        "rules": [{"id": r["id"], "reason": r["reason"], "injected_key": r.get("injected_key")} for r in active],
    }
    return clean, quarantine, tagged, metrics
