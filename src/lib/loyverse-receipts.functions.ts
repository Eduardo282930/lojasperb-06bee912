import { createServerFn } from "@tanstack/react-start";

/**
 * Vendas feitas no balcão (recibos do Loyverse) entram em "Minhas compras".
 *
 * Regras:
 * - cada recibo vira um pedido do cliente que comprou, já pago e em preparação;
 * - o pedido fica marcado como feito pelo vendedor da loja, com o tipo de
 *   pagamento usado (Dinheiro, Pix, Cartão…);
 * - desconto "Moedas" debita o saldo de moedas do cliente uma única vez;
 * - desconto "Cupom" aparece como cupom; qualquer outro desconto aparece como
 *   desconto do vendedor;
 * - é idempotente: o mesmo recibo nunca entra duas vezes (índice único).
 */

type LoyverseDiscountLine = {
  discount_name?: string | null;
  name?: string | null;
  money_amount?: number | null;
};

type LoyverseLineItem = {
  variant_id?: string | null;
  item_name?: string | null;
  variant_name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  price?: number | null;
  gross_total_money?: number | null;
  total_money?: number | null;
  total_discount?: number | null;
  line_discounts?: LoyverseDiscountLine[] | null;
};

type LoyverseReceipt = {
  receipt_number: string;
  receipt_type?: string | null;
  receipt_date?: string | null;
  created_at?: string | null;
  order?: string | null;
  cancelled_at?: string | null;
  customer_id?: string | null;
  store_id?: string | null;
  employee_id?: string | null;
  dining_option?: string | null;
  total_money?: number | null;
  total_discount?: number | null;
  points_deducted?: number | null;
  total_discounts?: LoyverseDiscountLine[] | null;
  line_items?: LoyverseLineItem[] | null;
  payments?: Array<{ name?: string | null; type?: string | null }> | null;
};

type LoyverseCustomer = {
  id: string;
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
};

type LoyverseStore = {
  id: string;
  name?: string | null;
  address?: string | null;
};

type LoyverseEmployee = { id: string; name?: string | null };

async function loyverse<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.loyverse.com/v1.0/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Loyverse ${path} ${res.status}`);
  return (await res.json()) as T;
}

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Nome amigável do pagamento feito no balcão. */
function paymentLabel(r: LoyverseReceipt): string {
  const names = (r.payments ?? [])
    .map((p) => (p.name ?? "").trim())
    .filter(Boolean);
  if (names.length > 0) return [...new Set(names)].join(" + ");
  const type = (r.payments?.[0]?.type ?? "").toUpperCase();
  if (type === "CASH") return "Dinheiro";
  if (type === "CARD") return "Cartão";
  return "Pago na loja";
}

export type ImportResult = { ok: boolean; imported: number; reason?: string };

/** Importa os recibos do balcão dos últimos `days` dias. */
export async function importStoreReceipts(days = 90): Promise<ImportResult> {
  const token = process.env["LOYVERSE_TOKEN"];
  if (!token) return { ok: false, imported: 0, reason: "no_token" };

  const day = 24 * 60 * 60 * 1000;
  async function receiptsSince(d: number) {
    const since = new Date(Date.now() - d * day).toISOString();
    return loyverse<{ receipts?: LoyverseReceipt[] }>(
      `receipts?limit=250&created_at_min=${encodeURIComponent(since)}`,
      token!,
    );
  }

  let receipts: LoyverseReceipt[] = [];
  let customers: LoyverseCustomer[] = [];
  try {
    const [r, c] = await Promise.all([
      receiptsSince(days)
        .catch(() => receiptsSince(30))
        .catch(() => ({ receipts: [] as LoyverseReceipt[] })),
      loyverse<{ customers?: LoyverseCustomer[] }>(
        "customers?limit=250",
        token,
      ).catch(() => ({ customers: [] as LoyverseCustomer[] })),
    ]);
    receipts = r.receipts ?? [];
    customers = c.customers ?? [];
  } catch (err) {
    console.error("[recibos-loja] falha ao ler o Loyverse", err);
    return { ok: false, imported: 0, reason: "loyverse_error" };
  }

  const byCustomer = new Map<string, LoyverseCustomer>();
  for (const c of customers) byCustomer.set(c.id, c);

  /* Imagens do catálogo oficial para o pedido ficar bonito na tela. */
  const imageByVariant = new Map<string, string>();
  try {
    const { readCatalogSnapshot } = await import("./catalog-snapshot.server");
    const snapshot = await readCatalogSnapshot();
    for (const p of snapshot?.catalog.products ?? []) {
      for (const v of p.variants ?? []) {
        const img = v.image ?? p.image;
        if (img) imageByVariant.set(v.id, img);
      }
      if (p.image) imageByVariant.set(p.id, p.image);
    }
  } catch {
    /* sem catálogo salvo: o pedido aparece sem foto, sem quebrar nada */
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: { message?: string } | null }>;

  /* Recibos cancelados/reembolsados não viram pedido novo. */
  const refunded = new Set<string>();
  for (const r of receipts) {
    const type = (r.receipt_type ?? "SALE").toUpperCase();
    const refundFor = (r as { refund_for?: string | null }).refund_for;
    if (type === "REFUND" && refundFor) refunded.add(refundFor);
    if (r.cancelled_at) refunded.add(r.receipt_number);
  }

  const sales = receipts.filter(
    (r) =>
      (r.receipt_type ?? "SALE").toUpperCase() === "SALE" &&
      !r.cancelled_at &&
      !refunded.has(r.receipt_number) &&
      /* pedidos criados pelo próprio app já existem aqui */
      !String(r.order ?? "").startsWith("SPERB-"),
  );

  let imported = 0;

  for (const r of sales) {
    const items = (r.line_items ?? []).map((l) => {
      const variant = String(l.variant_id ?? "");
      const label = [l.item_name?.trim(), l.variant_name?.trim()]
        .filter(Boolean)
        .join(" · ");
      const qty = Number(l.quantity) || 1;
      const gross = money(l.gross_total_money ?? l.total_money);
      return {
        id: variant,
        name: label || "Item",
        qty,
        price: money(l.price ?? (qty > 0 ? gross / qty : gross)),
        sku: l.sku ?? "",
        image: imageByVariant.get(variant) ?? null,
      };
    });

    if (items.length === 0) continue;

    const subtotal = money(
      (r.line_items ?? []).reduce(
        (sum, l) => sum + money(l.gross_total_money ?? l.total_money),
        0,
      ),
    );

    /* Separa os descontos por tipo (moedas, cupom, vendedor). */
    let coinsDiscount = 0;
    let couponDiscount = 0;
    let couponName = "";
    let sellerDiscount = 0;

    const allDiscounts: LoyverseDiscountLine[] = [
      ...(r.total_discounts ?? []),
      ...(r.line_items ?? []).flatMap((l) => l.line_discounts ?? []),
    ];

    for (const d of allDiscounts) {
      const name = d.discount_name ?? d.name ?? "";
      const value = Math.abs(money(d.money_amount));
      if (value <= 0) continue;
      if (norm(name).includes("moeda")) coinsDiscount += value;
      else if (norm(name).includes("cupom")) {
        couponDiscount += value;
        if (!couponName) couponName = name.trim();
      } else sellerDiscount += value;
    }

    /* Sobra de desconto não identificada = desconto do vendedor. */
    const declared = Math.abs(money(r.total_discount));
    const mapped = money(coinsDiscount + couponDiscount + sellerDiscount);
    if (declared > mapped + 0.01) sellerDiscount += money(declared - mapped);

    const points = Math.max(0, Math.trunc(Number(r.points_deducted) || 0));
    const coinsUsed = points > 0 ? points : Math.round(coinsDiscount * 100);
    if (coinsDiscount === 0 && points > 0) coinsDiscount = money(points / 100);

    const customer = r.customer_id ? byCustomer.get(r.customer_id) : undefined;

    const { error } = await rpc("import_store_receipt", {
      p_receipt_id: r.receipt_number,
      p_receipt_date: r.receipt_date ?? r.created_at ?? new Date().toISOString(),
      p_loyverse_customer_id: r.customer_id ?? "",
      p_name: customer?.name?.trim() ?? "",
      p_phone: customer?.phone_number ?? "",
      p_email: customer?.email ?? "",
      p_items: items,
      p_subtotal: subtotal,
      p_coupon_discount: money(couponDiscount),
      p_coupon_code: couponName,
      p_coins_used: coinsUsed,
      p_coins_discount: money(coinsDiscount),
      p_seller_discount: money(sellerDiscount),
      p_total: money(r.total_money),
      p_payment_type: paymentLabel(r),
    });

    if (error) {
      console.error("[recibos-loja]", r.receipt_number, error.message);
      continue;
    }
    imported += 1;
  }

  return { ok: true, imported };
}

/** Importação sob demanda (Admin / abertura de "Minhas compras"). */
export const syncStoreReceipts = createServerFn({ method: "POST" }).handler(
  async (): Promise<ImportResult> => importStoreReceipts(90),
);
