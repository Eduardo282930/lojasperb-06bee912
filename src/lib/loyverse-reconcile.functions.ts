import { createServerFn } from "@tanstack/react-start";
import { receiptPages } from "./loyverse-sync.functions";

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

export type ReconcileResult = {
  ok: boolean;
  refundsApplied: number;
  resynced: number;
  reason?: string;
};

export async function reconcileWithLoyverse(hours = 72): Promise<ReconcileResult> {
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
      .limit(50);

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
  async (): Promise<ReconcileResult> => reconcileWithLoyverse(72),
);
