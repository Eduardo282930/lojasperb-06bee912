import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Venda paga → recibo real no Loyverse.
 *
 * Regras de ouro:
 * - só roda depois do pagamento confirmado;
 * - é idempotente (trava no banco + procura recibo já existente pelo número do
 *   pedido), então timeout ou nova tentativa nunca duplica a venda;
 * - o recibo leva o desconto do cupom e os pontos usados. Nunca criamos recibo
 *   pelo valor cheio: se o desconto não puder ser aplicado, o pedido fica em
 *   SYNC_ERROR para o administrador reprocessar;
 * - a reserva de estoque só é encerrada depois que o Loyverse confirma o recibo.
 */

type LoyverseStore = { id: string };
type LoyversePaymentType = { id: string; type?: string | null; name?: string | null };
type LoyverseDiscount = { id: string; name?: string | null; type?: string | null };
export type LoyverseReceipt = {
  receipt_number?: string;
  order?: string | null;
  receipt_type?: string | null;
  refund_for?: string | null;
  cancelled_at?: string | null;
  total_money?: number | null;
};

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

/* O arquivo de tipos gerado não conhece as RPCs novas do banco oficial. */
type AnyRpc = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

export type SyncResult = {
  ok: boolean;
  receiptId?: string;
  reason?: string;
};

/** Etiqueta única do pedido dentro do Loyverse (usada para não duplicar). */
export function orderTag(orderId: string): string {
  return `SPERB-${String(orderId).slice(0, 8)}`;
}

/** Paginação robusta para buscar recibos. */
export async function receiptPages(token: string, createdAfter: string): Promise<LoyverseReceipt[]> {
  const all: LoyverseReceipt[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`https://api.loyverse.com/v1.0/receipts`);
    url.searchParams.set("limit", "250");
    url.searchParams.set("created_at_min", createdAfter);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Loyverse receipts list ${res.status}`);
    const data = (await res.json()) as { receipts?: LoyverseReceipt[]; cursor?: string };
    all.push(...(data.receipts ?? []));
    cursor = data.cursor;
  } while (cursor);
  return all;
}

/** Procura um recibo já criado para este pedido (proteção contra timeout). */
async function findExistingReceipt(
  token: string,
  tag: string,
  since: string,
): Promise<string | null> {
  try {
    const list = await receiptPages(token, since);
    const hit = list.find(
      (r) => (r.order ?? "") === tag && (r.receipt_type ?? "SALE") === "SALE",
    );
    return hit?.receipt_number ?? null;
  } catch (err) {
    console.warn("[loyverse-sync] busca de recibo existente falhou", err);
    return null;
  }
}

/** Cria o recibo no Loyverse para um pedido já pago. */
export async function syncPaidOrder(orderId: string): Promise<SyncResult> {
  const token = process.env["LOYVERSE_TOKEN"];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, created_at, payment_status, loyverse_receipt_id, subtotal, discount, total, coins_used, coins_discount, payment_method, customer_id, customer_phone, coupon_code, coupon_id",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { ok: false, reason: "not_found" };
  if (order.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  if (order.loyverse_receipt_id) {
    // Já sincronizado: garante apenas que a reserva foi finalizada.
    await (supabaseAdmin.rpc as unknown as AnyRpc)("finalize_reservation_after_receipt", {
      p_order_id: orderId,
      p_receipt_id: order.loyverse_receipt_id,
    });
    return { ok: true, receiptId: order.loyverse_receipt_id, reason: "already_synced" };
  }
  if (!token) {
    await (supabaseAdmin.rpc as unknown as AnyRpc)("mark_order_sync_failed", {
      p_order_id: orderId,
      p_error: "LOYVERSE_TOKEN não configurado",
    });
    return { ok: false, reason: "no_token" };
  }

  /* Trava: dois disparos simultâneos não criam dois recibos. */
  const claimed = await (supabaseAdmin.rpc as unknown as AnyRpc)("claim_order_sync", {
    p_order_id: orderId,
  }).then((r) => (r as { data?: boolean }).data);
  if (!claimed) return { ok: false, reason: "locked_or_synced" };

  const tag = orderTag(orderId);

  try {
    /* Recibo já criado numa tentativa anterior que deu timeout? */
    const since = new Date(
      new Date(String(order.created_at ?? Date.now())).getTime() - 60 * 60 * 1000,
    ).toISOString();
    const existing = await findExistingReceipt(token, tag, since);
    if (existing) {
      await (supabaseAdmin.rpc as unknown as AnyRpc)("mark_order_synced", {
        p_order_id: orderId,
        p_receipt_id: existing,
      });
      await (supabaseAdmin.rpc as unknown as AnyRpc)("finalize_reservation_after_receipt", {
        p_order_id: orderId,
        p_receipt_id: existing,
      });
      return { ok: true, receiptId: existing, reason: "recovered" };
    }

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("external_variant_id, name, qty, unit_price, total")
      .eq("order_id", orderId);

    const lines = (items ?? []).filter((i) => Boolean(i.external_variant_id));
    if (lines.length === 0) throw new Error("pedido sem itens com variação do Loyverse");

    const [stores, paymentTypes, discountList] = await Promise.all([
      loyverse<{ stores?: LoyverseStore[] }>("stores?limit=10", token),
      loyverse<{ payment_types?: LoyversePaymentType[] }>("payment_types?limit=50", token),
      loyverse<{ discounts?: LoyverseDiscount[] }>("discounts?limit=100", token),
    ]);

    const storeId = stores.stores?.[0]?.id;
    if (!storeId) throw new Error("nenhuma loja encontrada no Loyverse");

    const types = paymentTypes.payment_types ?? [];
    const paymentType =
      types.find((t) => (t.type ?? "").toUpperCase() === "OTHER") ??
      types.find((t) => (t.type ?? "").toUpperCase() === "CARD") ??
      types[0];
    if (!paymentType) throw new Error("nenhuma forma de pagamento no Loyverse");

    const discounts = discountList.discounts ?? [];
    const norm = (s: string | null | undefined) =>
      (s ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const couponDiscount = (kind: "VARIABLE_AMOUNT" | "VARIABLE_PERCENT") =>
      discounts.find(
        (d) => (d.type ?? "").toUpperCase() === kind && norm(d.name).includes("cupom"),
      );
    /* Desconto usado para as moedas (pontos) — "Desconto Moedas" no Loyverse. */
    const coinsDiscountEntry = () =>
      discounts.find((d) => norm(d.name).includes("moeda")) ?? null;

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
    const couponValue = Number(order.discount) || 0;
    const subtotal = Number(order.subtotal) || 0;
    const coins = Math.max(0, Math.trunc(Number(order.coins_used) || 0));
    const coinsDiscount = Number(order.coins_discount) || 0;

    /* Cupom: percentual usa o desconto %, valor fixo usa o desconto Σ. */
    const totalDiscounts: Array<Record<string, unknown>> = [];
    if (couponValue > 0) {
      let couponIsPercent = false;
      if (order.coupon_id) {
        const { data: coupon } = await supabaseAdmin
          .from("coupons")
          .select("type, value")
          .eq("id", order.coupon_id)
          .maybeSingle();
        couponIsPercent = (coupon?.type ?? "") === "percent";
      }
      const target = couponDiscount(
        couponIsPercent ? "VARIABLE_PERCENT" : "VARIABLE_AMOUNT",
      );
      if (!target) {
        throw new Error(
          couponIsPercent
            ? "desconto “Desconto – Cupom | Variável, %” não existe no Loyverse"
            : "desconto “Desconto – Cupom | Variável, Σ” não existe no Loyverse",
        );
      }
      const entry: Record<string, unknown> = {
        id: target.id,
        type: target.type,
        scope: "RECEIPT",
        name: `Cupom ${order.coupon_code || ""}`.trim(),
        money_amount: Math.round(couponValue * 100) / 100,
      };
      if (couponIsPercent && subtotal > 0) {
        entry["percentage"] = Math.round((couponValue / subtotal) * 10000) / 100;
      }
      totalDiscounts.push(entry);
    }

    /*
     * Moedas: o valor abatido entra no desconto "Desconto Moedas" do Loyverse
     * e a quantidade de pontos vai em `points_deducted`, para o recibo bater
     * exatamente com o que o cliente pagou.
     */
    if (coinsDiscount > 0) {
      const target = coinsDiscountEntry();
      if (!target) {
        throw new Error("desconto “Desconto Moedas” não existe no Loyverse");
      }
      const entry: Record<string, unknown> = {
        id: target.id,
        type: target.type,
        scope: "RECEIPT",
        name: `Moedas (${coins} pts)`,
        money_amount: Math.round(coinsDiscount * 100) / 100,
      };
      if ((target.type ?? "").toUpperCase() === "VARIABLE_PERCENT" && subtotal > 0) {
        entry["percentage"] = Math.round((coinsDiscount / subtotal) * 10000) / 100;
      }
      totalDiscounts.push(entry);
    }

    const body: Record<string, unknown> = {
      store_id: storeId,
      order: tag,
      source: "SPERB App",
      receipt_date: new Date().toISOString(),
      line_items: lines.map((l) => ({
        variant_id: l.external_variant_id,
        quantity: Number(l.qty) || 1,
        price: Number(l.unit_price) || 0,
      })),
      payments: [{ payment_type_id: paymentType.id, money_amount: total }],
      note: order.coupon_code
        ? `Cupom ${order.coupon_code} — pedido pago no app SPERB`
        : "Pedido pago no app SPERB",
    };
    if (totalDiscounts.length > 0) body["total_discounts"] = totalDiscounts;
    if (coins > 0) body["points_deducted"] = coins;
    if (loyverseCustomerId) body["customer_id"] = loyverseCustomerId;

    let receipt: LoyverseReceipt;
    try {
      receipt = await loyverse<LoyverseReceipt>("receipts", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (err) {
      /* Pode ter criado e só a resposta ter falhado: confere antes de desistir. */
      const recovered = await findExistingReceipt(token, tag, since);
      if (!recovered) throw err;
      receipt = { receipt_number: recovered };
    }

    const receiptId = receipt.receipt_number;
    if (!receiptId) throw new Error("Loyverse não devolveu o número do recibo");

    await (supabaseAdmin.rpc as unknown as AnyRpc)("mark_order_synced", {
      p_order_id: orderId,
      p_receipt_id: receiptId,
    });
    await (supabaseAdmin.from("orders") as unknown as {
      update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
    })
      .update({ loyverse_points_used: coins })
      .eq("id", orderId);

    /* Só agora — recibo confirmado — a reserva vira baixa definitiva. */
    await (supabaseAdmin.rpc as unknown as AnyRpc)("finalize_reservation_after_receipt", {
      p_order_id: orderId,
      p_receipt_id: receiptId,
    });

    return { ok: true, receiptId, reason: "created" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[loyverse-sync]", message);
    await (supabaseAdmin.rpc as unknown as AnyRpc)("release_order_sync", { p_order_id: orderId });
    await (supabaseAdmin.rpc as unknown as AnyRpc)("mark_order_sync_failed", {
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
