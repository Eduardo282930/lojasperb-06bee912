import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Situação das credenciais (nunca expõe valores). */
export const paymentsStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isConfigured, handle } = await import("@/lib/infinitepay.server");
  const h = handle();
  return {
    configured: isConfigured(),
    handlePreview: h ? `@${h.slice(0, 2)}${"•".repeat(Math.max(0, h.length - 2))}` : "",
  };
});

/** Gera (ou reaproveita) o link de pagamento InfinitePay do pedido. */
export const createOrderCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string }) => {
    if (!data?.orderId || typeof data.orderId !== "string") throw new Error("orderId");
    return { orderId: data.orderId };
  })
  .handler(async ({ data }) => {
    const { createCheckoutLink, isConfigured } = await import("@/lib/infinitepay.server");
    if (!isConfigured()) return { url: null as string | null, reason: "not_configured" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, total, discount, coins_discount, payment_status, payment_url, customer_name, customer_phone, items",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error || !order) return { url: null, reason: "not_found" };
    if (order.payment_status === "paid") return { url: null, reason: "already_paid" };
    if (order.payment_url) return { url: order.payment_url as string, reason: "existing" };

    const total = Number(order.total ?? 0);
    if (!(total > 0)) return { url: null, reason: "invalid_total" };

    const rawItems = Array.isArray(order.items)
      ? (order.items as Array<Record<string, unknown>>)
      : [];
    const hasDiscount =
      Number(order.discount ?? 0) > 0 || Number(order.coins_discount ?? 0) > 0;

    const items = hasDiscount
      ? [
          {
            quantity: 1,
            price: Math.round(total * 100),
            description: `Pedido SPERB ${String(order.id).slice(0, 8)}`,
          },
        ]
      : rawItems.map((it) => ({
          quantity: Math.max(1, Math.round(Number(it["qty"] ?? 1))),
          price: Math.round(Number(it["price"] ?? 0) * 100),
          description: String(it["name"] ?? "Produto SPERB").slice(0, 120),
        }));

    if (items.length === 0 || items.some((i) => i.price <= 0)) {
      items.splice(0, items.length, {
        quantity: 1,
        price: Math.round(total * 100),
        description: `Pedido SPERB ${String(order.id).slice(0, 8)}`,
      });
    }

    const origin = new URL(getRequest().url).origin;
    const url = await createCheckoutLink({
      items,
      orderNsu: String(order.id),
      redirectUrl: `${origin}/pedidos?status=preparing`,
      webhookUrl: `${origin}/api/public/infinitepay-webhook`,
      customer: {
        name: (order.customer_name as string) || undefined,
        phone: (order.customer_phone as string) || undefined,
      },
    });

    if (!url) return { url: null, reason: "provider_error" };

    await supabaseAdmin.rpc("set_order_payment_link", {
      p_order_id: String(order.id),
      p_url: url,
      p_provider: "infinitepay",
    });

    return { url, reason: "created" };
  });
