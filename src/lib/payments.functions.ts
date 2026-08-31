import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Situação das credenciais (nunca expõe valores). */
export const paymentsStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { isConfigured, handle } =
      await import("@/lib/infinitepay.server");

    const h = handle();

    return {
      configured: isConfigured(),
      handlePreview: h
        ? `@${h.slice(0, 2)}${"•".repeat(Math.max(0, h.length - 2))}`
        : "",
    };
  },
);

type CartLine = {
  name: string;
  qty: number;
  price: number;
};

/**
 * Abre o checkout da InfinitePay antes de criar o pedido.
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
      if (!Array.isArray(data?.items) || data.items.length === 0) {
        throw new Error("CHECKOUT: items inválidos");
      }

      if (!(Number(data.total) > 0)) {
        throw new Error("CHECKOUT: total inválido");
      }

      return data;
    },
  )
  .handler(async ({ data }) => {
    try {
      console.log("[CHECKOUT] iniciou");

      const { createCheckoutLink, isConfigured } =
        await import("@/lib/infinitepay.server");

      console.log("[CHECKOUT] infinitepay.server carregado");

      const configured = isConfigured();

      console.log("[CHECKOUT] configurado:", configured);

      if (!configured) {
        console.error("[CHECKOUT] INFINITEPAY_HANDLE não configurado");

        return {
          url: null,
          nsu: "",
          reason: "not_configured",
        };
      }

      const nsu = crypto.randomUUID();

      console.log("[CHECKOUT] NSU criado:", nsu);

      const total = Number(data.total);

      let items = data.discounted
        ? [
            {
              quantity: 1,
              price: Math.round(total * 100),
              description: "Pedido SPERB",
            },
          ]
        : data.items.map((it) => ({
            quantity: Math.max(
              1,
              Math.round(Number(it.qty ?? 1)),
            ),
            price: Math.round(
              Number(it.price ?? 0) * 100,
            ),
            description: String(
              it.name ?? "Produto SPERB",
            ).slice(0, 120),
          }));

      if (items.some((i) => i.price <= 0)) {
        console.warn(
          "[CHECKOUT] preço inválido detectado, usando total",
        );

        items = [
          {
            quantity: 1,
            price: Math.round(total * 100),
            description: "Pedido SPERB",
          },
        ];
      }

      console.log("[CHECKOUT] itens preparados:", items);

      const request = getRequest();

      console.log("[CHECKOUT] request obtido");

      const origin = new URL(request.url).origin;

      console.log("[CHECKOUT] origin:", origin);

      const redirectUrl =
        `${origin}/pedidos?status=topay&checkout=1`;

      const webhookUrl =
        `${origin}/api/public/infinitepay-webhook`;

      console.log(
        "[CHECKOUT] redirect:",
        redirectUrl,
      );

      console.log(
        "[CHECKOUT] webhook:",
        webhookUrl,
      );

      console.log(
        "[CHECKOUT] chamando InfinitePay...",
      );

      const url = await createCheckoutLink({
        items,
        orderNsu: nsu,
        redirectUrl,
        webhookUrl,
        customer: {
          name: data.name || undefined,
          phone: data.phone || undefined,
        },
      });

      console.log(
        "[CHECKOUT] resposta InfinitePay:",
        Boolean(url),
      );

      if (!url) {
        console.error(
          "[CHECKOUT] InfinitePay não retornou URL",
        );

        return {
          url: null,
          nsu: "",
          reason: "provider_error",
        };
      }

      console.log(
        "[CHECKOUT] checkout criado com sucesso",
      );

      return {
        url,
        nsu,
        reason: "created",
      };
    } catch (error) {
      console.error(
        "[CHECKOUT] ERRO COMPLETO:",
        error,
      );

      throw new Error(
        `Falha no checkout: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  });

/**
 * Liga o pedido recém-criado ao checkout.
 */
export const attachCheckout = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      orderId: string;
      nsu: string;
      url: string;
    }) => {
      if (
        !data?.orderId ||
        !data?.nsu ||
        !data?.url
      ) {
        throw new Error("input");
      }

      return data;
    },
  )
  .handler(async ({ data }) => {
    const {
      supabaseAdmin,
    } = await import(
      "@/integrations/supabase/client.server"
    );

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

    return {
      ok: !error,
    };
  });

/**
 * Gera ou reaproveita o link de pagamento
 * InfinitePay de um pedido existente.
 */
export const createOrderCheckout = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: { orderId: string }) => {
      if (
        !data?.orderId ||
        typeof data.orderId !== "string"
      ) {
        throw new Error("orderId");
      }

      return {
        orderId: data.orderId,
      };
    },
  )
  .handler(async ({ data }) => {
    const {
      createCheckoutLink,
      isConfigured,
    } = await import(
      "@/lib/infinitepay.server"
    );

    if (!isConfigured()) {
      return {
        url: null,
        reason: "not_configured",
      };
    }

    const {
      supabaseAdmin,
    } = await import(
      "@/integrations/supabase/client.server"
    );

    const {
      data: order,
      error,
    } = await supabaseAdmin
      .from("orders")
      .select(
        "id, total, discount, coins_discount, payment_status, payment_url, customer_name, customer_phone, items",
      )
      .eq("id", data.orderId)
      .maybeSingle();

    if (error || !order) {
      return {
        url: null,
        reason: "not_found",
      };
    }

    if (order.payment_status === "paid") {
      return {
        url: null,
        reason: "already_paid",
      };
    }

    if (order.payment_url) {
      return {
        url: order.payment_url as string,
        reason: "existing",
      };
    }

    const total = Number(order.total ?? 0);

    if (!(total > 0)) {
      return {
        url: null,
        reason: "invalid_total",
      };
    }

    const rawItems = Array.isArray(order.items)
      ? (order.items as Array<
          Record<string, unknown>
        >)
      : [];

    const hasDiscount =
      Number(order.discount ?? 0) > 0 ||
      Number(order.coins_discount ?? 0) > 0;

    const items = hasDiscount
      ? [
          {
            quantity: 1,
            price: Math.round(total * 100),
            description: `Pedido SPERB ${String(
              order.id,
            ).slice(0, 8)}`,
          },
        ]
      : rawItems.map((it) => ({
          quantity: Math.max(
            1,
            Math.round(
              Number(it["qty"] ?? 1),
            ),
          ),
          price: Math.round(
            Number(it["price"] ?? 0) * 100,
          ),
          description: String(
            it["name"] ?? "Produto SPERB",
          ).slice(0, 120),
        }));

    if (
      items.length === 0 ||
      items.some((i) => i.price <= 0)
    ) {
      items.splice(0, items.length, {
        quantity: 1,
        price: Math.round(total * 100),
        description: `Pedido SPERB ${String(
          order.id,
        ).slice(0, 8)}`,
      });
    }

    const request = getRequest();
    const origin = new URL(request.url).origin;

    const url = await createCheckoutLink({
      items,
      orderNsu: String(order.id),
      redirectUrl:
        `${origin}/pedidos?status=preparing`,
      webhookUrl:
        `${origin}/api/public/infinitepay-webhook`,
      customer: {
        name:
          (order.customer_name as string) ||
          undefined,
        phone:
          (order.customer_phone as string) ||
          undefined,
      },
    });

    if (!url) {
      return {
        url: null,
        reason: "provider_error",
      };
    }

    await supabaseAdmin.rpc(
      "set_order_payment_link",
      {
        p_order_id: String(order.id),
        p_url: url,
        p_provider: "infinitepay",
      },
    );

    return {
      url,
      reason: "created",
    };
  });