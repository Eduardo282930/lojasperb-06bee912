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

type CartLine = { name: string; qty: number; price: number };

/**
 * Abre o checkout ANTES de criar o pedido.
 * Retorna o link e o `order_nsu` gerado; o pedido só é criado depois que o
 * cliente recebe o link (evita pedido/reserva de estoque sem pagamento).
 */
export const startCartCheckout = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      items: CartLine[];
      total: number;
      discounted: boolean;
      name?: string;
      phone?: string;
    }) => {
      if (!Array.isArray(data?.items) || data.items.length === 0) throw new Error("items");
      if (!(Number(data.total) > 0)) throw new Error("total");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { createCheckoutLink, isConfigured } = await import("@/lib/infinitepay.server");
    if (!isConfigured()) return { url: null as string | null, nsu: "", reason: "not_configured" };

    const nsu = crypto.randomUUID();
    const total = Number(data.total);

    let items = data.discounted
      ? [{ quantity: 1, price: Math.round(total * 100), description: "Pedido SPERB" }]
      : data.items.map((it) => ({
          quantity: Math.max(1, Math.round(Number(it.qty ?? 1))),
          price: Math.round(Number(it.price ?? 0) * 100),
          description: String(it.name ?? "Produto SPERB").slice(0, 120),
        }));
    if (items.some((i) => i.price <= 0)) {
      items = [{ quantity: 1, price: Math.round(total * 100), description: "Pedido SPERB" }];
    }

    const origin = new URL(getRequest().url).origin;
    const url = await createCheckoutLink({
      items,
      orderNsu: nsu,
      redirectUrl: `${origin}/pedidos?status=topay&checkout=1`,
      webhookUrl: `${origin}/api/public/infinitepay-webhook`,
      customer: { name: data.name || undefined, phone: data.phone || undefined },
    });

    if (!url) return { url: null, nsu: "", reason: "provider_error" };
    return { url, nsu, reason: "created" };
  });

/** Liga o pedido recém-criado ao checkout já aberto (nsu + link). */
export const attachCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; nsu: string; url: string }) => {
    if (!data?.orderId || !data?.nsu || !data?.url) throw new Error("input");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        payment_provider: "infinitepay",
        payment_url: data.url,
        payment_nsu: data.nsu,
      })
      .eq("id", data.orderId)
      .eq("payment_status", "pending")
      .is("payment_url", null);
    return { ok: !error };
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
