"""RetailIQ upload backend.

Vercel cannot run Spark, so uploads are handled by this small service, which runs on a machine that has
Java and PySpark (see Dockerfile.backend). Flow:

    POST /api/upload  ->  validate + normalise the three files  ->  background job runs
                          `pipeline/run_pipeline.py --workdir jobs/<id>`
    GET  /api/jobs/<id>              status and per-stage progress
    GET  /api/jobs/<id>/data/<file>  meta.json | analytics.json | cube.json | quarantine.json

Every upload is an isolated job directory, so it never touches the demo data or other users' results.
Run locally:  uvicorn backend.app:app --port 8000
"""
import csv, io, json, os, re, shutil, subprocess, sys, threading, time, uuid
from pathlib import Path

import yaml
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load(open(ROOT / "pipeline" / "rules.yaml"))
ORDER_COLS = CFG["ingest"]["order_columns"]
CUSTOMER_COLS = ["customer_id", "city", "tier", "signup_date"]
PRODUCT_REQUIRED = ["product_id", "category"]
PRODUCT_OPTIONAL = ["product_name", "list_price"]
STAGES = ["1_ingestion", "2_cleaning", "3_processing", "4_storage", "5_export"]
DATA_FILES = {"meta.json", "analytics.json", "cube.json", "quarantine.json"}

JOBS = Path(os.environ.get("RETAILIQ_JOBS_DIR", ROOT / "jobs"))
MAX_BYTES = int(float(os.environ.get("RETAILIQ_MAX_UPLOAD_MB", "50")) * 1e6)
TTL_SECONDS = float(os.environ.get("RETAILIQ_JOB_TTL_HOURS", "24")) * 3600
TIMEOUT = int(os.environ.get("RETAILIQ_JOB_TIMEOUT_S", "900"))
MAX_QUEUE = int(os.environ.get("RETAILIQ_MAX_QUEUE", "4"))
ORIGINS = [o.strip() for o in os.environ.get("RETAILIQ_CORS_ORIGINS", "*").split(",") if o.strip()]
JOB_ID = re.compile(r"^[0-9a-f]{12}$")

JOBS.mkdir(parents=True, exist_ok=True)
RUN_SLOT = threading.Semaphore(1)        # Spark is heavy: one pipeline at a time, the rest wait in the queue
_active = 0
_lock = threading.Lock()

app = FastAPI(title="RetailIQ upload backend", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])


# ---------------------------------------------------------------- helpers
def _norm(h: str) -> str:
    return h.replace("﻿", "").strip().lower()


class Invalid(Exception):
    def __init__(self, errors): self.errors = errors


async def _save(up: UploadFile, dest: Path, label: str):
    """Stream an upload to disk, enforcing the size limit."""
    size = 0
    with open(dest, "wb") as f:
        while chunk := await up.read(1 << 20):
            size += len(chunk)
            if size > MAX_BYTES:
                raise Invalid([f"{label}: file is larger than {MAX_BYTES // 1_000_000} MB."])
            f.write(chunk)
    if size == 0:
        raise Invalid([f"{label}: file is empty."])


def _open_text(path: Path):
    return open(path, "r", encoding="utf-8-sig", errors="replace", newline="")


def _check_csv(src: Path, dst: Path, label: str, required, optional=(), order=None):
    """Re-write a CSV with normalised header names. If `order` is given the output has exactly those columns
    in that order (the Spark reader maps order columns by position)."""
    with _open_text(src) as fi:
        rd = csv.reader(fi)
        header = next(rd, None)
        if not header:
            raise Invalid([f"{label}: no header row."])
        idx = {}
        for i, h in enumerate(header):
            idx.setdefault(_norm(h), i)
        missing = [c for c in required if c not in idx]
        if missing:
            raise Invalid([f"{label}: missing column(s) {', '.join(missing)}. Found: {', '.join(_norm(h) for h in header)}."])
        cols = list(order) if order else list(required) + [c for c in optional if c in idx]
        pick = [idx[c] for c in cols] if order is None else [idx.get(c) for c in cols]
        n = 0
        with open(dst, "w", encoding="utf-8", newline="") as fo:
            w = csv.writer(fo); w.writerow(cols)
            for row in rd:
                if not any(c.strip() for c in row):
                    continue
                w.writerow([(row[i] if i is not None and i < len(row) else "") for i in pick]); n += 1
    if n == 0:
        raise Invalid([f"{label}: no data rows."])
    return n


def _check_customers(src: Path, dst: Path):
    label = "customers"
    with _open_text(src) as f:
        first = f.read(1)
        while first and first.isspace():
            first = f.read(1)
    n = 0
    if first == "{":                                       # JSON lines
        with _open_text(src) as fi, open(dst, "w", encoding="utf-8") as fo:
            for ln, line in enumerate(fi, 1):
                if not line.strip():
                    continue
                try:
                    rec = {_norm(k): v for k, v in json.loads(line).items()}
                except (ValueError, AttributeError):
                    raise Invalid([f"{label}: line {ln} is not a JSON object."])
                missing = [c for c in CUSTOMER_COLS if c not in rec]
                if missing:
                    raise Invalid([f"{label}: line {ln} is missing {', '.join(missing)}."])
                fo.write(json.dumps({c: (None if rec[c] is None else str(rec[c])) for c in CUSTOMER_COLS}) + "\n"); n += 1
    else:                                                  # CSV, converted to JSON lines for the pipeline
        tmp = dst.with_suffix(".csv.tmp")
        _check_csv(src, tmp, label, CUSTOMER_COLS)
        with _open_text(tmp) as fi, open(dst, "w", encoding="utf-8") as fo:
            for rec in csv.DictReader(fi):
                fo.write(json.dumps({c: rec[c] or None for c in CUSTOMER_COLS}) + "\n"); n += 1
        tmp.unlink()
    if n == 0:
        raise Invalid([f"{label}: no records."])
    return n


def _status_path(d: Path): return d / "status.json"


def _write_status(d: Path, **kw):
    p = _status_path(d)
    cur = json.loads(p.read_text()) if p.exists() else {}
    cur.update(kw)
    tmp = p.with_suffix(".tmp"); tmp.write_text(json.dumps(cur)); tmp.replace(p)


def _stage_progress(d: Path):
    done, current = [], None
    log = d / "run.log"
    if log.exists():
        text = log.read_text(errors="replace")
        for m in re.finditer(r"=== STAGE (START|END): (\w+)", text):
            kind, name = m.groups()
            if kind == "START": current = name
            elif name not in done: done.append(name); current = None if current == name else current
    return done, current


def _error_line(d: Path) -> str:
    log = d / "run.log"
    if not log.exists():
        return "The pipeline did not start."
    lines = [l.strip() for l in log.read_text(errors="replace").splitlines() if l.strip()]
    for l in reversed(lines):
        if re.match(r"^([\w.]+\.)?\w*(Error|Exception)\b", l):
            return l[:400]
    return (lines[-1] if lines else "The pipeline failed.")[:400]


def _run_job(d: Path):
    global _active
    try:
        RUN_SLOT.acquire()
        _write_status(d, state="running", started=time.time())
        env = {**os.environ, "SPARK_LOCAL_IP": "127.0.0.1", "PYTHONUNBUFFERED": "1"}
        with open(d / "run.log", "w") as log:
            proc = subprocess.Popen([sys.executable, str(ROOT / "pipeline" / "run_pipeline.py"), "--workdir", str(d)],
                                    stdout=log, stderr=subprocess.STDOUT, env=env, cwd=str(ROOT))
            try:
                code = proc.wait(timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                proc.kill(); proc.wait(); code = -9
        ok = code == 0 and (d / "out" / "meta.json").exists()
        if ok:
            _write_status(d, state="done", finished=time.time())
        else:
            msg = f"The run exceeded the {TIMEOUT} s limit." if code == -9 else _error_line(d)
            _write_status(d, state="failed", finished=time.time(), error=msg)
    except Exception as e:                                  # never leave a job stuck in "running"
        _write_status(d, state="failed", finished=time.time(), error=f"{type(e).__name__}: {e}")
    finally:
        RUN_SLOT.release()
        with _lock: _active -= 1


def _cleanup():
    now = time.time()
    for d in JOBS.iterdir():
        sp = _status_path(d)
        try:
            if d.is_dir() and JOB_ID.match(d.name) and sp.exists() and json.loads(sp.read_text()).get("state") in ("done", "failed") \
                    and now - sp.stat().st_mtime > TTL_SECONDS:
                shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass


def _job_dir(job_id: str) -> Path:
    if not JOB_ID.match(job_id):
        raise HTTPException(404, "Unknown job.")
    d = JOBS / job_id
    if not _status_path(d).exists():
        raise HTTPException(404, "Unknown or expired job.")
    return d


# ---------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return {"status": "ok", "java": shutil.which("java") is not None, "active_jobs": _active,
            "max_upload_mb": MAX_BYTES // 1_000_000, "order_columns": ORDER_COLS, "customer_columns": CUSTOMER_COLS,
            "product_columns": PRODUCT_REQUIRED, "ttl_hours": TTL_SECONDS / 3600}


@app.post("/api/upload", status_code=202)
async def upload(orders: UploadFile = File(...), customers: UploadFile = File(...), products: UploadFile = File(...)):
    global _active
    if not shutil.which("java"):
        raise HTTPException(503, "Java is not installed on the server, so Spark cannot run.")
    with _lock:
        if _active >= MAX_QUEUE:
            raise HTTPException(429, "The server is busy. Try again in a few minutes.")
        _active += 1
    job_id = uuid.uuid4().hex[:12]
    d = JOBS / job_id
    started = False
    try:
        (d / "incoming").mkdir(parents=True); (d / "raw").mkdir()
        inc = d / "incoming"
        for up, name, label in ((orders, "orders", "orders"), (customers, "customers", "customers"), (products, "products", "products")):
            await _save(up, inc / name, label)
        errors, counts = [], {}
        for label, fn in (("orders", lambda: _check_csv(inc / "orders", d / "raw" / "orders.csv", "orders", ORDER_COLS, order=ORDER_COLS)),
                          ("customers", lambda: _check_customers(inc / "customers", d / "raw" / "customers.json")),
                          ("products", lambda: _check_csv(inc / "products", d / "raw" / "products.csv", "products", PRODUCT_REQUIRED, PRODUCT_OPTIONAL))):
            try: counts[label] = fn()
            except Invalid as e: errors += e.errors
        if errors:
            raise Invalid(errors)
        shutil.rmtree(inc, ignore_errors=True)
        _write_status(d, state="queued", created=time.time(), rows=counts)
        threading.Thread(target=_run_job, args=(d,), daemon=True).start()
        started = True
        _cleanup()
        return {"job_id": job_id, "rows": counts}
    except Invalid as e:
        shutil.rmtree(d, ignore_errors=True)
        return JSONResponse({"errors": e.errors}, status_code=422)
    finally:
        if not started:
            shutil.rmtree(d, ignore_errors=True)
            with _lock: _active -= 1


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    d = _job_dir(job_id)
    st = json.loads(_status_path(d).read_text())
    done, current = _stage_progress(d)
    return {"job_id": job_id, "state": st["state"], "stages": STAGES, "completed": done, "current": current,
            "rows": st.get("rows"), "error": st.get("error"),
            "seconds": round((st.get("finished") or time.time()) - st["started"], 1) if st.get("started") else 0}


@app.get("/api/jobs/{job_id}/data/{name}")
def job_data(job_id: str, name: str):
    d = _job_dir(job_id)
    if name not in DATA_FILES:
        raise HTTPException(404, "Unknown file.")
    f = d / "out" / name
    if not f.exists():
        raise HTTPException(404, "Results are not ready yet.")
    return FileResponse(f, media_type="application/json", headers={"Cache-Control": "public, max-age=300"})
