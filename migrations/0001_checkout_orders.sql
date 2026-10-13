CREATE TABLE IF NOT EXISTS checkout_orders (
  session_id TEXT PRIMARY KEY,
  printify_order_id TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
