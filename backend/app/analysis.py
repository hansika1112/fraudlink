"""Validation, graph construction, clustering and explainable scoring."""
import csv, hashlib, io, math, re
import networkx as nx
import pandas as pd
from networkx.algorithms.community import louvain_communities

PATTERNS = {
    "ethereum": re.compile(r"^0x[0-9a-fA-F]{40}$"),
    "bitcoin": re.compile(r"^(bc1[0-9a-z]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$"),
}
REQUIRED = ["transaction_hash", "timestamp", "sender_address", "receiver_address", "amount", "blockchain"]
DISCLAIMER = ("Cluster scores are investigative leads derived from statistical/graph signals. "
              "They are NOT proof of wrongdoing and do not establish that wallets share an owner.")

def normalize_address(addr, chain):
    chain = (chain or "").strip().lower()
    addr = (addr or "").strip()
    pat = PATTERNS.get(chain)
    if pat is None:
        raise ValueError(f"unsupported blockchain: {chain!r}")
    if not pat.match(addr):
        raise ValueError("invalid address format")
    return addr.lower() if chain == "ethereum" else addr

def parse_csv(raw: bytes):
    """Return (valid_rows, row_errors, duplicate_count). Raises ValueError on bad header/encoding."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("file is not valid UTF-8 text")
    rd = csv.DictReader(io.StringIO(text))
    missing = [c for c in REQUIRED if c not in (rd.fieldnames or [])]
    if missing:
        raise ValueError(f"missing required columns: {missing}")
    rows, errors, seen, dup = [], [], set(), 0
    for i, r in enumerate(rd, start=2):
        try:
            chain = r["blockchain"].strip().lower()
            s = normalize_address(r["sender_address"], chain)
            t = normalize_address(r["receiver_address"], chain)
            if s == t:
                raise ValueError("self-transfer")
            ts = pd.Timestamp(r["timestamp"])
            ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
            amt = float(r["amount"])
            if not math.isfinite(amt) or amt <= 0:
                raise ValueError("amount must be a positive number")
            fee = float(r["transaction_fee"]) if r.get("transaction_fee") else None
            h = r["transaction_hash"].strip()
            if not h:
                raise ValueError("empty transaction_hash")
        except Exception as e:
            errors.append({"row": i, "error": str(e)})
            continue
        if (h, chain) in seen:
            dup += 1
            continue
        seen.add((h, chain))
        rows.append(dict(tx_hash=h, ts=ts.isoformat(), sender=s, receiver=t, amount=amt, chain=chain,
                         fee=fee, synthetic=int(str(r.get("synthetic") or "0").strip().lower() in ("1", "true"))))
    return rows, errors, dup

def _densest_window_ratio(times, hours=24):
    t = sorted(times)
    best, j = 0, 0
    for i in range(len(t)):
        while t[i] - t[j] > pd.Timedelta(hours=hours):
            j += 1
        best = max(best, i - j + 1)
    return best / len(t) if t else 0.0

def analyze(tx: pd.DataFrame, labels: dict, reported: set, min_size=3, seed=42):
    """Cluster wallets with Louvain and score each cluster with transparent components."""
    if tx.empty:
        return []
    tx = tx.copy()
    tx["ts"] = pd.to_datetime(tx["ts"], utc=True)
    G = nx.Graph()
    for (a, b), g in tx.groupby(["sender", "receiver"]):
        w = 1 + math.log1p(g.amount.sum())  # log-damped so whales don't dominate
        if G.has_edge(a, b):
            G[a][b]["w"] += w
        else:
            G.add_edge(a, b, w=w)
    out = []
    for comm in louvain_communities(G, weight="w", seed=seed):
        S = set(comm)
        if len(S) < min_size:
            continue
        touch = tx[tx.sender.isin(S) | tx.receiver.isin(S)]
        ext = {}
        for r in touch.itertuples():
            if r.sender in S and r.receiver not in S:
                ext.setdefault(r.receiver, set()).add(r.sender)
            elif r.receiver in S and r.sender not in S:
                ext.setdefault(r.sender, set()).add(r.receiver)
        shared = {e: sorted(m) for e, m in ext.items() if len(m) >= 2}
        recv = touch[touch.sender.isin(S)].groupby("receiver").sender.nunique()
        labeled = [{"address": a, "label": labels[a], "member_senders": int(n)}
                   for a, n in recv.items() if a in labels and n >= 2]
        sink_cands = []
        for a, n in recv.items():
            if a in labels or n < 3:
                continue
            if tx[tx.sender == a].receiver.nunique() <= 1:
                sink_cands.append({"address": a, "member_senders": int(n)})
        rep_n = len(S & reported)
        burst = _densest_window_ratio(list(touch.ts)) if len(touch) >= 5 else 0.0
        flows = {}
        for r in touch.itertuples():
            if r.receiver in S:
                d = flows.setdefault(r.receiver, {"in": 0.0, "out": 0.0, "n_in": 0, "last_in": None, "first_out": None})
                d["in"] += r.amount
                d["n_in"] += 1
                d["last_in"] = r.ts if d["last_in"] is None or r.ts > d["last_in"] else d["last_in"]
            if r.sender in S:
                d = flows.setdefault(r.sender, {"in": 0.0, "out": 0.0, "n_in": 0, "last_in": None, "first_out": None})
                d["out"] += r.amount
                d["first_out"] = r.ts if d["first_out"] is None or r.ts < d["first_out"] else d["first_out"]
        passers = {a for a, d in flows.items() if a not in labels and d["in"] > 0 and d["out"] >= 0.8 * d["in"]
                   and d["first_out"] is not None and d["n_in"] >= 2
                   and pd.Timedelta(0) <= (d["first_out"] - d["last_in"]) <= pd.Timedelta(hours=12)}
        comp = {
            "reported_wallets": round(min(rep_n, 3) / 3 * 25, 1),
            "known_label_endpoint": 25.0 if labeled else 0.0,
            "shared_counterparties": round(min(len(shared), 5) / 5 * 15, 1),
            "rapid_pass_through": round(min(len(passers), 3) / 3 * 15, 1),
            "temporal_burst": round(10 * max(0.0, (burst - 0.3) / 0.7), 1),
            "unlabeled_aggregation_pattern": 10.0 if sink_cands else 0.0,
        }
        score = round(sum(comp.values()), 1)
        level = "high" if score >= 60 and rep_n >= 1 else "medium" if score >= 35 else "low"
        strength = "strong" if rep_n >= 2 and labeled else "moderate" if rep_n >= 1 or labeled else "weak"
        top = touch.sort_values("amount", ascending=False).head(10)
        facts = [f"{len(S)} wallets in cluster; {len(touch)} transactions observed; total volume {touch.amount.sum():.4f}.",
                 f"{rep_n} wallet(s) in this cluster were reported by victims/investigators."]
        facts += [f"{l['member_senders']} cluster wallets sent funds to {l['address']} (supplied label: {l['label']})." for l in labeled]
        heur = [f"{len(shared)} external counterparties interact with 2+ cluster wallets (shared-counterparty signal)."]
        if burst:
            heur.append(f"{burst:.0%} of activity falls inside a single 24h window (temporal-proximity signal).")
        if passers:
            heur.append(f"{len(passers)} wallet(s) forward at least 80% of funds received within 12h after the last receipt (after 2+ incoming transfers) (pass-through / layering signal).")
        hyp = [f"{s['address']} receives from {s['member_senders']} cluster wallets and forwards to at most one address: "
               "possible aggregation/cash-out endpoint. UNVERIFIED; requires external attribution." for s in sink_cands]
        hyp.append("Wallets may be related only through shared counterparties; common ownership is not established.")
        steps = ["Verify reported wallets against victim statements and original transaction hashes."]
        if labeled or sink_cands:
            steps.append("Submit endpoint address(es) for exchange attribution / formal records request via proper legal process.")
        steps.append("Review top transactions and trace onward flows beyond the dataset window.")
        edge_ids = {x for (a, b), _ in touch.groupby(["sender", "receiver"]) for x in (a, b)}
        out.append({
            "graph_nodes": [{"id": n, "member": n in S, "reported": n in reported, "label": labels.get(n)} for n in sorted(edge_ids)],
            "cluster_id": "C-" + hashlib.sha1("".join(sorted(S)).encode()).hexdigest()[:8],
            "size": len(S), "members": sorted(S), "volume": round(float(touch.amount.sum()), 4),
            "tx_count": int(len(touch)), "reported_count": rep_n, "score": score, "risk_level": level,
            "evidence_strength": strength, "score_breakdown": comp,
            "observed_facts": facts, "heuristic_signals": heur, "unverified_hypotheses": hyp,
            "labeled_endpoints": labeled, "aggregation_candidates": sink_cands,
            "shared_counterparties": [{"address": a, "linked_members": m} for a, m in shared.items()],
            "top_transactions": [{"tx_hash": r.tx_hash, "sender": r.sender, "receiver": r.receiver,
                                  "amount": r.amount, "timestamp": r.ts.isoformat()} for r in top.itertuples()],
            "next_steps": steps, "disclaimer": DISCLAIMER,
            "wallets": [{"address": m, "reported": m in reported, "label": labels.get(m),
                         "total_in": round(flows.get(m, {}).get("in", 0.0), 4), "total_out": round(flows.get(m, {}).get("out", 0.0), 4),
                         "pass_through": m in passers} for m in sorted(S)],
            "timeline": [{"date": d, "tx": int(g.shape[0]), "volume": round(float(g.amount.sum()), 4)}
                         for d, g in touch.groupby(touch.ts.dt.strftime("%Y-%m-%d"))],
            "edges": [{"source": a, "target": b, "amount": round(float(g.amount.sum()), 4), "count": int(len(g))}
                      for (a, b), g in sorted(touch.groupby(["sender", "receiver"]), key=lambda kv: -kv[1].amount.sum())[:60]],
        })
    return sorted(out, key=lambda c: -c["score"])
