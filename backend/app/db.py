import os, sqlite3
def db_path(): return os.getenv("FRAUDLINK_DB_PATH", "./fraudlink.db")
def conn():
    c = sqlite3.connect(db_path()); c.row_factory = sqlite3.Row; return c
def init():
    with conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS transactions(tx_hash TEXT, chain TEXT, ts TEXT, sender TEXT, receiver TEXT,
            amount REAL, fee REAL, synthetic INTEGER DEFAULT 0, PRIMARY KEY(tx_hash, chain));
        CREATE INDEX IF NOT EXISTS ix_s ON transactions(sender); CREATE INDEX IF NOT EXISTS ix_r ON transactions(receiver);
        CREATE TABLE IF NOT EXISTS reported_wallets(id INTEGER PRIMARY KEY, address TEXT, chain TEXT, report_date TEXT,
            category TEXT, tx_hash TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS labels(address TEXT PRIMARY KEY, label TEXT, synthetic INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS clusters(cluster_id TEXT PRIMARY KEY, payload TEXT);
        CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, event TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        """)
