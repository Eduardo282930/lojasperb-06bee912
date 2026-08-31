/**
 * Integração oficial do Checkout Integrado da InfinitePay.
 * As credenciais ficam apenas no servidor (Secrets), nunca no navegador.
 */

const BASE = "https://api.checkout.infinitepay.io";

export type CheckoutItem = {
  quantity: number;
  price: number; // centavos
  description: string;
};

export function handle(): string {
  return (process.env["INFINITEPAY_HANDLE"] ?? "").trim();
}

export function isConfigured(): boolean {
  return handle() !== "";
}

export async function createCheckoutLink(input: {
  items: CheckoutItem[];
  orderNsu: string;
  redirectUrl: string;
  webhookUrl: string;
  customer?: { name?: string; phone?: string; email?: string };
}): Promise<string | null> {
  const h = handle();

  // Diagnóstico seguro: nunca mostra o valor do handle.
  console.log("[InfinitePay] configurado:", isConfigured());
  console.log("[InfinitePay] handle existe:", Boolean(h));

  if (!h) {
    console.error("[InfinitePay] INFINITEPAY_HANDLE não configurado");
    return null;
  }

  const body: Record<string, unknown> = {
    handle: h,
    items: input.items,
    order_nsu: input.orderNsu,
    redirect_url: input.redirectUrl,
    webhook_url: input.webhookUrl,
  };

  const phone = (input.customer?.phone ?? "").replace(/\D/g, "");
  const email = (input.customer?.email ?? "").trim();

  if (input.customer?.name || phone || email) {
    body["customer"] = {
      name: input.customer?.name || undefined,
      email: email || undefined,
      phone_number: phone ? `+55${phone.slice(-11)}` : undefined,
    };
  }

  console.log("[InfinitePay] enviando checkout para API...");

  let res: Response;

  try {
    res = await fetch(`${BASE}/links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[InfinitePay] erro de conexão:", error);
    return null;
  }

  const responseText = await res.text();

  console.log("[InfinitePay] resposta HTTP:", res.status);

  if (!res.ok) {
    console.error(
      "[InfinitePay] erro ao criar checkout:",
      res.status,
      responseText.slice(0, 500),
    );
    return null;
  }

  let json: { checkout_url?: string; url?: string };

  try {
    json = JSON.parse(responseText) as {
      checkout_url?: string;
      url?: string;
    };
  } catch {
    console.error("[InfinitePay] resposta inválida da API:", responseText.slice(0, 500));
    return null;
  }

  const checkoutUrl = json.checkout_url ?? json.url ?? null;

  console.log("[InfinitePay] checkout criado:", Boolean(checkoutUrl));

  return checkoutUrl;
}

export type PaymentCheck = {
  paid: boolean;
  amount: number;
  paidAmount: number;
  installments: number;
  captureMethod: string;
};

/**
 * Confirmação server-to-server:
 * nunca confiamos apenas no corpo do webhook.
 */
export async function checkPayment(input: {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}): Promise<PaymentCheck | null> {
  const h = handle();

  if (!h) {
    console.error("[InfinitePay] INFINITEPAY_HANDLE não configurado");
    return null;
  }

  let res: Response;

  try {
    res = await fetch(`${BASE}/payment_check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        handle: h,
        order_nsu: input.orderNsu,
        transaction_nsu: input.transactionNsu,
        slug: input.slug,
      }),
    });
  } catch (error) {
    console.error("[InfinitePay] erro de conexão no payment_check:", error);
    return null;
  }

  const responseText = await res.text();

  if (!res.ok) {
    console.error(
      "[InfinitePay] erro no payment_check:",
      res.status,
      responseText.slice(0, 500),
    );
    return null;
  }

  let json: Record<string, unknown>;

  try {
    json = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    console.error(
      "[InfinitePay] resposta inválida no payment_check:",
      responseText.slice(0, 500),
    );
    return null;
  }

  return {
    paid: Boolean(json["paid"]),
    amount: Number(json["amount"] ?? 0),
    paidAmount: Number(json["paid_amount"] ?? 0),
    installments: Number(json["installments"] ?? 1),
    captureMethod: String(json["capture_method"] ?? ""),
  };
}