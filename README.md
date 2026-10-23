# FraudLink – Fraud-Linked Exchange Clustering

Graph-based, explainable clustering of reported crypto wallets. **Scores are investigative leads, not proof of wrongdoing.**
All bundled data is **SYNTHETIC**; the app works fully offline and calls no external blockchain APIs.

## Run
    cd backend && pip install -r requirements.txt
    cp ../.env.example .env   # optional; env vars are read from the environment
    uvicorn app.main:app --reload      # docs: http://localhost:8000/docs
    python -m pytest -q

Quick demo: `POST /api/demo/load` then `POST /api/clusters/analyze`, then `GET /api/clusters`, `/api/graph`, `/api/reports?format=html|csv`.

## Frontend (React + Vite + Tailwind + Recharts + Cytoscape)
    cd frontend && npm install && npm run dev     # http://localhost:5173 (proxies /api to :8000)
Start the backend first. On the Overview page click "Load synthetic demo data", then "Run cluster analysis".
Pages: Overview, Report Wallet, Transaction Explorer, Network Graph, Cluster Analysis, Investigation Reports (PDF/CSV/HTML/JSON), Data Import, Settings & Methodology (includes optional IsolationForest anomaly detection, `GET /api/anomalies`).

## CSV schema
Required: transaction_hash, timestamp (ISO 8601), sender_address, receiver_address, amount (>0), blockchain (ethereum|bitcoin).
Optional: transaction_fee, synthetic. Sample: `backend/sample_data/synthetic_transactions.csv`.

## Methodology
1. Addresses validated/normalised per chain; malformed rows and duplicate hashes reported in the import summary.
2. Undirected weighted graph (edge weight = 1 + ln(1 + total amount), damping whales); Louvain communities (seeded, reproducible).
3. Per-cluster score (0–100), fully itemised in `score_breakdown`: reported wallets (25), supplied exchange label receiving from 2+ members (25),
   shared counterparties (15), rapid pass-through (15), 24h temporal burst (10), unlabeled aggregation pattern (10). Medium ≥35; High needs ≥60 AND at least one reported wallet.
4. Output separates **observed facts**, **heuristic signals**, **unverified hypotheses**. Exchange labels come only from supplied labels.

## Limitations / roadmap
Only supplied data is analysed; Louvain is heuristic; no UTXO co-spend heuristics; in-memory rate limiter; SQLite only (schema is portable to PostgreSQL).
Anomaly scores are unsupervised outliers, not risk indicators. Graph rendering is best below ~2,000 edges.
