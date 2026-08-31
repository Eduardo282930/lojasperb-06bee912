import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Valor mínimo aceito pelo checkout da InfinitePay. */
export const MIN_CHECKOUT_BRL = 1;

/** Situação das credenciais (nunca expõe valores). */
export const paymentsStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isConfigured, handle } = await import("@/lib/infinitepay.server");
  const h = handle();
  return {
    configured: isConfigured(),
    handlePreview: h ? `@${h.slice(0, 2)}${"•".repeat(Math.max(0, h.length - 2))}` : "",
  };
});

type CheckoutItem = { quantity: number; price: number; description: string };

/**
 * Gera (ou reaproveita) o link de pagamento InfinitePay de um pedido já criado.
 * O pedido é a fonte da verdade do valor: o que o cliente paga é exatamente o
 * total gravado no banco, com cupom e moedas já descontados.
 */
export const createOrderCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string }) => {
    if (!data?.orderId || typeof data.orderId !== "string") throw new Error("orderId");
    return { orderId: data.orderId };
  })
  .handler(
    async ({ data }): Promise<{ url: string | null; reason: string }> => {
      try {
        const { createCheckoutLink, isConfigured } = await import(
          "@/lib/infinitepay.server"
        );
        if (!isConfigured()) return { url: null, reason: "not_configured" };

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Aproveita a abertura de um checkout para liberar reservas vencidas.
        void supabaseAdmin.rpc("expire_stale_reservations");

        const { data: order, error } = await supabaseAdmin
          .from("orders")
          .select(
            "id, total, discount, coins_discount, payment_status, payment_url, payment_nsu, customer_name, customer_phone, customer_email, items",
          )
          .eq("id", data.orderId)
          .maybeSingle();

        if (error || !order) return { url: null, reason: "not_found" };
        if (order.payment_status === "paid") return { url: null, reason: "already_paid" };
        if (order.payment_url) {
          return { url: order.payment_url as string, reason: "existing" };
        }

        const total = Number(order.total ?? 0);
        const totalCents = Math.round(total * 100);

        if (!Number.isFinite(total) || totalCents < MIN_CHECKOUT_BRL * 100) {
          return { url: null, reason: "min_value" };
        }

        const rawItems = Array.isArray(order.items)
          ? (order.items as Array<Record<string, unknown>>)
          : [];
        const hasDiscount =
          Number(order.discount ?? 0) > 0 || Number(order.coins_discount ?? 0) > 0;

        const label = `Pedido SPERB ${String(order.id).slice(0, 8)}`;
        const single: CheckoutItem[] = [
          { quantity: 1, price: totalCents, description: label },
        ];

        let items: CheckoutItem[] = hasDiscount
          ? single
          : rawItems.map((it) => ({
              quantity: Math.max(1, Math.round(Number(it["qty"] ?? 1))),
              price: Math.round(Number(it["price"] ?? 0) * 100),
              description: String(it["name"] ?? "Produto SPERB").slice(0, 120),
            }));

        const sum = items.reduce((s, i) => s + i.price * i.quantity, 0);
        if (
          items.length === 0 ||
          items.some((i) => !Number.isFinite(i.price) || i.price <= 0) ||
          sum !== totalCents
        ) {
          // Garantia: o valor cobrado é sempre o total do pedido.
          items = single;
        }

        const origin = new URL(getRequest().url).origin;
        const nsu = (order.payment_nsu as string | null) || String(order.id);

        const url = await createCheckoutLink({
          items,
          orderNsu: nsu,
          redirectUrl: `${origin}/pedidos?status=topay&checkout=1`,
          webhookUrl: `${origin}/api/public/infinitepay-webhook`,
          customer: {
            name: (order.customer_name as string) || undefined,
            phone: (order.customer_phone as string) || undefined,
            email: (order.customer_email as string) || undefined,
          },
        });

        if (!url) return { url: null, reason: "provider_error" };

        await supabaseAdmin
          .from("orders")
          .update({
            payment_provider: "infinitepay",
            payment_url: url,
            payment_nsu: nsu,
          })
          .eq("id", order.id);

        return { url, reason: "created" };
      } catch (err) {
        console.error("[ORDER CHECKOUT]", err);
        return { url: null, reason: "provider_error" };
      }
    },
  );

/** Cancela um pedido que não conseguiu abrir o pagamento, liberando o estoque. */
export const abandonOrder = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string }) => {
    if (!data?.orderId) throw new Error("orderId");
    return { orderId: data.orderId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, payment_status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order || order.payment_status === "paid") return { ok: false };

    await supabaseAdmin
      .from("order_stock_reservations")
      .update({ active: false })
      .eq("order_id", data.orderId);
    await supabaseAdmin
      .from("orders")
      .update({ status: "canceled", flow_state: "CANCELLED" })
      .eq("id", data.orderId);
    return { ok: true };
  });
