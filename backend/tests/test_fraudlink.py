import os, tempfile
os.environ["FRAUDLINK_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["FRAUDLINK_RATE_LIMIT_PER_MIN"] = "10000"
import pandas as pd, pytest
from fastapi.testclient import TestClient
from app import analysis, sample
from app.main import app

def test_address_validation():
    a = sample.addr("x")
    assert analysis.normalize_address(a, "ethereum") == a
    with pytest.raises(ValueError): analysis.normalize_address("0x123", "ethereum")
    with pytest.raises(ValueError): analysis.normalize_address(a, "dogecoin")

def test_csv_parsing_flags_bad_rows_and_dupes():
    r, _, _ = sample.generate(); good = r[0]
    hdr = "transaction_hash,timestamp,sender_address,receiver_address,amount,blockchain\n"
    line = lambda h, amt: f"{h},{good['timestamp']},{good['sender_address']},{good['receiver_address']},{amt},ethereum\n"
    rows, errs, dup = analysis.parse_csv((hdr + line("h1", 5) + line("h1", 5) + line("h2", -1) + line("h3", "abc")).encode())
    assert len(rows) == 1 and dup == 1 and len(errs) == 2
    with pytest.raises(ValueError): analysis.parse_csv(b"a,b\n1,2\n")

def test_clustering_finds_synthetic_groups():
    rows, labels, rep = sample.generate()
    df = pd.DataFrame(rows).rename(columns={"transaction_hash": "tx_hash", "timestamp": "ts", "sender_address": "sender", "receiver_address": "receiver"})
    cl = analysis.analyze(df, labels, set(rep))
    assert cl and cl[0]["risk_level"] == "high"
    assert all("NOT proof" in c["disclaimer"] for c in cl)
    assert any(c["labeled_endpoints"] for c in cl) and any(c["aggregation_candidates"] for c in cl)

def test_api_flow():
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200
        assert c.post("/api/clusters/analyze").status_code == 409
        assert c.post("/api/demo/load").status_code == 200
        r = c.post("/api/clusters/analyze"); assert r.status_code == 200 and r.json()["clusters"] >= 3
        cid = c.get("/api/clusters").json()[0]["cluster_id"]
        assert c.get(f"/api/clusters/{cid}").json()["cluster_id"] == cid
        assert c.get("/api/clusters/nope").status_code == 404
        assert c.get("/api/transactions?page_size=5").json()["total"] > 100
        g = c.get("/api/graph").json(); assert g["nodes"] and g["edges"]
        assert c.get("/api/reports?format=csv").status_code == 200
        assert "FraudLink" in c.get("/api/reports?format=html").text
        bad = c.post("/api/wallets", json={"address": "bad", "chain": "ethereum", "report_date": "2026-03-01", "category": "phishing"})
        assert bad.status_code == 422
        assert c.post("/api/transactions/import", files={"file": ("x.txt", b"a")}).status_code == 415
        assert c.get("/api/stats").json()["high_priority"] >= 1

def test_anomaly_pdf_sample():
    with TestClient(app) as c:
        c.post("/api/demo/load"); c.post("/api/clusters/analyze")
        a = c.get("/api/anomalies?top=5").json()
        assert len(a["items"]) == 5 and 0 <= a["items"][0]["anomaly_score"] <= 1
        p = c.get("/api/reports/pdf"); assert p.status_code == 200 and p.content[:4] == b"%PDF"
        assert c.get("/api/sample-csv").text.startswith("transaction_hash")

def test_cluster_extras_and_reset():
    with TestClient(app) as c:
        c.post("/api/demo/load"); c.post("/api/clusters/analyze")
        d = c.get("/api/clusters").json()[0]
        det = c.get(f"/api/clusters/{d['cluster_id']}").json()
        assert det["timeline"] and det["edges"] and det["wallets"] and det["graph_nodes"]
        assert "rapid_pass_through" in det["score_breakdown"] and sum(det["score_breakdown"].values()) <= 100
        assert any(w["pass_through"] for cl in c.get("/api/reports?format=json").json() for w in cl["wallets"])
        assert c.post("/api/reset").status_code == 200 and c.get("/api/stats").json()["transactions"] == 0
