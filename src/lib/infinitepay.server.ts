/**
 * Integração oficial do Checkout Integrado da InfinitePay.
 * As credenciais ficam apenas no servidor (Secrets), nunca no navegador.
 */

const BASE = "https://api.infinitepay.io/invoices/public/checkout";

export type CheckoutItem = {
  quantity: number;
  price: number; // centavos
  description: string;
};

export function handle(): string {
  return (process.env["INFINITEPAY_HANDLE"] ?? "").trim();
}

export function webhookSecret(): string {
  return (process.env["INFINITEPAY_WEBHOOK_SECRET"] ?? "").trim();
}

export function isConfigured(): boolean {
  return handle() !== "" && webhookSecret() !== "";
}

export async function createCheckoutLink(input: {
  items: CheckoutItem[];
  orderNsu: string;
  redirectUrl: string;
  webhookUrl: string;
  customer?: { name?: string; phone?: string };
}): Promise<string | null> {
  const h = handle();
  if (!h) return null;
  const body: Record<string, unknown> = {
    handle: h,
    items: input.items,
    order_nsu: input.orderNsu,
    redirect_url: input.redirectUrl,
    webhook_url: input.webhookUrl,
  };
  const phone = (input.customer?.phone ?? "").replace(/\D/g, "");
  if (input.customer?.name || phone) {
    body["customer"] = {
      name: input.customer?.name || undefined,
      phone_number: phone ? `+55${phone.slice(-11)}` : undefined,
    };
  }

  const res = await fetch(`${BASE}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("[infinitepay] link", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const json = (await res.json()) as { checkout_url?: string; url?: string };
  return json.checkout_url ?? json.url ?? null;
}

export type PaymentCheck = {
  paid: boolean;
  amount: number;
  paidAmount: number;
  installments: number;
  captureMethod: string;
};

/** Confirmação server-to-server: nunca confiamos apenas no corpo do webhook. */
export async function checkPayment(input: {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}): Promise<PaymentCheck | null> {
  const h = handle();
  if (!h) return null;
  const res = await fetch(`${BASE}/payment_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: h,
      order_nsu: input.orderNsu,
      transaction_nsu: input.transactionNsu,
      slug: input.slug,
    }),
  });
  if (!res.ok) {
    console.error("[infinitepay] check", res.status);
    return null;
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    paid: Boolean(json["paid"]),
    amount: Number(json["amount"] ?? 0),
    paidAmount: Number(json["paid_amount"] ?? 0),
    installments: Number(json["installments"] ?? 1),
    captureMethod: String(json["capture_method"] ?? ""),
  };
}
