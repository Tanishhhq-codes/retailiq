"""Stage 4: storage. Partitioned Parquet for the fact table, SQLite for the serving aggregates."""
import glob, os, shutil, sqlite3, time
import pandas as pd
from pyspark.sql import functions as F


def _best_of(fn, k=3):
    ts = []
    for _ in range(k):
        t = time.time(); fn(); ts.append(time.time() - t)
    return round(min(ts), 2)


def write(spark, clean, quarantine, proc, cfg, root, raw_csv_mb):
    pdir = os.path.join(root, cfg["paths"]["processed"])
    out = os.path.join(pdir, "orders_clean_parquet"); shutil.rmtree(out, ignore_errors=True)
    clean.drop("order_dt", "pre_signup").write.mode("overwrite").partitionBy("order_month") \
        .option("compression", "snappy").parquet(out)
    quarantine.write.mode("overwrite").parquet(os.path.join(pdir, "quarantine"))
    pq_mb = sum(os.path.getsize(p) for p in glob.glob(out + "/**/*.parquet", recursive=True)) / 1e6
    n_parts = len([d for d in os.listdir(out) if d.startswith("order_month=")])

    raw_csv = os.path.join(root, cfg["paths"]["raw"], "orders.csv")
    q_csv = lambda: spark.read.option("header", True).csv(raw_csv).withColumn("p", F.col("unit_price").cast("double")).agg(F.sum("p")).collect()
    q_pq = lambda: spark.read.parquet(out).agg(F.sum("revenue")).collect()
    q_pr = lambda: spark.read.parquet(out).filter("order_month='2025-11'").agg(F.sum("revenue")).collect()
    t_csv, t_pq, t_pr = _best_of(q_csv), _best_of(q_pq), _best_of(q_pr)

    db = os.path.join(pdir, "analytics.db")
    if os.path.exists(db): os.remove(db)
    con = sqlite3.connect(db)
    monthly = (pd.DataFrame(proc["cube_rows"]).query("status in @cfg['metrics']['revenue_statuses']")
               .groupby("order_month", as_index=False)[["revenue", "orders"]].sum())
    tables = {"monthly_revenue": monthly, "top_products": pd.DataFrame(proc["top_products"]),
              "revenue_by_city": pd.DataFrame(proc["by_city"]), "revenue_by_tier": pd.DataFrame(proc["by_tier"]),
              "rfm_segments": pd.DataFrame(proc["rfm"]["segments"]), "kpi": pd.DataFrame([proc["kpi"]])}
    for name, df in tables.items():
        df.to_sql(name, con, index=False, if_exists="replace")
    counts = {t: con.execute(f"select count(*) from {t}").fetchone()[0] for t in tables}
    sql = "SELECT segment, customers, revenue FROM rfm_segments ORDER BY revenue DESC LIMIT 3"
    sample = [dict(zip(["segment", "customers", "revenue"], r)) for r in con.execute(sql)]
    con.close()
    return {"parquet_mb": round(pq_mb, 2), "csv_mb": raw_csv_mb, "partitions": n_parts,
            "size_reduction_pct": round(100 * (1 - pq_mb / raw_csv_mb), 1),
            "query_csv_s": t_csv, "query_parquet_s": t_pq, "query_pruned_s": t_pr,
            "sqlite_kb": round(os.path.getsize(db) / 1e3, 1), "sqlite_tables": counts,
            "sample_sql": sql, "sample_result": sample}
