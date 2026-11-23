"""Light statistical analytics on the Spark aggregates (numpy only; no heavy ML dependency).

Forecast: log(monthly revenue) ~ intercept + trend + festive-season (Oct-Dec) dummy, fitted by
least squares. With only 24 monthly points a richer model would overfit, so the model is kept
small and validated with a hold-out backtest (fit on the first 21 months, predict the last 3).

Anomalies: robust z-score of daily revenue against its own centred rolling median.
"""
import numpy as np
import pandas as pd


def _design(months):
    t = np.arange(len(months), dtype=float)
    festive = np.array([int(m[5:7]) in (10, 11, 12) for m in months], dtype=float)
    return np.column_stack([np.ones(len(t)), t, festive])


def forecast(monthly, horizon):
    months = [m["order_month"] for m in monthly]
    y = np.log([m["revenue"] for m in monthly])

    def fit(n):
        X = _design(months[:n]); beta, *_ = np.linalg.lstsq(X, y[:n], rcond=None)
        resid = y[:n] - X @ beta
        return beta, float(resid.std(ddof=X.shape[1]))

    # hold-out backtest
    n_tr = len(months) - 3
    beta_b, _ = fit(n_tr)
    pred_b = np.exp(_design(months)[n_tr:] @ beta_b); act = np.exp(y[n_tr:])
    mape = float(np.mean(np.abs(pred_b - act) / act) * 100)

    beta, sd = fit(len(months))
    last = pd.Period(months[-1], "M")
    fut = [str(last + i) for i in range(1, horizon + 1)]
    Xf = _design(months + fut)[len(months):]
    mu = Xf @ beta
    z = 1.645
    return {
        "method": "log-linear trend + festive-season (Oct-Dec) dummy, least squares",
        "mape_holdout_pct": round(mape, 2), "growth_per_month_pct": round((np.exp(beta[1]) - 1) * 100, 2),
        "festive_uplift_pct": round((np.exp(beta[2]) - 1) * 100, 1),
        "fitted": [{"month": m, "revenue": round(float(np.exp(v)), 0)} for m, v in zip(months, _design(months) @ beta)],
        "forecast": [{"month": m, "revenue": round(float(np.exp(v)), 0),
                      "low": round(float(np.exp(v - z * sd)), 0), "high": round(float(np.exp(v + z * sd)), 0)}
                     for m, v in zip(fut, mu)],
    }


def anomalies(daily, window, z_thr):
    df = pd.DataFrame(daily); df["d"] = pd.to_datetime(df["d"]); df = df.set_index("d").asfreq("D")
    df["revenue"] = df["revenue"].fillna(0.0)
    exp = df["revenue"].rolling(window, center=True, min_periods=window // 4).median()
    lr = np.log((df["revenue"] + 1) / (exp + 1))
    mad = float(np.median(np.abs(lr - lr.median()))) or 1e-9
    z = (lr - lr.median()) / (1.4826 * mad)
    df["expected"] = exp; df["z"] = z; df["flag"] = z.abs() > z_thr
    pts = [{"d": d.strftime("%Y-%m-%d"), "revenue": round(float(r.revenue), 0), "expected": round(float(r.expected), 0),
            "z": round(float(r.z), 2)} for d, r in df[df.flag].iterrows()]
    series = [{"d": d.strftime("%Y-%m-%d"), "revenue": round(float(r.revenue), 0), "expected": round(float(r.expected), 0),
               "flag": bool(r.flag)} for d, r in df.iterrows()]
    return {"threshold": z_thr, "window_days": window, "series": series, "flagged": pts}
