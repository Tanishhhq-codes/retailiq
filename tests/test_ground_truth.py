"""Integration test: the exported results of the last FULL pipeline run must equal the injected defects.

Run `python pipeline/run_pipeline.py` first. This turns the report's claim ("every count matched
exactly") into a check that fails the build if a rule regresses.
"""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "public" / "data" / "meta.json"
TRUTH = ROOT / "data" / "raw" / "injected_defects.json"

pytestmark = pytest.mark.skipif(not (META.exists() and TRUTH.exists()), reason="run the full pipeline first")


@pytest.fixture(scope="module")
def meta():
    return json.load(open(META))


def test_every_rule_detects_exactly_what_was_injected(meta):
    truth = json.load(open(TRUTH))
    by_rule = meta["cleaning"]["by_rule"]
    for r in meta["cleaning"]["rules"]:
        if r["injected_key"]:
            assert by_rule.get(r["id"], 0) == truth[r["injected_key"]], r["id"]
    assert meta["cleaning"]["duplicates_removed"] == truth["exact_duplicates"]
    assert meta["cleaning"]["country_fixes"] == truth["country_variants"]
    assert meta["cleaning"]["status_fixes"] == truth["status_variants"]


def test_row_accounting_balances(meta):
    c = meta["cleaning"]
    assert c["raw_rows"] - c["duplicates_removed"] - c["quarantined"] == c["clean_rows"]
    assert sum(c["reasons"].values()) == c["quarantined"]


def test_quarantine_file_matches_metrics(meta):
    q = json.load(open(ROOT / "api" / "_data" / "quarantine.json"))
    assert len(q["rows"]) == meta["cleaning"]["quarantined"]


def test_cube_totals_match_kpi(meta):
    cube = json.load(open(ROOT / "public" / "data" / "cube.json"))
    st = cube["dims"]["status"]; ful = {st.index(s) for s in ("Delivered", "Shipped")}
    rev = sum(r[7] for r in cube["rows"] if r[4] in ful)
    assert abs(rev - meta["kpi"]["revenue"]) < 1.0


def test_clean_data_scores_perfect_on_independent_checks(meta):
    assert all(v == 100.0 for v in meta["quality"]["after"].values())
