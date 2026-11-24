"""Upload-backend validation tests (no Spark needed): header matching, column reordering, customers formats."""
import csv, json, sys
from pathlib import Path
import pytest

pytest.importorskip("fastapi")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import app as be  # noqa: E402

ORDER_HDR = be.ORDER_COLS


def _w(p, text): p.write_text(text, encoding="utf-8"); return p


def test_orders_header_is_matched_ignoring_case_bom_and_order(tmp_path):
    hdr = ",".join(reversed([c.upper() for c in ORDER_HDR]))
    row = ",".join(str(i) for i in range(len(ORDER_HDR)))
    src = _w(tmp_path / "o.csv", "﻿" + hdr + "\n" + row + "\n\n")
    n = be._check_csv(src, tmp_path / "out.csv", "orders", ORDER_HDR, order=ORDER_HDR)
    out = list(csv.reader(open(tmp_path / "out.csv")))
    assert n == 1 and out[0] == ORDER_HDR
    assert out[1][ORDER_HDR.index("status")] == "0"          # reversed input -> status was the first column


def test_orders_missing_columns_are_reported(tmp_path):
    src = _w(tmp_path / "o.csv", "order_id,foo\n1,2\n")
    with pytest.raises(be.Invalid) as e:
        be._check_csv(src, tmp_path / "out.csv", "orders", ORDER_HDR, order=ORDER_HDR)
    assert "customer_id" in e.value.errors[0] and "Found: order_id, foo" in e.value.errors[0]


def test_short_rows_are_padded_not_crashed(tmp_path):
    src = _w(tmp_path / "o.csv", ",".join(ORDER_HDR) + "\nO1,C1\n")
    be._check_csv(src, tmp_path / "out.csv", "orders", ORDER_HDR, order=ORDER_HDR)
    assert list(csv.reader(open(tmp_path / "out.csv")))[1][:3] == ["O1", "C1", ""]


def test_header_only_file_is_rejected(tmp_path):
    src = _w(tmp_path / "o.csv", ",".join(ORDER_HDR) + "\n")
    with pytest.raises(be.Invalid):
        be._check_csv(src, tmp_path / "out.csv", "orders", ORDER_HDR, order=ORDER_HDR)


def test_products_keep_optional_columns_only_when_present(tmp_path):
    src = _w(tmp_path / "p.csv", "Product_ID,Category,junk\nP1,Books,x\n")
    be._check_csv(src, tmp_path / "out.csv", "products", be.PRODUCT_REQUIRED, be.PRODUCT_OPTIONAL)
    assert list(csv.reader(open(tmp_path / "out.csv")))[0] == ["product_id", "category"]


def test_customers_jsonl_and_csv_both_become_json_lines(tmp_path):
    j = _w(tmp_path / "c.json", '{"Customer_ID":"C1","city":"Delhi","tier":"Gold","signup_date":"2023-01-01"}\n')
    be._check_customers(j, tmp_path / "a.json")
    assert json.loads((tmp_path / "a.json").read_text())["customer_id"] == "C1"
    c = _w(tmp_path / "c.csv", "customer_id,city,tier,signup_date\nC2,Pune,Basic,2023-02-02\n")
    be._check_customers(c, tmp_path / "b.json")
    assert json.loads((tmp_path / "b.json").read_text())["city"] == "Pune"


def test_customers_missing_key_names_the_line(tmp_path):
    j = _w(tmp_path / "c.json", '{"customer_id":"C1","city":"Delhi"}\n')
    with pytest.raises(be.Invalid) as e:
        be._check_customers(j, tmp_path / "a.json")
    assert "line 1" in e.value.errors[0] and "tier" in e.value.errors[0]


def test_job_ids_cannot_traverse():
    assert not be.JOB_ID.match("../etc") and not be.JOB_ID.match("a" * 11) and be.JOB_ID.match("0123456789ab")
