import { createFileRoute } from "@tanstack/react-router";

/**
 * Loyverse → SPERB em tempo real.
 *
 * Este é o canal PRINCIPAL de sincronização: o Loyverse chama esta URL sempre
 * que um recibo é criado/atualizado ou o estoque muda. A reconciliação
 * periódica (`/api/public/loyverse-reconcile`) fica só como rede de segurança
 * caso algum aviso se perca.
 *
 * Tudo é idempotente: reprocessar o mesmo evento não cria venda, não devolve
 * moedas de novo e não libera cupom duas vezes.
 */

type Receipt = {
  receipt_number?: string;
  receipt_type?: string | null;
  refund_for?: string | null;
  order?: string | null;
  cancelled_at?: string | null;
};

type AnyRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data?: unknown; error?: { message: string } | null }>;

/** Etiqueta gravada pelo app no recibo: SPERB-xxxxxxxx (8 primeiros do pedido). */
function orderPrefixFromTag(tag: string | null | undefined): string {
  const match = /^SPERB-([0-9a-fA-F]{8})$/.exec(String(tag ?? "").trim());
  return match?.[1]?.toLowerCase() ?? "";
}

async function handle(request: Request): Promise<Response> {
  const secret = process.env["LOYVERSE_WEBHOOK_SECRET"];
  if (secret) {
    const url = new URL(request.url);
    const provided =
      url.searchParams.get("key") ?? request.headers.get("x-sperb-key") ?? "";
    if (provided !== secret) return new Response("unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc as unknown as AnyRpc;

  let receiptsHandled = 0;
  let refundsApplied = 0;

  const receipts = Array.isArray(payload["receipts"])
    ? (payload["receipts"] as Receipt[])
    : [];

  for (const receipt of receipts) {
    const type = (receipt.receipt_type ?? "SALE").toUpperCase();

    /* Reembolso/cancelamento feito no Loyverse cancela o pedido aqui. */
    if (type === "REFUND" || receipt.cancelled_at) {
      const saleId = receipt.refund_for ?? receipt.receipt_number;
      const refundId = receipt.receipt_number;
      if (!saleId || !refundId) continue;
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("loyverse_receipt_id", saleId)
        .maybeSingle();
      if (!order) continue;
      const applied = await rpc("cancel_order_from_refund", {
        p_order_id: order.id,
        p_refund_id: refundId,
        p_money_refunded: false, // InfinitePay não estorna pela API
      });
      if (applied.data === true) refundsApplied += 1;
      continue;
    }

    /* Venda do app confirmada pelo Loyverse: fecha a reserva de estoque. */
    const prefix = orderPrefixFromTag(receipt.order);
    if (!prefix || !receipt.receipt_number) continue;
    const { data: match } = await supabaseAdmin
      .from("orders")
      .select("id")
      .ilike("id", `${prefix}%`)
      .limit(1)
      .maybeSingle();
    if (!match) continue;
    await rpc("confirm_order_receipt", {
      p_order_id: match.id,
      p_receipt_id: receipt.receipt_number,
    });
    receiptsHandled += 1;
  }

  /*
   * Estoque/vendas alterados direto no Loyverse: o catálogo é atualizado na
   * hora para impedir que o app venda o que não existe mais.
   */
  const touchesStock =
    receipts.length > 0 ||
    Array.isArray(payload["inventory_levels"]) ||
    Array.isArray(payload["items"]);

  if (touchesStock) {
    try {
      const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
      await syncCatalogFromLoyverse();
    } catch (err) {
      console.error("[loyverse-webhook] catálogo", err);
    }
  }

  return Response.json({ ok: true, receiptsHandled, refundsApplied });
}

export const Route = createFileRoute("/api/public/loyverse-webhook")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, ready: true }),
      POST: async ({ request }) => handle(request),
    },
  },
});
