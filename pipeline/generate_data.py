"""Generate a synthetic retail-orders dataset with deliberately injected defects.

Synthetic data is used so every defect count is known exactly (written to
data/raw/injected_defects.json) and results are reproducible (fixed seed).

    python pipeline/generate_data.py
"""
import json, random
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"; RAW.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(42); random.seed(42)
N = 250_000; NC = 8_000; NP = 240
cats = ["Electronics","Fashion","Home & Kitchen","Books","Beauty","Sports","Toys","Grocery"]
base = {"Electronics":9000,"Fashion":1800,"Home & Kitchen":2500,"Books":450,"Beauty":900,"Sports":2200,"Toys":700,"Grocery":350}
# ---- products
prod = pd.DataFrame({"product_id":[f"P{i:04d}" for i in range(1,NP+1)]})
prod["category"] = [cats[i % len(cats)] for i in range(NP)]
prod["product_name"] = [f"{c.split()[0]} Item {i:03d}" for i,c in enumerate(prod.category,1)]
prod["list_price"] = [round(float(base[c]*rng.lognormal(0,0.35)),2) for c in prod.category]
prod.to_csv(RAW/"products.csv", index=False)
# ---- customers (JSON lines)
tiers = rng.choice(["Basic","Silver","Gold"], NC, p=[.6,.3,.1])
cities = rng.choice(["Delhi","Mumbai","Bengaluru","Kolkata","Chennai","Hyderabad","Pune","Lucknow","Ghaziabad","Jaipur"], NC)
cust = pd.DataFrame({"customer_id":[f"C{i:05d}" for i in range(1,NC+1)],"city":cities,"tier":tiers,
    "signup_date":pd.to_datetime("2022-01-01")+pd.to_timedelta(rng.integers(0,1000,NC),unit="D")})
cust["signup_date"] = cust.signup_date.dt.strftime("%Y-%m-%d")
with open(RAW/"customers.json","w") as f:
    for r in cust.to_dict("records"): f.write(json.dumps(r)+"\n")
# ---- orders
days = pd.date_range("2024-01-01","2025-12-31")
w = np.linspace(1,1.6,len(days)) * (1+0.35*(days.month.isin([10,11,12])))  # growth + festive season
w = w/w.sum()
d = rng.choice(days, N, p=w)
pid = rng.choice(prod.product_id, N)
price_map = prod.set_index("product_id").list_price
unit_price = (price_map.loc[pid].values * rng.uniform(.95,1.05,N)).round(2)
o = pd.DataFrame({"order_id":[f"O{i:07d}" for i in range(1,N+1)],
    "customer_id":rng.choice(cust.customer_id, N), "product_id":pid,
    "order_date":pd.to_datetime(d), "quantity":rng.choice([1,2,3,4,5],N,p=[.55,.25,.1,.06,.04]),
    "unit_price":unit_price, "discount_pct":rng.choice([0,5,10,15,20],N,p=[.5,.2,.15,.1,.05]),
    "country":rng.choice(["India","USA","UK","Germany","UAE"],N,p=[.62,.14,.1,.08,.06]),
    "payment_method":rng.choice(["UPI","Credit Card","Debit Card","COD","Net Banking"],N,p=[.38,.22,.15,.15,.10]),
    "status":rng.choice(["Delivered","Shipped","Cancelled","Returned"],N,p=[.78,.1,.07,.05])})
# mixed date formats (by design ~ 1/3 each)
fmt = rng.integers(0,3,N); ds = o.order_date
o["order_date"] = np.where(fmt==0, ds.dt.strftime("%Y-%m-%d"), np.where(fmt==1, ds.dt.strftime("%d/%m/%Y"), ds.dt.strftime("%b %d, %Y")))
o = o.astype({"quantity":object,"unit_price":object,"customer_id":object})
def pick(n, exclude=()):
    pool = np.setdiff1d(np.arange(N), np.array(list(exclude),dtype=int)); return rng.choice(pool,n,replace=False)
used=set(); inj={}
def take(name,n):
    idx=pick(n,used); used.update(idx.tolist()); inj[name]=n; return idx
i=take("missing_customer_id",1500); o.loc[i,"customer_id"]=None
i=take("missing_unit_price",1200);  o.loc[i,"unit_price"]=None
i=take("nonpositive_quantity",800); o.loc[i,"quantity"]=rng.choice([0,-1,-2],len(i))
i=take("text_quantity",400);        o.loc[i,"quantity"]=rng.choice(["N/A","two","--"],len(i))
i=take("price_outlier",300);        o.loc[i,"unit_price"]=(o.loc[i,"unit_price"].astype(float)*rng.choice([50,100,250],len(i))).round(2)
i=take("invalid_date",600);         o.loc[i,"order_date"]=rng.choice(["31/02/2025","not available","2025-13-40","00/00/0000"],len(i))
i=take("orphan_customer",450);      o.loc[i,"customer_id"]=[f"C9{j:04d}" for j in range(len(i))]
i=take("orphan_product",250);       o.loc[i,"product_id"]=[f"PX{j:03d}" for j in range(len(i))]
# inconsistent text (repairable, not dropped)
v = {"India":["india","INDIA"," India ","Bharat"],"USA":["usa","U.S.A","United States","US"],"UK":["uk","U.K.","United Kingdom"],"Germany":["germany","GERMANY"],"UAE":["uae","U.A.E"]}
mask = rng.random(N)<.12; inj["country_variants"]=int(mask.sum())
o.loc[mask,"country"] = [random.choice(v[c]) for c in o.loc[mask,"country"]]
mask = rng.random(N)<.08; inj["status_variants"]=int(mask.sum())
o.loc[mask,"status"] = [random.choice([s.lower(),s.upper()," "+s]) for s in o.loc[mask,"status"]]
# duplicates
D = 5000; dup = o.sample(D, random_state=1); inj["exact_duplicates"]=D
o = pd.concat([o,dup]).sample(frac=1, random_state=7).reset_index(drop=True)
o.to_csv(RAW/"orders.csv", index=False)
json.dump(inj, open(RAW/"injected_defects.json","w"), indent=1)
print(len(o), inj)
