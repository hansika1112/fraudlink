import csv, html, io, json, logging, os, time
from collections import defaultdict
from datetime import date
from typing import Optional
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from . import analysis, db, sample

log = logging.getLogger("fraudlink")  # never log addresses/notes of victims
app = FastAPI(title="FraudLink API", version="1.0.0", description=analysis.DISCLAIMER)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("FRAUDLINK_CORS_ORIGINS", "http://localhost:5173").split(","),
                   allow_methods=["*"], allow_headers=["*"])
_hits = defaultdict(list)

def err(status, code, msg): return JSONResponse(status_code=status, content={"error": {"code": code, "message": msg}})

@app.middleware("http")
async def guard(request: Request, call_next):
    limit = int(os.getenv("FRAUDLINK_RATE_LIMIT_PER_MIN", "120"))
    ip, now = (request.client.host if request.client else "?"), time.time()
    _hits[ip] = [t for t in _hits[ip] if now - t < 60]
    if len(_hits[ip]) >= limit:
        return err(429, "rate_limited", "Too many requests")
    _hits[ip].append(now)
    try:
        return await call_next(request)
    except Exception:
        log.exception("unhandled error")
        return err(500, "internal_error", "Unexpected server error")

@app.exception_handler(HTTPException)
async def http_exc(_, e): return err(e.status_code, "http_error", str(e.detail))

@app.on_event("startup")
def _startup(): db.init()

def _log(c, ev): c.execute("INSERT INTO activity(event) VALUES(?)", (ev,))

class WalletReport(BaseModel):
    address: str; chain: str = "ethereum"; report_date: date
    category: str = Field(..., min_length=2, max_length=60)
    tx_hash: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)

@app.get("/api/health", tags=["system"])
def health(): return {"status": "ok", "disclaimer": analysis.DISCLAIMER}

@app.post("/api/wallets", status_code=201, tags=["wallets"])
def report_wallet(w: WalletReport):
    try: a = analysis.normalize_address(w.address, w.chain)
    except ValueError as e: raise HTTPException(422, str(e))
    with db.conn() as c:
        c.execute("INSERT INTO reported_wallets(address,chain,report_date,category,tx_hash,notes) VALUES(?,?,?,?,?,?)",
                  (a, w.chain.lower(), w.report_date.isoformat(), w.category, w.tx_hash, w.notes))
        _log(c, "Wallet reported")
    return {"address": a, "status": "recorded"}

@app.get("/api/wallets", tags=["wallets"])
def list_reported():
    with db.conn() as c:
        return [dict(r) for r in c.execute("SELECT id,address,chain,report_date,category FROM reported_wallets ORDER BY id DESC")]

@app.post("/api/transactions/import", tags=["transactions"])
async def import_csv(file: UploadFile = File(...)):
    max_b = int(float(os.getenv("FRAUDLINK_MAX_UPLOAD_MB", "5")) * 1024 * 1024)
    if not (file.filename or "").lower().endswith(".csv"): raise HTTPException(415, "Only .csv files are accepted")
    raw = await file.read(max_b + 1)
    if len(raw) > max_b: raise HTTPException(413, "File exceeds size limit")
    try: rows, errors, dup = analysis.parse_csv(raw)
    except ValueError as e: raise HTTPException(422, str(e))
    with db.conn() as c:
        before = c.total_changes
        c.executemany("INSERT OR IGNORE INTO transactions VALUES(:tx_hash,:chain,:ts,:sender,:receiver,:amount,:fee,:synthetic)", rows)
        inserted = c.total_changes - before
        _log(c, f"Imported {inserted} transactions")
    return {"inserted": inserted, "already_in_database": len(rows) - inserted, "duplicates_in_file": dup,
            "malformed_rows": len(errors), "errors": errors[:50]}

def _filters(date_from, date_to, chain, min_amount, address=None):
    q, p = " WHERE 1=1", []
    if date_from: q += " AND ts>=?"; p.append(date_from)
    if date_to: q += " AND ts<=?"; p.append(date_to)
    if chain: q += " AND chain=?"; p.append(chain.lower())
    if min_amount: q += " AND amount>=?"; p.append(min_amount)
    if address: q += " AND (sender=? OR receiver=?)"; p += [address, address]
    return q, p

@app.get("/api/transactions", tags=["transactions"])
def list_tx(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500), date_from: str = None,
            date_to: str = None, chain: str = None, min_amount: float = None, address: str = None):
    q, p = _filters(date_from, date_to, chain, min_amount, address)
    with db.conn() as c:
        total = c.execute("SELECT COUNT(*) FROM transactions" + q, p).fetchone()[0]
        rows = c.execute("SELECT * FROM transactions" + q + " ORDER BY ts DESC LIMIT ? OFFSET ?", p + [page_size, (page - 1) * page_size]).fetchall()
    return {"total": total, "page": page, "page_size": page_size, "items": [dict(r) for r in rows]}

@app.get("/api/wallets/{address}/neighborhood", tags=["wallets"])
def neighborhood(address: str, limit: int = Query(200, le=1000)):
    a = address.strip().lower() if address.lower().startswith("0x") else address.strip()
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM transactions WHERE sender=? OR receiver=? ORDER BY ts DESC LIMIT ?", (a, a, limit))]
    if not rows: raise HTTPException(404, "Wallet not found in transaction data")
    nb = sorted({r["receiver"] if r["sender"] == a else r["sender"] for r in rows})
    return {"address": a, "transactions": rows, "neighbors": nb}

def _cluster_rows():
    with db.conn() as c: return [json.loads(r["payload"]) for r in c.execute("SELECT payload FROM clusters")]

@app.get("/api/graph", tags=["graph"])
def graph(date_from: str = None, date_to: str = None, chain: str = None, min_amount: float = None,
          risk_level: str = None, max_edges: int = Query(2000, le=5000)):
    q, p = _filters(date_from, date_to, chain, min_amount)
    with db.conn() as c:
        rows = c.execute("SELECT sender,receiver,COUNT(*) n,SUM(amount) amt FROM transactions" + q + " GROUP BY sender,receiver ORDER BY amt DESC LIMIT ?", p + [max_edges]).fetchall()
        labels = {r["address"]: r["label"] for r in c.execute("SELECT address,label FROM labels")}
    cmap = {m: (cl["cluster_id"], cl["risk_level"]) for cl in _cluster_rows() for m in cl["members"]}
    nodes = {}
    for r in rows:
        for a in (r["sender"], r["receiver"]):
            n = nodes.setdefault(a, {"id": a, "activity": 0, "cluster_id": cmap.get(a, (None, "unclustered"))[0],
                                     "risk_level": cmap.get(a, (None, "unclustered"))[1], "label": labels.get(a)})
            n["activity"] += r["n"]
    if risk_level: nodes = {k: v for k, v in nodes.items() if v["risk_level"] == risk_level}
    edges = [{"source": r["sender"], "target": r["receiver"], "tx_count": r["n"], "amount": r["amt"]}
             for r in rows if r["sender"] in nodes and r["receiver"] in nodes]
    return {"nodes": list(nodes.values()), "edges": edges}

@app.post("/api/clusters/analyze", tags=["clusters"])
def run_analysis(min_size: int = Query(3, ge=2, le=50)):
    with db.conn() as c:
        tx = pd.read_sql("SELECT * FROM transactions", c)
        if tx.empty: raise HTTPException(409, "No transactions imported yet")
        labels = {r["address"]: r["label"] for r in c.execute("SELECT address,label FROM labels")}
        rep = {r["address"] for r in c.execute("SELECT address FROM reported_wallets")}
        res = analysis.analyze(tx, labels, rep, min_size=min_size)
        c.execute("DELETE FROM clusters")
        c.executemany("INSERT INTO clusters VALUES(?,?)", [(r["cluster_id"], json.dumps(r)) for r in res])
        _log(c, f"Analysis run: {len(res)} clusters")
    return {"clusters": len(res), "summary": [{k: r[k] for k in ("cluster_id", "size", "score", "risk_level", "evidence_strength")} for r in res]}

@app.get("/api/clusters", tags=["clusters"])
def list_clusters(search: str = None, risk_level: str = None):
    cl = _cluster_rows()
    if risk_level: cl = [c for c in cl if c["risk_level"] == risk_level]
    if search: cl = [c for c in cl if search.lower() in c["cluster_id"].lower() or any(search.lower() in m for m in c["members"])]
    return sorted(({k: c[k] for k in ("cluster_id", "size", "volume", "tx_count", "reported_count", "score", "risk_level", "evidence_strength")} for c in cl), key=lambda c: -c["score"])

@app.get("/api/clusters/{cluster_id}", tags=["clusters"])
def cluster_detail(cluster_id: str):
    with db.conn() as c:
        r = c.execute("SELECT payload FROM clusters WHERE cluster_id=?", (cluster_id,)).fetchone()
    if not r: raise HTTPException(404, "Cluster not found; run analysis first")
    return json.loads(r["payload"])

@app.get("/api/stats", tags=["system"])
def stats():
    with db.conn() as c:
        q = lambda s: c.execute(s).fetchone()[0]
        recent = [dict(r) for r in c.execute("SELECT event,created_at FROM activity ORDER BY id DESC LIMIT 10")]
        out = {"reported_wallets": q("SELECT COUNT(*) FROM reported_wallets"), "transactions": q("SELECT COUNT(*) FROM transactions"), "recent_activity": recent}
    cl = _cluster_rows()
    out.update({"clusters": len(cl), "high_priority": sum(c["risk_level"] == "high" for c in cl),
                "risk_distribution": {lv: sum(c["risk_level"] == lv for c in cl) for lv in ("high", "medium", "low")}})
    return out

@app.post("/api/demo/load", tags=["system"])
def load_demo():
    rows, labels, rep = sample.generate()
    with db.conn() as c:
        c.executemany("INSERT OR IGNORE INTO transactions VALUES(:transaction_hash,'ethereum',:timestamp,:sender_address,:receiver_address,:amount,:transaction_fee,1)", rows)
        c.executemany("INSERT OR REPLACE INTO labels VALUES(?,?,1)", labels.items())
        have = {r[0] for r in c.execute("SELECT address FROM reported_wallets")}
        c.executemany("INSERT INTO reported_wallets(address,chain,report_date,category,notes) VALUES(?, 'ethereum','2026-03-01','SYNTHETIC DEMO','synthetic')", [(a,) for a in rep if a not in have])
        _log(c, "Synthetic demo data loaded")
    return {"transactions": len(rows), "note": "All records are SYNTHETIC and not real evidence."}

@app.get("/api/reports", tags=["reports"])
def report(format: str = Query("html", pattern="^(html|csv|json)$"), cluster_id: str = None):
    cl = [c for c in _cluster_rows() if not cluster_id or c["cluster_id"] == cluster_id]
    if not cl: raise HTTPException(404, "No clusters to report; run analysis first")
    if format == "json": return cl
    if format == "csv":
        buf = io.StringIO(); w = csv.writer(buf)
        w.writerow(["cluster_id", "risk_level", "score", "evidence_strength", "wallet_address", "is_labeled_endpoint"])
        for c in cl:
            ends = {e["address"] for e in c["labeled_endpoints"]}
            for m in c["members"]: w.writerow([c["cluster_id"], c["risk_level"], c["score"], c["evidence_strength"], m, m in ends])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=fraudlink_report.csv"})
    e, parts = html.escape, []
    for c in cl:
        li = lambda xs: "".join(f"<li>{e(x)}</li>" for x in xs)
        tr = "".join(f"<tr><td>{e(t['tx_hash'])}</td><td>{e(t['sender'])}</td><td>{e(t['receiver'])}</td><td>{t['amount']}</td></tr>" for t in c["top_transactions"])
        parts.append(f"<h2>{e(c['cluster_id'])} &mdash; {e(c['risk_level']).upper()} (score {c['score']}, evidence {e(c['evidence_strength'])})</h2>"
                     f"<h3>Observed facts</h3><ul>{li(c['observed_facts'])}</ul><h3>Heuristic signals</h3><ul>{li(c['heuristic_signals'])}</ul>"
                     f"<h3>Unverified hypotheses</h3><ul>{li(c['unverified_hypotheses'])}</ul><h3>Score breakdown</h3><p>{e(json.dumps(c['score_breakdown']))}</p>"
                     f"<h3>Supporting transactions</h3><table border=1 cellpadding=4><tr><th>Hash</th><th>From</th><th>To</th><th>Amount</th></tr>{tr}</table>"
                     f"<h3>Next steps</h3><ul>{li(c['next_steps'])}</ul>")
    body = ("<html><head><title>FraudLink Report</title><style>body{font-family:sans-serif;max-width:900px;margin:auto}td{font-size:11px;word-break:break-all}</style></head><body>"
            f"<h1>FraudLink Investigation Report</h1><p><b>Disclaimer:</b> {e(analysis.DISCLAIMER)}</p>"
            f"<p><b>Limitations:</b> Analysis covers only supplied data; labels are as supplied; demo data is synthetic.</p>{''.join(parts)}</body></html>")
    return Response(body, media_type="text/html")

@app.get("/api/anomalies", tags=["analysis"])
def anomalies(top: int = Query(20, ge=1, le=100)):
    from . import anomaly
    with db.conn() as c: tx = pd.read_sql("SELECT * FROM transactions", c)
    return {"method": "IsolationForest (unsupervised)", "note": "Statistical outliers only; not evidence of wrongdoing.",
            "items": anomaly.detect(tx, top)}

@app.get("/api/sample-csv", tags=["transactions"])
def sample_csv():
    rows, _, _ = sample.generate(); buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=synthetic_transactions.csv"})

@app.get("/api/reports/pdf", tags=["reports"])
def report_pdf(cluster_id: str = None):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    cl = [c for c in _cluster_rows() if not cluster_id or c["cluster_id"] == cluster_id]
    if not cl: raise HTTPException(404, "No clusters to report; run analysis first")
    st = getSampleStyleSheet(); small = st["BodyText"].clone("s"); small.fontSize = 6.5; small.leading = 8
    P = lambda t, s=st["BodyText"]: Paragraph(html.escape(str(t)), s)
    el = [Paragraph("FraudLink Investigation Report", st["Title"]), P("Disclaimer: " + analysis.DISCLAIMER),
          P("Limitations: analysis covers only supplied data; exchange labels are as supplied; demo data is synthetic.")]
    for c in cl:
        el += [Spacer(1, 10), P(f"{c['cluster_id']} - {c['risk_level'].upper()} (score {c['score']}, evidence {c['evidence_strength']})", st["Heading2"])]
        for title, key in (("Observed facts", "observed_facts"), ("Heuristic signals", "heuristic_signals"),
                           ("Unverified hypotheses", "unverified_hypotheses"), ("Next steps", "next_steps")):
            el += [P(title, st["Heading4"])] + [P("- " + x) for x in c[key]]
        el.append(P("Score breakdown: " + json.dumps(c["score_breakdown"])))
        data = [[P(h, small) for h in ("Tx hash", "From", "To", "Amount")]] + [[P(t["tx_hash"], small), P(t["sender"], small), P(t["receiver"], small), P(t["amount"], small)] for t in c["top_transactions"]]
        tb = Table(data, colWidths=[130, 130, 130, 50]); tb.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), .25, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        el.append(tb)
    buf = io.BytesIO(); SimpleDocTemplate(buf, pagesize=A4, title="FraudLink Report").build(el)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=fraudlink_report.pdf"})

@app.post("/api/reset", tags=["system"])
def reset_data():
    with db.conn() as c:
        for tb in ("transactions", "reported_wallets", "labels", "clusters", "activity"): c.execute(f"DELETE FROM {tb}")
    return {"status": "all data cleared"}
