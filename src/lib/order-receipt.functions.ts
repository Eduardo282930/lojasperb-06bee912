import { createServerFn } from "@tanstack/react-start";

/**
 * Recibo do pedido para o cliente baixar como imagem.
 *
 * O recibo é montado na hora em que o cliente pede, sempre com as informações
 * salvas do pedido (as mesmas que vieram do Loyverse), então ele sai idêntico
 * hoje ou daqui a um mês. Nada fica guardado em arquivo: a imagem é criada no
 * aparelho no momento do download e desaparece junto com a tela.
 */

export type ReceiptItem = { name: string; qty: number; price: number; repair?: boolean };

export type ReceiptData = {
  ok: boolean;
  number: string;
  dateLabel: string;
  storeName: string;
  storeAddress: string;
  employeeName: string;
  customerName: string;
  customerPhone: string;
  originLabel: string;
  diningOption: string;
  paymentLabel: string;
  items: ReceiptItem[];
  subtotal: number;
  couponCode: string;
  couponDiscount: number;
  sellerDiscount: number;
  coinsUsed: number;
  coinsDiscount: number;
  total: number;
  logoDataUrl: string | null;
  refunded: boolean;
  /** Serviço de conserto: recibo com garantia de 3 meses, não é venda. */
  isRepair: boolean;
  /** Mesmo código do pedido no Loyverse, para consulta. */
  orderCode: string;
};

function digits(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function logoAsDataUrl(): Promise<string | null> {
  try {
    const { loadStoreLogoFromSupabase } = await import("./catalog-cache.server");
    const url = await loadStoreLogoFromSupabase();
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export const getOrderReceipt = createServerFn({ method: "POST" })
  .inputValidator((input: { orderId: string; phone: string }) => input)
  .handler(async ({ data }): Promise<ReceiptData | { ok: false }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (
      supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
            };
          };
        };
      }
    )
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      .maybeSingle();

    if (!row) return { ok: false };

    /* Privacidade: só o dono do pedido baixa o recibo. */
    const orderPhone = digits(String(row["customer_phone"] ?? ""));
    const askPhone = digits(data.phone ?? "");
    if (orderPhone && orderPhone.slice(-8) !== askPhone.slice(-8)) {
      return { ok: false };
    }
    const paymentStatus = String(row["payment_status"] ?? "");
    const refundState = String(row["refund_state"] ?? "");
    const refunded = paymentStatus === "refunded" || refundState === "refunded";
    if (paymentStatus !== "paid" && !refunded) return { ok: false };

    const items = Array.isArray(row["items"])
      ? (row["items"] as Array<Record<string, unknown>>).map((i) => ({
          name: String(i["name"] ?? "Item"),
          qty: num(i["qty"]) || 1,
          price: num(i["price"]),
        }))
      : [];

    const created = String(row["paid_at"] ?? row["created_at"] ?? "");
    const date = created ? new Date(created) : new Date();
    const isStore = String(row["origin"] ?? "app") === "store";

    return {
      ok: true,
      number: String(row["receipt_number"] ?? row["loyverse_receipt_id"] ?? "")
        || String(row["id"] ?? "").slice(0, 8).toUpperCase(),
      dateLabel: date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      storeName: "SPERB",
      storeAddress: String(row["store_address"] ?? ""),
      employeeName: String(row["employee_name"] ?? ""),
      customerName: String(row["customer_name"] ?? ""),
      customerPhone: String(row["customer_phone"] ?? ""),
      originLabel: isStore ? "Comprado na loja física" : "Comprado online",
      diningOption: String(row["dining_option"] ?? ""),
      paymentLabel:
        String(row["payment_type_label"] ?? "") ||
        (String(row["payment_method"] ?? "") === "delivery"
          ? "Pagamento na entrega"
          : "Pago pelo app"),
      items,
      subtotal: num(row["subtotal"]),
      couponCode: String(row["coupon_code"] ?? ""),
      couponDiscount: num(row["discount"]),
      sellerDiscount: num(row["seller_discount"]),
      coinsUsed: num(row["coins_used"]),
      coinsDiscount: num(row["coins_discount"]),
      total: num(row["total"]),
      logoDataUrl: await logoAsDataUrl(),
      refunded,
    };
  });
