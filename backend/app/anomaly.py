"""Optional unsupervised outlier detection (IsolationForest) on wallet behaviour features.
Outliers are statistical curiosities for triage only; they are NOT indicators of wrongdoing."""
import numpy as np, pandas as pd
from sklearn.ensemble import IsolationForest

def detect(tx: pd.DataFrame, top=20, seed=42):
    if len(tx) < 20:
        return []
    tx = tx.copy(); tx["ts"] = pd.to_datetime(tx["ts"], utc=True)
    o = tx.groupby("sender").agg(out_deg=("receiver", "nunique"), total_out=("amount", "sum"))
    i = tx.groupby("receiver").agg(in_deg=("sender", "nunique"), total_in=("amount", "sum"))
    both = pd.concat([tx[["sender", "ts"]].set_axis(["w", "ts"], axis=1), tx[["receiver", "ts"]].set_axis(["w", "ts"], axis=1)])
    g = both.groupby("w").ts
    f = o.join(i, how="outer").fillna(0)
    f["tx_count"] = both.groupby("w").size()
    f["span_hours"] = (g.max() - g.min()).dt.total_seconds() / 3600
    f["flow_ratio"] = f.total_out / (f.total_in + 1)
    X = np.log1p(f[["in_deg", "out_deg", "total_in", "total_out", "tx_count", "span_hours", "flow_ratio"]].clip(lower=0))
    m = IsolationForest(n_estimators=200, random_state=seed).fit(X)
    s = -m.score_samples(X)
    f["anomaly_score"] = (s - s.min()) / ((s.max() - s.min()) or 1)
    f = f.sort_values("anomaly_score", ascending=False).head(top)
    return [{"address": a, "anomaly_score": round(float(r.anomaly_score), 3), "in_degree": int(r.in_deg), "out_degree": int(r.out_deg),
             "total_in": round(float(r.total_in), 4), "total_out": round(float(r.total_out), 4), "tx_count": int(r.tx_count),
             "span_hours": round(float(r.span_hours), 1)} for a, r in f.iterrows()]
