"""RetailIQ pipeline entry point.

    python pipeline/run_pipeline.py                 # full run, exports data for the web app
    python pipeline/run_pipeline.py --sample 0.2    # quick dev run on 20% of rows (no export)
"""
import argparse, datetime as dt, json, logging, os, sys, time
from pathlib import Path

os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import yaml
from pyspark.sql import SparkSession

from retailiq import ingest, clean, process, quality, storage, export, __version__

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "pipeline" / "rules.yaml"))
    ap.add_argument("--sample", type=float, default=None, help="fraction of raw rows to process (dev runs)")
    ap.add_argument("--export", action="store_true", help="export web data even for a sample run")
    ap.add_argument("--workdir", default=None,
                    help="isolated run: read <dir>/raw, write everything else under <dir> (used by the upload backend)")
    args = ap.parse_args()
    cfg = yaml.safe_load(open(args.config))
    if args.workdir:
        wd = Path(args.workdir).resolve()
        cfg["paths"].update(raw=str(wd / "raw"), processed=str(wd / "processed"), web_public=str(wd / "out"),
                            web_api=str(wd / "out"), history=str(wd / "history.json"))
    pdir = ROOT / cfg["paths"]["processed"]; pdir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s",
                        handlers=[logging.FileHandler(pdir / "pipeline.log", mode="w"), logging.StreamHandler()])
    log = logging.getLogger("retailiq")
    timings, t0 = {}, time.time()

    class stage:
        def __init__(s, n): s.n = n
        def __enter__(s): s.t = time.time(); log.info(f"=== STAGE START: {s.n} ===")
        def __exit__(s, *a): timings[s.n] = round(time.time() - s.t, 1); log.info(f"=== STAGE END: {s.n} ({timings[s.n]} s) ===")

    spark = (SparkSession.builder.master("local[*]").appName("RetailIQ")
             .config("spark.sql.shuffle.partitions", str(cfg["spark"]["shuffle_partitions"]))
             .config("spark.ui.showConsoleProgress", "false")
             .config("spark.driver.memory", cfg["spark"]["driver_memory"]).getOrCreate())
    spark.sparkContext.setLogLevel("ERROR")
    cores = spark.sparkContext.defaultParallelism
    log.info(f"Spark {spark.version}, master={spark.sparkContext.master}, cores={cores}")

    with stage("1_ingestion"):
        raw, customers, products = ingest.read_sources(spark, cfg, str(ROOT))
        if args.sample:
            raw = raw.sample(fraction=args.sample, seed=1)
        raw = raw.cache()
        n_raw = raw.count(); n_corrupt = raw.filter("_corrupt is not null").count()
        raw = raw.drop("_corrupt")
        prof = ingest.profile(raw, cfg["ingest"]["order_columns"])
        raw_mb = round(os.path.getsize(ROOT / cfg["paths"]["raw"] / "orders.csv") / 1e6, 2)
        ing = {"raw_rows": n_raw, "corrupt_rows": n_corrupt, "customers": customers.count(),
               "products": products.count(), "raw_csv_mb": raw_mb, **prof}
        log.info(f"Ingested orders={n_raw} corrupt={n_corrupt} customers={ing['customers']} products={ing['products']}")

    with stage("2_cleaning"):
        clean_df, quarantine, tagged, cm = clean.clean_orders(raw, customers, products, cfg)
        q_before, comp_cols = quality.score_before(tagged, cm["raw_rows"], cm["after_dedup"], prof["null_profile"])
        q_after = quality.score_after(clean_df, cfg)
        log.info(f"Cleaning: raw={cm['raw_rows']} clean={cm['clean_rows']} quarantined={cm['quarantined']}")

    with stage("3_processing"):
        clean_df = clean_df.cache()
        proc = process.run(clean_df, cfg)
        log.info(f"KPIs: {proc['kpi']}")

    with stage("4_storage"):
        st = storage.write(spark, clean_df, quarantine, proc, cfg, str(ROOT), raw_mb)
        qrows = [[r["order_id"], r["customer_id"], r["product_id"], r["order_date"], r["quantity"], r["unit_price"],
                  r["country"], r["status"], r["reject_reason"], r["rule_id"]] for r in
                 quarantine.orderBy("rule_id", "order_id").collect()]
        log.info(f"Storage: csv={raw_mb}MB parquet={st['parquet_mb']}MB")

    # ground truth comparison (only meaningful on a full run)
    full = not args.sample
    truth_file = ROOT / cfg["paths"]["raw"] / "injected_defects.json"
    ground = []
    if full and truth_file.exists():
        inj = json.load(open(truth_file))
        for r in cm["rules"]:
            if r["injected_key"]:
                det = int(cm["by_rule"].get(r["id"], 0)); ground.append(
                    {"rule": r["id"], "reason": r["reason"], "action": "Quarantined", "injected": inj[r["injected_key"]], "detected": det,
                     "match": det == inj[r["injected_key"]]})
        for name, key, det in [("Exact duplicates removed", "exact_duplicates", cm["duplicates_removed"]),
                               ("Country variants repaired", "country_variants", cm["country_fixes"]),
                               ("Status variants repaired", "status_variants", cm["status_fixes"])]:
            ground.append({"rule": name, "reason": name, "action": "Dropped" if "removed" in name else "Repaired",
                           "injected": inj[key], "detected": det, "match": det == inj[key]})

    with stage("5_export"):
        hist_path = ROOT / cfg["paths"]["history"]
        history = json.load(open(hist_path)) if hist_path.exists() else []
        total = round(time.time() - t0, 1)
        run = {"run_id": f"run-{len(history)+1:03d}", "finished_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
               "mode": f"sample {args.sample}" if args.sample else "full", "spark": spark.version, "cores": cores,
               "raw_rows": n_raw, "clean_rows": cm["clean_rows"], "quarantined": cm["quarantined"],
               "retention_pct": cm["retention_pct"], "total_seconds": total,
               "ground_truth_match": (all(g["match"] for g in ground) if ground else None), "version": __version__}
        history.append(run); history = history[-20:]
        json.dump(history, open(hist_path, "w"), indent=1)
        meta = {"run": run, "timings": timings, "ingestion": ing, "cleaning": cm,
                "quality": {"before": q_before, "after": q_after, "completeness_columns": comp_cols},
                "storage": st, "ground_truth": ground, "history": history,
                "rules_config": cfg["cleaning"]["validation"], "kpi": proc["kpi"]}
        if full or args.export:
            sizes = export.run(proc, qrows, meta, cm, cfg, str(ROOT))
            log.info(f"Exported: {sizes}")
        else:
            log.info("Sample run: web data not exported (use --export to force)")
    timings["5_export"] = round(timings.get("5_export", 0), 1)
    meta["run"]["total_seconds"] = round(time.time() - t0, 1)
    if full or args.export:                       # rewrite meta so timings include the export stage itself
        history[-1]["total_seconds"] = meta["run"]["total_seconds"]; json.dump(history, open(hist_path, "w"), indent=1)
        export._dump(meta, str(ROOT / cfg["paths"]["web_public"] / "meta.json"))
    log.info(f"PIPELINE COMPLETE in {meta['run']['total_seconds']} s")
    spark.stop()


if __name__ == "__main__":
    main()
