"""Deterministic SYNTHETIC dataset. Nothing here is real-world evidence."""
import csv, hashlib, random, sys
from datetime import datetime, timedelta, timezone

def addr(tag): return "0x" + hashlib.sha1(tag.encode()).hexdigest()
LABELS = {addr("EXCH-A"): "SYNTH-EXCH-A", addr("EXCH-B"): "SYNTH-EXCH-B"}

def generate(seed=7):
    rnd, rows, n = random.Random(seed), [], [0]
    base = datetime(2026, 3, 1, tzinfo=timezone.utc)
    def tx(s, r, amt, t):
        n[0] += 1
        rows.append({"transaction_hash": "0x" + hashlib.sha256(f"syn{n[0]}".encode()).hexdigest(),
                     "timestamp": t.isoformat(), "sender_address": addr(s), "receiver_address": addr(r),
                     "amount": round(amt, 4), "blockchain": "ethereum",
                     "transaction_fee": round(rnd.uniform(.0005, .003), 5), "synthetic": 1})
    reported = []
    for g, sink in enumerate(["EXCH-A", "EXCH-B", "SINK-X"]):
        t0 = base + timedelta(days=10 * g)
        vics = [f"G{g}-V{i}" for i in range(6)]; mids = [f"G{g}-M{i}" for i in range(3)]
        for v in vics:
            for m in rnd.sample(mids, 2):
                tx(v, m, rnd.uniform(1, 9), t0 + timedelta(hours=rnd.uniform(0, 20)))
        for m in mids:
            for _ in range(2):
                tx(m, sink, rnd.uniform(5, 20), t0 + timedelta(hours=rnd.uniform(20, 30)))
        reported += [addr(vics[0]), addr(mids[0])]
    normal = [f"N{i}" for i in range(40)]
    for _ in range(120):
        a, b = rnd.sample(normal, 2)
        tx(a, b, rnd.uniform(.1, 5), base + timedelta(days=rnd.uniform(0, 60)))
    for _ in range(5):  # legitimate users also deposit to the exchange-like endpoint
        tx(rnd.choice(normal), "EXCH-A", rnd.uniform(.5, 3), base + timedelta(days=rnd.uniform(0, 60)))
    return rows, LABELS, reported

if __name__ == "__main__":
    rows, _, _ = generate()
    with open(sys.argv[1] if len(sys.argv) > 1 else "sample_data/synthetic_transactions.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
