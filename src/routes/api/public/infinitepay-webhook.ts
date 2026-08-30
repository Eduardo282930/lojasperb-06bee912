import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook de pagamento aprovado da InfinitePay.
 * Segurança: chave secreta na URL + reconfirmação server-to-server antes de
 * marcar o pedido como pago. Idempotente por `transaction_nsu`.
 */
export const Route = createFileRoute("/api/public/infinitepay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = (process.env["INFINITEPAY_WEBHOOK_SECRET"] ?? "").trim();
        const key = new URL(request.url).searchParams.get("key") ?? "";
        if (!secret || key.length !== secret.length || key !== secret) {
          return new Response("unauthorized", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("bad request", { status: 400 });
        }

        const orderNsu = String(payload["order_nsu"] ?? "");
        const transactionNsu = String(payload["transaction_nsu"] ?? "");
        const slug = String(payload["invoice_slug"] ?? "");
        if (!orderNsu || !transactionNsu) {
          return new Response("bad request", { status: 400 });
        }

        const { checkPayment } = await import("@/lib/infinitepay.server");
        const check = await checkPayment({ orderNsu, transactionNsu, slug });
        if (!check?.paid) {
          // 400 faz a InfinitePay reenviar a notificação mais tarde.
          return new Response("not confirmed", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("confirm_order_payment", {
          p_order_id: orderNsu,
          p_provider: "infinitepay",
          p_external_id: transactionNsu,
          p_method: check.captureMethod || String(payload["capture_method"] ?? ""),
          p_amount: (check.paidAmount || check.amount) / 100,
          p_receipt_url: String(payload["receipt_url"] ?? ""),
          p_raw: payload as never,
        });
        if (error) {
          console.error("[infinitepay] confirm", error.message);
          return new Response("retry", { status: 400 });
        }

        return new Response("ok");
      },
    },
  },
});
