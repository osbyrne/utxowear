import { CheckoutError } from "./domain";

export interface CheckoutDatabase {
  prepare(query: string): {
    bind(...values: (string | null)[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first<T>(): Promise<T | null>;
    };
  };
}

type OrderRow = { status: string; printify_order_id: string | null };

/** A pending row may be claimed exactly once; a network attempt never becomes automatically retryable. */
export async function claimOrder(
  db: CheckoutDatabase,
  sessionId: string,
): Promise<"claimed" | "created"> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO checkout_orders (session_id, printify_order_id, status, updated_at) VALUES (?, NULL, 'pending', ?)",
    )
    .bind(sessionId, new Date().toISOString())
    .run();
  const claim = await db
    .prepare(
      "UPDATE checkout_orders SET status = 'submitting', updated_at = ? WHERE session_id = ? AND status = 'pending'",
    )
    .bind(new Date().toISOString(), sessionId)
    .run();
  if (claim.meta.changes === 1) return "claimed";
  const row = await db
    .prepare("SELECT status, printify_order_id FROM checkout_orders WHERE session_id = ?")
    .bind(sessionId)
    .first<OrderRow>();
  if (row?.status === "created" && row.printify_order_id) return "created";
  console.error(
    `[Checkout] MANUAL RECONCILIATION REQUIRED: session=${sessionId}, status=${row?.status ?? "missing"}. Search Printify orders for external_id=${sessionId}; if found set status='created' and printify_order_id to the actual order ID. If confirmed absent, set status='pending' to allow one deliberate retry. Never clear or delete the row without checking Printify first.`,
  );
  throw new CheckoutError(
    "Order requires manual reconciliation. Contact support with your Stripe session ID.",
    503,
  );
}

export async function markOrderCreated(
  db: CheckoutDatabase,
  sessionId: string,
  orderId: string,
): Promise<void> {
  try {
    const result = await db
      .prepare(
        "UPDATE checkout_orders SET status = 'created', printify_order_id = ?, updated_at = ? WHERE session_id = ? AND status = 'submitting'",
      )
      .bind(orderId, new Date().toISOString(), sessionId)
      .run();
    if (result.meta.changes === 1) return;
  } catch (error) {
    console.error(
      `[Checkout] D1 update failed after Printify created order ${orderId} for Stripe session ${sessionId}:`,
      error,
    );
  }
  console.error(
    `[Checkout] MANUAL RECONCILIATION REQUIRED: Printify order ${orderId} exists for session ${sessionId}, but its D1 record was not marked created. Set status='created', printify_order_id='${orderId}' after confirming the order in Printify.`,
  );
  throw new CheckoutError("Order state could not be saved; manual reconciliation required.", 503);
}

export async function markOrderUncertain(
  db: CheckoutDatabase,
  sessionId: string,
  reason: unknown,
): Promise<never> {
  try {
    await db
      .prepare(
        "UPDATE checkout_orders SET status = 'uncertain', updated_at = ? WHERE session_id = ? AND status = 'submitting'",
      )
      .bind(new Date().toISOString(), sessionId)
      .run();
  } catch (dbError) {
    console.error(`[Checkout] Failed to record uncertainty for ${sessionId}:`, dbError);
  }
  console.error(
    `[Checkout] MANUAL RECONCILIATION REQUIRED: Printify creation outcome uncertain for Stripe session ${sessionId}. Search Printify orders for external_id=${sessionId} before any attempt to retry. Mark D1 status='created' with Printify ID if found; only set status='pending' if absence is confirmed.`,
    reason,
  );
  throw new CheckoutError(
    "Order requires manual reconciliation. Contact support with your Stripe session ID.",
    503,
  );
}
