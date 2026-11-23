"""Unit tests for the cleaning stage on a handful of hand-written rows (fast, no data files needed)."""
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from retailiq.clean import clean_orders  # noqa: E402

COLS = ["order_id", "customer_id", "product_id", "order_date", "quantity", "unit_price",
        "discount_pct", "country", "payment_method", "status"]


@pytest.fixture(scope="module")
def spark():
    from pyspark.sql import SparkSession
    s = (SparkSession.builder.master("local[1]").appName("tests")
         .config("spark.sql.shuffle.partitions", "2").config("spark.ui.enabled", "false").getOrCreate())
    yield s
    s.stop()


@pytest.fixture(scope="module")
def cfg():
    return yaml.safe_load(open(ROOT / "pipeline" / "rules.yaml"))


def run(spark, cfg, rows):
    raw = spark.createDataFrame(rows, ", ".join(f"{c} string" for c in COLS))  # explicit: an all-None column can't be inferred
    customers = spark.createDataFrame([("C1", "Delhi", "Gold", "2023-01-01")], ["customer_id", "city", "tier", "signup_date"])
    products = spark.createDataFrame([("P1", "Books", 100.0), ("P2", "Books", 100.0)], ["product_id", "category", "list_price"])
    clean, quarantine, _, m = clean_orders(raw, customers, products, cfg)
    return clean.collect(), {r["order_id"]: r["rule_id"] for r in quarantine.collect()}, m


def good(oid, **kw):
    base = dict(order_id=oid, customer_id="C1", product_id="P1", order_date="2024-03-05", quantity="2",
                unit_price="100", discount_pct="0", country="India", payment_method="UPI", status="Delivered")
    base.update(kw)
    return tuple(base[c] for c in COLS)


def test_valid_row_passes_through(spark, cfg):
    clean, q, m = run(spark, cfg, [good("O1")])
    assert len(clean) == 1 and not q
    assert clean[0]["revenue"] == 200.0 and clean[0]["order_month"] == "2024-03"


@pytest.mark.parametrize("fmt", ["2024-03-05", "05/03/2024", "Mar 05, 2024"])
def test_three_date_formats_parse_to_same_day(spark, cfg, fmt):
    clean, _, _ = run(spark, cfg, [good("O1", order_date=fmt)])
    assert str(clean[0]["order_dt"]) == "2024-03-05"


@pytest.mark.parametrize("oid,kw,rule", [
    ("a", dict(customer_id=None), "missing_customer_id"),
    ("b", dict(unit_price=None), "missing_unit_price"),
    ("c", dict(quantity="two"), "non_numeric_quantity"),
    ("d", dict(quantity="0"), "non_positive_quantity"),
    ("e", dict(order_date="31/02/2024"), "invalid_date"),
    ("f", dict(product_id="PX1"), "orphan_product"),
    ("g", dict(customer_id="C99"), "orphan_customer"),
])
def test_each_rule_quarantines_with_its_own_id(spark, cfg, oid, kw, rule):
    clean, q, _ = run(spark, cfg, [good("ok"), good(oid, **kw)])
    assert q == {oid: rule} and len(clean) == 1


def test_price_outlier_uses_per_product_median(spark, cfg):
    rows = [good(f"o{i}", unit_price="100") for i in range(9)] + [good("big", unit_price="900")]
    _, q, _ = run(spark, cfg, rows)
    assert q == {"big": "price_outlier"}


def test_expensive_product_is_not_a_false_positive(spark, cfg):
    # P2 legitimately costs far more than P1; a per-category rule would flag it, the per-product rule must not
    rows = [good(f"a{i}", unit_price="100") for i in range(5)] + [good(f"b{i}", product_id="P2", unit_price="900") for i in range(5)]
    _, q, _ = run(spark, cfg, rows)
    assert not q


def test_duplicates_dropped_and_spelling_repaired(spark, cfg):
    rows = [good("O1"), good("O1"), good("O2", country=" Bharat ", status=" DELIVERED")]
    clean, q, m = run(spark, cfg, rows)
    assert m["duplicates_removed"] == 1 and len(clean) == 2
    by = {r["order_id"]: r for r in clean}
    assert by["O2"]["country"] == "India" and by["O2"]["status"] == "Delivered"
    assert m["country_fixes"] == 1 and m["status_fixes"] == 1


def test_first_failing_rule_wins_and_row_counted_once(spark, cfg):
    _, q, m = run(spark, cfg, [good("x", customer_id=None, unit_price=None, quantity="0")])
    assert q == {"x": "missing_customer_id"} and m["quarantined"] == 1


def test_pre_signup_is_flagged_not_rejected(spark, cfg):
    clean, q, m = run(spark, cfg, [good("early", order_date="2022-06-01")])
    assert not q and clean[0]["pre_signup"] is True and m["advisory"]["order_before_signup"] == 1


def test_disabling_a_rule_in_config_changes_behaviour(spark, cfg):
    import copy
    c2 = copy.deepcopy(cfg)
    for r in c2["cleaning"]["validation"]:
        if r["id"] == "non_positive_quantity":
            r["enabled"] = False
    clean, q, _ = run(spark, c2, [good("z", quantity="0")])
    assert not q and len(clean) == 1
