"""Load your own data into the pipeline.

    python pipeline/prepare_data.py --orders my_orders.csv --customers my_customers.json --products my_products.csv
    python pipeline/run_pipeline.py          # then rebuild the site data
    npm run dev                              # view it at http://localhost:5173

Files are validated, re-written into data/raw/ in the layout the pipeline expects, and every problem is
reported at once. Any previous generated dataset in data/raw/ is replaced.
"""
import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import yaml
from retailiq import intake

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--orders", required=True, help="orders CSV with a header row")
    ap.add_argument("--customers", required=True, help="customers as JSON lines or CSV")
    ap.add_argument("--products", required=True, help="products CSV with a header row")
    ap.add_argument("--config", default=str(ROOT / "pipeline" / "rules.yaml"))
    ap.add_argument("--out", default=None, help="output folder (default: the raw folder in rules.yaml)")
    a = ap.parse_args()
    cfg = yaml.safe_load(open(a.config))
    out = Path(a.out) if a.out else ROOT / cfg["paths"]["raw"]
    try:
        n = intake.prepare(a.orders, a.customers, a.products, out, cfg["ingest"]["order_columns"])
    except intake.Invalid as e:
        print("Your files need fixing:", *[f"  - {m}" for m in e.errors], sep="\n"); sys.exit(1)
    print(f"Ready in {out}: {n['orders']:,} orders, {n['customers']:,} customers, {n['products']:,} products.")
    print("Next: python pipeline/run_pipeline.py   then   npm run dev")
    print("Note: the pipeline needs at least 8 months of orders for the forecast; extend the country map and\n"
          "date formats in pipeline/rules.yaml if your data uses other spellings or formats.")


if __name__ == "__main__":
    main()
