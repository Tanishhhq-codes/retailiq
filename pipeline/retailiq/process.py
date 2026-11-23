"""Stage 3: processing. Business aggregates computed in Spark, returned as small Python structures."""
from pyspark.sql import functions as F, Window


def run(clean, cfg):
    fulfilled = cfg["metrics"]["revenue_statuses"]
    valid = clean.filter(F.col("status").isin(fulfilled))
    out = {}

    k = valid.agg(F.sum("revenue").alias("rev"), F.countDistinct("order_id").alias("orders"),
                  F.countDistinct("customer_id").alias("custs"), F.sum("quantity").alias("units")).collect()[0]
    out["kpi"] = {"revenue": round(k["rev"], 2), "orders": int(k["orders"]), "customers": int(k["custs"]),
                  "units": int(k["units"]), "aov": round(k["rev"] / k["orders"], 2)}

    # ---- cube: every dimension combination, so the browser can filter without a server round-trip
    cube = (clean.groupBy("order_month", "country", "category", "payment_method", "status")
            .agg(F.count("*").alias("orders"), F.sum("quantity").alias("units"),
                 F.round(F.sum("revenue"), 2).alias("revenue")))
    out["cube_rows"] = [r.asDict() for r in cube.collect()]

    out["top_products"] = [r.asDict() for r in (
        valid.groupBy("product_id", "category").agg(F.round(F.sum("revenue"), 2).alias("revenue"),
                                                    F.sum("quantity").alias("units"))
        .orderBy(F.desc("revenue")).limit(15).collect())]
    w = Window.partitionBy("category").orderBy(F.desc("revenue"))
    out["top_by_category"] = [r.asDict() for r in (
        valid.groupBy("category", "product_id").agg(F.round(F.sum("revenue"), 2).alias("revenue"))
        .withColumn("rank", F.dense_rank().over(w)).filter("rank<=3").orderBy("category", "rank").collect())]

    out["by_city"] = [r.asDict() for r in valid.groupBy("city").agg(
        F.round(F.sum("revenue"), 2).alias("revenue"), F.countDistinct("customer_id").alias("customers")
    ).orderBy(F.desc("revenue")).collect()]
    out["by_tier"] = [r.asDict() for r in valid.groupBy("tier").agg(
        F.round(F.sum("revenue"), 2).alias("revenue"), F.countDistinct("customer_id").alias("customers"),
        F.round(F.sum("revenue") / F.countDistinct("customer_id"), 0).alias("revenue_per_customer")
    ).orderBy(F.desc("revenue")).collect()]

    out["daily"] = [{"d": str(r["order_dt"]), "revenue": r["revenue"], "orders": r["orders"]} for r in
                    valid.groupBy("order_dt").agg(F.round(F.sum("revenue"), 2).alias("revenue"),
                                                  F.count("*").alias("orders")).orderBy("order_dt").collect()]
    out["monthly_active_customers"] = [{"month": r["order_month"], "customers": int(r["c"])} for r in
                                       valid.groupBy("order_month").agg(F.countDistinct("customer_id").alias("c"))
                                       .orderBy("order_month").collect()]
    out["rfm"] = rfm(valid, cfg["metrics"]["rfm_bins"])
    return out


def rfm(valid, bins):
    """Recency / frequency / monetary scoring. Percent-rank bins keep tied values in the same bin."""
    asof = valid.agg(F.max("order_dt")).collect()[0][0]
    per = valid.groupBy("customer_id").agg(
        F.datediff(F.lit(asof), F.max("order_dt")).alias("recency_days"),
        F.countDistinct("order_id").alias("frequency"), F.sum("revenue").alias("monetary"))
    def score(col, asc):
        w = Window.orderBy(F.col(col) if asc else F.col(col).desc())
        return F.least(F.lit(bins), F.floor(F.percent_rank().over(w) * bins).cast("int") + 1)
    sc = (per.withColumn("R", score("recency_days", False)).withColumn("F", score("frequency", True))
          .withColumn("M", score("monetary", True)))
    seg = (F.when((F.col("R") >= 4) & (F.col("F") >= 4), "Champions")
           .when((F.col("R") >= 3) & (F.col("F") >= 3), "Loyal")
           .when((F.col("R") >= 4) & (F.col("F") <= 2), "Promising")
           .when((F.col("R") <= 2) & (F.col("F") >= 3), "At risk")
           .when((F.col("R") <= 2) & (F.col("F") <= 2), "Hibernating")
           .otherwise("Needs attention"))
    sc = sc.withColumn("segment", seg).cache()
    summary = [r.asDict() for r in sc.groupBy("segment").agg(
        F.count("*").alias("customers"), F.round(F.sum("monetary"), 0).alias("revenue"),
        F.round(F.avg("monetary"), 0).alias("avg_monetary"), F.round(F.avg("frequency"), 1).alias("avg_orders"),
        F.round(F.avg("recency_days"), 0).alias("avg_recency_days")).orderBy(F.desc("revenue")).collect()]
    grid = [{"R": int(r["R"]), "F": int(r["F"]), "customers": int(r["n"])} for r in
            sc.groupBy("R", "F").agg(F.count("*").alias("n")).collect()]
    return {"as_of": str(asof), "segments": summary, "grid": grid, "customers": sc.count()}
