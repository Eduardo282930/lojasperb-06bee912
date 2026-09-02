import { createServerFn } from "@tanstack/react-start";

/**
 * Loyverse → SPERB.
 *
 * Roda periodicamente (e pode ser chamada pelo Admin) para manter os dois lados
 * iguais, sem sobrescrever pedidos internos:
 * - reembolso feito no app do Loyverse cancela o pedido aqui, devolve as moedas
 *   e libera o cupom (uma única vez, pelo id do reembolso);
 * - pedidos pagos que ficaram sem recibo são reprocessados.
 *
 * A devolução do dinheiro no InfinitePay não é automática (a API não oferece
 * estorno), então o pedido fica marcado como "devolução financeira pendente".
 */

type AnyRpc = (name: string, args?: Record<string, unknown>) => Promise<{ data?: unknown }>;

type Receipt = {
  receipt_number?: string;
  receipt_type?: string | null;
  refund_for?: string | null;
  order?: string | null;
  created_at?: string | null;
};

type ReceiptPage = {
  receipts?: Receipt[];
  cursor?: string | null;
};

async function loyverse<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.loyverse.com/v1.0/${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Loyverse ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** Lê todas as páginas para não deixar um REFUND antigo escapar do limite 250. */
async function receiptPages(token: string, since: string): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  let cursor = "";
  do {
    const params = new URLSearchParams({ limit: "250", created_at_min: since });
    if (cursor) params.set("cursor", cursor);
    const page = await loyverse<ReceiptPage>(`receipts?${params.toString()}`, token);
    receipts.push(...(page.receipts ?? []));
    cursor = page.cursor ?? "";
  } while (cursor);
  return receipts;
}

export type ReconcileResult = {
  ok: boolean;
  refundsApplied: number;
  resynced: number;
  reason?: string;
};

export async function reconcileWithLoyverse(hours = 24 * 90): Promise<ReconcileResult> {
  const token = process.env["LOYVERSE_TOKEN"];
  if (!token) return { ok: false, refundsApplied: 0, resynced: 0, reason: "no_token" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as AnyRpc;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  let refundsApplied = 0;
  let resynced = 0;

  /* 1) Reembolsos registrados no Loyverse. */
  try {
    const receipts = await receiptPages(token, since);
    const refunds = receipts.filter(
      (r) => (r.receipt_type ?? "").toUpperCase() === "REFUND",
    );

    for (const refund of refunds) {
      const saleId = refund.refund_for;
      const refundId = refund.receipt_number;
      if (!saleId || !refundId) continue;

      const { data: rawOrder } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("loyverse_receipt_id", saleId)
        .maybeSingle();
      const order = rawOrder as unknown as
        | { id: string; loyverse_refund_id?: string | null }
        | null;

      if (!order || order.loyverse_refund_id) {
        continue; // sem pedido correspondente ou já processado
      }

      const applied = await rpc("cancel_order_from_refund", {
        p_order_id: order.id,
        p_refund_id: refundId,
        p_money_refunded: false, // InfinitePay não estorna pela API
      });
      if (applied.data === true) refundsApplied += 1;
    }
  } catch (err) {
    console.error("[reconcile] reembolsos:", err);
  }

  /* 2) Pedidos pagos que ainda não viraram recibo. */
  try {
    const { data: pending } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("payment_status", "paid")
      .is("loyverse_receipt_id", null)
      .gte("created_at", since)
      .limit(20);

    if (pending && pending.length > 0) {
      const { syncPaidOrder } = await import("@/lib/loyverse-sync.functions");
      for (const order of pending) {
        const result = await syncPaidOrder(order.id);
        if (result.ok) resynced += 1;
      }
    }
  } catch (err) {
    console.error("[reconcile] reenvio:", err);
  }

  return { ok: true, refundsApplied, resynced };
}

export const runLoyverseReconcile = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReconcileResult> => reconcileWithLoyverse(),
);
