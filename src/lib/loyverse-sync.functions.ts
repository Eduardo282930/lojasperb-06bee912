import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Envia a venda paga para o Loyverse (baixa de estoque real).
 * Regra de ouro: só roda depois do pagamento confirmado e é idempotente —
 * se o pedido já tem `loyverse_receipt_id`, nada é criado novamente.
 */

type LoyverseStore = { id: string };
type LoyversePaymentType = { id: string; type?: string | null; name?: string | null };

async function loyverse<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.loyverse.com/v1.0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Loyverse ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type SyncResult = {
  ok: boolean;
  receiptId?: string;
  reason?: string;
};

/** Cria o recibo no Loyverse para um pedido já pago. */
export async function syncPaidOrder(orderId: string): Promise<SyncResult> {
  const token = process.env["LOYVERSE_TOKEN"];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, payment_status, loyverse_receipt_id, total, payment_method, customer_id, customer_phone, coupon_code",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { ok: false, reason: "not_found" };
  if (order.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  if (order.loyverse_receipt_id) {
    return { ok: true, receiptId: order.loyverse_receipt_id, reason: "already_synced" };
  }
  if (!token) {
    await supabaseAdmin.rpc("mark_order_sync_failed", {
      p_order_id: orderId,
      p_error: "LOYVERSE_TOKEN não configurado",
    });
    return { ok: false, reason: "no_token" };
  }

  try {
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("external_variant_id, name, qty, unit_price, total")
      .eq("order_id", orderId);

    const lines = (items ?? []).filter((i) => Boolean(i.external_variant_id));
    if (lines.length === 0) throw new Error("pedido sem itens com variação do Loyverse");

    const [stores, paymentTypes] = await Promise.all([
      loyverse<{ stores?: LoyverseStore[] }>("stores?limit=10", token),
      loyverse<{ payment_types?: LoyversePaymentType[] }>("payment_types?limit=50", token),
    ]);

    const storeId = stores.stores?.[0]?.id;
    if (!storeId) throw new Error("nenhuma loja encontrada no Loyverse");

    const types = paymentTypes.payment_types ?? [];
    const paymentType =
      types.find((t) => (t.type ?? "").toUpperCase() === "OTHER") ??
      types.find((t) => (t.type ?? "").toUpperCase() === "CARD") ??
      types[0];
    if (!paymentType) throw new Error("nenhuma forma de pagamento no Loyverse");

    let loyverseCustomerId: string | null = null;
    if (order.customer_id) {
      const { data: customer } = await supabaseAdmin
        .from("customers")
        .select("loyverse_id")
        .eq("id", order.customer_id)
        .maybeSingle();
      loyverseCustomerId = customer?.loyverse_id ?? null;
    }

    const total = Number(order.total) || 0;

    const body: Record<string, unknown> = {
      store_id: storeId,
      order: `SPERB-${String(order.id).slice(0, 8)}`,
      source: "SPERB App",
      receipt_date: new Date().toISOString(),
      line_items: lines.map((l) => ({
        variant_id: l.external_variant_id,
        quantity: Number(l.qty) || 1,
        price: Number(l.unit_price) || 0,
      })),
      payments: [{ payment_type_id: paymentType.id, money_amount: total }],
      note: order.coupon_code ? `Cupom ${order.coupon_code}` : "Pedido pago no app SPERB",
    };
    if (loyverseCustomerId) body["customer_id"] = loyverseCustomerId;

    const receipt = await loyverse<{ receipt_number?: string }>("receipts", token, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const receiptId = receipt.receipt_number ?? `SPERB-${String(order.id).slice(0, 8)}`;

    await supabaseAdmin.rpc("mark_order_synced", {
      p_order_id: orderId,
      p_receipt_id: receiptId,
    });

    return { ok: true, receiptId, reason: "created" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[loyverse-sync]", message);
    await supabaseAdmin.rpc("mark_order_sync_failed", {
      p_order_id: orderId,
      p_error: message,
    });
    return { ok: false, reason: message };
  }
}

/** Reprocessamento manual pelo painel do administrador. */
export const retryLoyverseSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => {
    if (!data?.orderId) throw new Error("orderId");
    return { orderId: data.orderId };
  })
  .handler(async ({ data, context }): Promise<SyncResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false, reason: "forbidden" };
    return syncPaidOrder(data.orderId);
  });
