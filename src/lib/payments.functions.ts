import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Valor mínimo aceito pela InfinitePay: R$ 1,00. */
export const MIN_CHECKOUT_BRL = 1;

/** Situação das credenciais — nunca expõe o valor do handle. */
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

type CheckoutItem = {
  quantity: number;
  price: number;
  description: string;
};

/**
 * Cria o checkout da InfinitePay para um pedido já existente.
 *
 * O valor usado aqui vem do pedido salvo no banco.
 * Isso evita diferença entre o valor mostrado na SPERB
 * e o valor enviado para a InfinitePay.
 */
export const createOrderCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string }) => {
    if (!data?.orderId || typeof data.orderId !== "string") {
      throw new Error("orderId");
    }

    return {
      orderId: data.orderId,
    };
  })
  .handler(
    async ({
      data,
    }): Promise<{
      url: string | null;
      reason: string;
    }> => {
      try {
        const {
          createCheckoutLink,
          isConfigured,
        } = await import("@/lib/infinitepay.server");

        if (!isConfigured()) {
          console.error(
            "[SPERB] InfinitePay não configurada.",
          );

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

        /*
         * Libera reservas antigas antes de trabalhar
         * com o novo checkout.
         */
        try {
          await supabaseAdmin.rpc(
            "expire_stale_reservations",
          );
        } catch (error) {
          console.warn(
            "[SPERB] Não foi possível expirar reservas antigas:",
            error,
          );
        }

        /*
         * Busca o pedido completo.
         */
        const {
          data: order,
          error,
        } = await supabaseAdmin
          .from("orders")
          .select(
            "id, total, discount, coins_discount, payment_status, payment_url, payment_nsu, payment_provider, customer_name, customer_phone, customer_email, items",
          )

          .eq("id", data.orderId)
          .maybeSingle();

        if (error) {
          console.error(
            "[SPERB] Erro ao buscar pedido:",
            error,
          );

          return {
            url: null,
            reason: "not_found",
          };
        }

        if (!order) {
          return {
            url: null,
            reason: "not_found",
          };
        }

        /*
         * Pedido já pago não deve gerar outro checkout.
         */
        if (order.payment_status === "paid") {
          return {
            url: null,
            reason: "already_paid",
          };
        }

        /*
         * Se já existe link, reaproveita.
         */
        if (order.payment_url) {
          return {
            url: String(order.payment_url),
            reason: "existing",
          };
        }

        /*
         * Valor oficial do pedido.
         */
        const total = Number(order.total ?? 0);

        if (!Number.isFinite(total) || total <= 0) {
          console.error(
            "[SPERB] Total inválido:",
            total,
          );

          return {
            url: null,
            reason: "invalid_total",
          };
        }

        /*
         * A InfinitePay trabalha com preço em centavos.
         */
        const totalCents = Math.round(total * 100);

        /*
         * InfinitePay não aceita checkout abaixo de R$ 1,00.
         */
        if (
          totalCents <
          MIN_CHECKOUT_BRL * 100
        ) {
          return {
            url: null,
            reason: "min_value",
          };
        }

        /*
         * Itens originais do pedido.
         */
        const rawItems = Array.isArray(order.items)
          ? (order.items as Array<
              Record<string, unknown>
            >)
          : [];

        const hasDiscount =
          Number(order.discount ?? 0) > 0 ||
          Number(order.coins_discount ?? 0) > 0;

        const label =
          `Pedido SPERB ${String(order.id).slice(0, 8)}`;

        /*
         * Item único usando o TOTAL REAL.
         *
         * Isso é importante quando existe cupom ou moedas:
         * a InfinitePay recebe exatamente o valor final.
         */
        const totalItem: CheckoutItem = {
          quantity: 1,
          price: totalCents,
          description: label,
        };

        let items: CheckoutItem[];

        if (hasDiscount) {
          items = [totalItem];
        } else {
          items = rawItems.map((item) => {
            const quantity = Math.max(
              1,
              Math.round(
                Number(
                  item["qty"] ?? 1,
                ),
              ),
            );

            const price = Math.round(
              Number(
                item["price"] ?? 0,
              ) * 100,
            );

            return {
              quantity,
              price,
              description: String(
                item["name"] ??
                  "Produto SPERB",
              ).slice(0, 120),
            };
          });
        }

        /*
         * Confere se os itens realmente fecham
         * exatamente com o total do pedido.
         */
        const validItems =
          items.length > 0 &&
          items.every(
            (item) =>
              Number.isFinite(item.price) &&
              item.price > 0 &&
              Number.isFinite(item.quantity) &&
              item.quantity > 0,
          );

        const calculatedTotal = items.reduce(
          (sum, item) =>
            sum +
            item.price *
              item.quantity,
          0,
        );

        /*
         * Se houver qualquer diferença,
         * usa um único item com o total oficial.
         */
        if (
          !validItems ||
          calculatedTotal !== totalCents
        ) {
          items = [totalItem];
        }

        /*
         * Segurança adicional:
         * garante que nunca enviamos valor menor
         * que R$ 1,00 para a InfinitePay.
         */
        const finalItemsTotal =
          items.reduce(
            (sum, item) =>
              sum +
              item.price *
                item.quantity,
            0,
          );

        if (
          finalItemsTotal <
          MIN_CHECKOUT_BRL * 100
        ) {
          return {
            url: null,
            reason: "min_value",
          };
        }

        const request = getRequest();

        const origin =
          new URL(request.url).origin;

        /*
         * Usa o NSU existente quando houver.
         * Caso contrário, usa o ID do pedido.
         */
        const nsu =
          order.payment_nsu
            ? String(order.payment_nsu)
            : String(order.id);

        const redirectUrl =
          `${origin}/pedidos?status=topay&checkout=1`;

        const webhookUrl =
          `${origin}/api/public/infinitepay-webhook`;

        console.log(
          "[SPERB] Criando checkout InfinitePay:",
          {
            orderId: String(order.id),
            total,
            totalCents,
            nsu,
            items,
          },
        );

        /*
         * Cria o checkout.
         */
        const url =
          await createCheckoutLink({
            items,
            orderNsu: nsu,
            redirectUrl,
            webhookUrl,
            customer: {
              name:
                typeof order.customer_name ===
                "string"
                  ? order.customer_name
                  : undefined,

              phone:
                typeof order.customer_phone ===
                "string"
                  ? order.customer_phone
                  : undefined,

              email:
                typeof order.customer_email ===
                "string"
                  ? order.customer_email
                  : undefined,
            },
          });

        if (!url) {
          console.error(
            "[SPERB] InfinitePay não retornou checkout.",
          );

          return {
            url: null,
            reason: "provider_error",
          };
        }

        /*
         * Salva o link no pedido.
         */
        const {
          error: updateError,
        } = await supabaseAdmin
          .from("orders")
          .update({
            payment_provider:
              "infinitepay",

            payment_url:
              url,

            payment_nsu:
              nsu,
          })
          .eq(
            "id",
            order.id,
          );

        if (updateError) {
          console.error(
            "[SPERB] Erro ao salvar checkout no pedido:",
            updateError,
          );

          /*
           * Mesmo que o salvamento falhe,
           * o checkout já foi criado.
           */
        }

        console.log(
          "[SPERB] Checkout criado:",
          String(order.id),
        );

        return {
          url,
          reason: "created",
        };
      } catch (error) {
        console.error(
          "[SPERB] ERRO createOrderCheckout:",
          error,
        );

        return {
          url: null,
          reason: "provider_error",
        };
      }
    },
  );

/**
 * Cancela um pedido que não conseguiu abrir o pagamento
 * e libera a reserva de estoque.
 */
export const abandonOrder = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: { orderId: string }) => {
      if (!data?.orderId) {
        throw new Error("orderId");
      }

      return {
        orderId: data.orderId,
      };
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    /*
     * Checkout não abriu: o pedido é apagado por completo (junto da reserva
     * temporária de estoque). Assim nada aparece como "Pedido recebido".
     */
    const { data: removed } = await supabaseAdmin.rpc("discard_unpaid_order", {
      p_order_id: data.orderId,
    });

    if (removed) return { ok: true };

    /* Se não deu para apagar (já pago/sincronizado), apenas cancela. */
    await supabaseAdmin
      .from("order_stock_reservations")
      .update({ active: false })
      .eq("order_id", data.orderId);

    await supabaseAdmin
      .from("orders")
      .update({ status: "canceled", flow_state: "CANCELLED" })
      .eq("id", data.orderId)
      .neq("payment_status", "paid");

    return { ok: true };
  });
