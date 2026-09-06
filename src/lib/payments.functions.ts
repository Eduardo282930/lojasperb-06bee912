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

type CheckoutOrder = {
  id: string;
  total: number | null;
  discount: number | null;
  coins_discount: number | null;
  payment_status: string | null;
  payment_url: string | null;
  payment_nsu: string | null;
  payment_provider: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  items: unknown;
};

type CheckoutResult = {
  url: string | null;
  reason: string;
  orderId?: string;
  /** Mensagem pronta para o cliente quando o carrinho mudou no Loyverse. */
  message?: string;
  /** Preço/estoque atuais do Loyverse, para corrigir o carrinho na tela. */
  fresh?: Array<{
    id: string;
    name: string;
    price: number;
    stock: number;
    available: boolean;
  }>;
};

/**
 * Cria o link da InfinitePay para um pedido que o servidor já conhece.
 * Nunca relê o pedido do banco: o chamador entrega os dados, então não
 * existe a janela de "pedido ainda invisível" que gerava not_found.
 */
async function linkCheckoutToOrder(
  order: CheckoutOrder,
): Promise<CheckoutResult> {
  const { createCheckoutLink, isConfigured } =
    await import("@/lib/infinitepay.server");
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  if (!isConfigured()) {
    console.error("[SPERB] InfinitePay não configurada.");
    return { url: null, reason: "not_configured" };
  }

  /* Pedido já pago não deve gerar outro checkout. */
  if (order.payment_status === "paid") {
    return { url: null, reason: "already_paid" };
  }

  /* Se já existe link, reaproveita. */
  if (order.payment_url) {
    return { url: String(order.payment_url), reason: "existing" };
  }

  /* Valor oficial do pedido. */
  const total = Number(order.total ?? 0);

  if (!Number.isFinite(total) || total <= 0) {
    console.error("[SPERB] Total inválido:", total);
    return { url: null, reason: "invalid_total" };
  }

  /* A InfinitePay trabalha com preço em centavos. */
  const totalCents = Math.round(total * 100);

  /* InfinitePay não aceita checkout abaixo de R$ 1,00. */
  if (totalCents < MIN_CHECKOUT_BRL * 100) {
    return { url: null, reason: "min_value" };
  }

  /* Itens originais do pedido. */
  const rawItems = Array.isArray(order.items)
    ? (order.items as Array<Record<string, unknown>>)
    : [];

  const hasDiscount =
    Number(order.discount ?? 0) > 0 ||
    Number(order.coins_discount ?? 0) > 0;

  const label = `Pedido SPERB ${String(order.id).slice(0, 8)}`;

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
      const quantity = Math.max(1, Math.round(Number(item["qty"] ?? 1)));
      const price = Math.round(Number(item["price"] ?? 0) * 100);

      return {
        quantity,
        price,
        description: String(item["name"] ?? "Produto SPERB").slice(0, 120),
      };
    });
  }

  /* Confere se os itens realmente fecham exatamente com o total do pedido. */
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
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  /*
   * Se houver qualquer diferença,
   * usa um único item com o total oficial.
   */
  if (!validItems || calculatedTotal !== totalCents) {
    items = [totalItem];
  }

  /*
   * Segurança adicional:
   * garante que nunca enviamos valor menor
   * que R$ 1,00 para a InfinitePay.
   */
  const finalItemsTotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  if (finalItemsTotal < MIN_CHECKOUT_BRL * 100) {
    return { url: null, reason: "min_value" };
  }

  const request = getRequest();
  const origin = new URL(request.url).origin;

  /*
   * Usa o NSU existente quando houver.
   * Caso contrário, usa o ID do pedido.
   */
  const nsu = order.payment_nsu ? String(order.payment_nsu) : String(order.id);

  const redirectUrl = `${origin}/pedidos?status=preparing&checkout=1`;
  const webhookUrl = `${origin}/api/public/infinitepay-webhook`;

  console.log("[SPERB] Criando checkout InfinitePay:", {
    orderId: String(order.id),
    total,
    totalCents,
    nsu,
    items,
  });

  /* Cria o checkout. */
  const url = await createCheckoutLink({
    items,
    orderNsu: nsu,
    redirectUrl,
    webhookUrl,
    customer: {
      name:
        typeof order.customer_name === "string"
          ? order.customer_name
          : undefined,
      phone:
        typeof order.customer_phone === "string"
          ? order.customer_phone
          : undefined,
      email:
        typeof order.customer_email === "string"
          ? order.customer_email
          : undefined,
    },
  });

  if (!url) {
    console.error("[SPERB] InfinitePay não retornou checkout.");
    return { url: null, reason: "provider_error" };
  }

  /* Salva o link no pedido. */
  const { error: updateError } = await supabaseAdmin
    .from("orders")
    .update({
      payment_provider: "infinitepay",
      payment_url: url,
      payment_nsu: nsu,
      /* O cliente tem 60 minutos para pagar; a reserva segue de pé até lá. */
      payment_deadline_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } as never)
    .eq("id", order.id);

  if (updateError) {
    console.error(
      "[SPERB] Erro ao salvar checkout no pedido:",
      updateError,
    );
    /* Mesmo que o salvamento falhe, o checkout já foi criado. */
  }

  console.log("[SPERB] Checkout criado:", String(order.id));

  return { url, reason: "created" };
}

/**
 * Fluxo principal do botão "Pagar Pix/cartão".
 *
 * Tudo acontece dentro do servidor, em uma única chamada:
 * valida o carrinho, cria o pedido com a reserva de estoque, cria o
 * checkout da InfinitePay, grava o link e devolve a URL. Qualquer falha
 * antes do link apaga o pedido e libera a reserva — nada vira
 * "pedido recebido" à toa.
 */
export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      deviceId: string;
      holdId?: string;
      name: string;
      phone: string;
      email: string;
      items: Array<{
        id: string;
        name: string;
        qty: number;
        price: number;
        image?: string | null;
      }>;
      subtotal: number;
      discount: number;
      total: number;
      couponCode: string;
      coins: number;
    }) => {
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        throw new Error("items");
      }
      if (typeof data.name !== "string" || !data.name.trim()) {
        throw new Error("name");
      }
      if (typeof data.phone !== "string" || data.phone.replace(/\D/g, "").length < 8) {
        throw new Error("phone");
      }

      return {
        deviceId: String(data.deviceId ?? ""),
        holdId: String(data.holdId ?? ""),
        name: data.name.trim().slice(0, 120),
        phone: String(data.phone).slice(0, 30),
        email: String(data.email ?? "").trim().slice(0, 200),
        items: data.items.slice(0, 50).map((item) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? "").slice(0, 120),
          qty: Math.max(1, Math.min(999, Math.round(Number(item.qty) || 1))),
          price: Math.max(0, Number(item.price) || 0),
          image: item.image ? String(item.image) : null,
        })),
        subtotal: Math.max(0, Number(data.subtotal) || 0),
        discount: Math.max(0, Number(data.discount) || 0),
        total: Math.max(0, Number(data.total) || 0),
        couponCode: String(data.couponCode ?? "").slice(0, 40),
        coins: Math.max(0, Math.trunc(Number(data.coins) || 0)),
      };
    },
  )

  .handler(async ({ data }): Promise<CheckoutResult> => {
    let orderId: string | null = null;

    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      /*
       * Conferência obrigatória no Loyverse antes de cobrar qualquer valor:
       * preço, estoque, disponibilidade e variação. Se algo mudou, nenhum
       * pedido é criado e o cliente vê o carrinho corrigido.
       */
      const { validateCartAgainstLoyverse, problemMessage } = await import(
        "@/lib/checkout-validate.server"
      );
      const check = await validateCartAgainstLoyverse(data.items);
      if (!check.ok) {
        return {
          url: null,
          reason: "cart_changed",
          message: problemMessage(check.problems),
          fresh: check.items.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            stock: i.stock,
            available: i.available,
          })),
        };
      }


      /* Libera reservas antigas antes de trabalhar com o novo checkout. */
      try {
        await supabaseAdmin.rpc("expire_stale_reservations");
      } catch (error) {
        console.warn("[SPERB] Não foi possível expirar reservas antigas:", error);
      }

      /*
       * Cria o pedido definitivo. Quando existe reserva temporária (hold),
       * ela é consumida na MESMA transação: o estoque nunca fica livre entre
       * a conferência e o pedido, e dois clientes não pegam a mesma unidade.
       */
      const orderArgs = {
        p_device_id: data.deviceId,
        p_name: data.name,
        p_phone: data.phone,
        p_email: data.email,
        p_items: data.items as never,
        p_subtotal: data.subtotal,
        p_discount: data.discount,
        p_total: data.total,
        p_coupon_code: data.couponCode,
        p_coins: data.coins,
      };
      const rpcCall = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data?: unknown; error?: { message: string } | null }>;

      const { data: created, error: createError } = data.holdId
        ? await rpcCall("create_order_from_hold", {
            p_hold_id: data.holdId,
            ...orderArgs,
          })
        : await rpcCall("create_order", orderArgs);

      if (createError || !created) {
        console.error("[SPERB] Erro ao criar pedido:", createError);
        const message = createError?.message ?? "sem retorno";
        return {
          url: null,
          reason: message.includes("out_of_stock")
            ? "out_of_stock"
            : `create_order: ${message}`,
        };
      }


      orderId = String(created);

      /*
       * O pedido já está na memória — nada de reler no banco.
       * A RPC recalcula o total com o desconto de moedas, então o total
       * pode ser menor que o enviado; buscamos o valor oficial apenas
       * quando moedas foram usadas.
       */
      let total = data.total;
      let coinsDiscount = 0;

      if (data.coins > 0) {
        const { data: row } = await supabaseAdmin
          .from("orders")
          .select("total, coins_discount")
          .eq("id", orderId)
          .maybeSingle();
        if (row) {
          total = Number((row as { total?: number }).total ?? data.total);
          coinsDiscount = Number(
            (row as { coins_discount?: number }).coins_discount ?? 0,
          );
        }
      }

      const order: CheckoutOrder = {
        id: orderId,
        total,
        discount: data.discount,
        coins_discount: coinsDiscount,
        payment_status: "pending",
        payment_url: null,
        payment_nsu: null,
        payment_provider: null,
        customer_name: data.name,
        customer_phone: data.phone,
        customer_email: data.email,
        items: data.items,
      };

      const checkout = await linkCheckoutToOrder(order);

      if (!checkout.url) {
        /* Falhou antes da tela de pagamento: apaga o pedido e libera o estoque. */
        try {
          await supabaseAdmin.rpc("discard_unpaid_order", {
            p_order_id: orderId,
          });
        } catch {
          /* já logado no servidor */
        }
        orderId = null;
      }

      return { ...checkout, orderId: orderId ?? undefined };
    } catch (error) {
      console.error("[SPERB] ERRO startCheckout:", error);

      if (orderId) {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          await supabaseAdmin.rpc("discard_unpaid_order", {
            p_order_id: orderId,
          });
        } catch {
          /* já logado acima */
        }
      }

      const detail =
        error instanceof Error ? error.message.slice(0, 160) : String(error);
      return { url: null, reason: `exception: ${detail}` };
    }
  });

/**
 * Cria o checkout da InfinitePay para um pedido já existente
 * (usado pelo botão "pagar" em Meus pedidos).
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
  .handler(async ({ data }): Promise<CheckoutResult> => {
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      /*
       * Libera reservas antigas antes de trabalhar
       * com o novo checkout.
       */
      try {
        await supabaseAdmin.rpc("expire_stale_reservations");
      } catch (error) {
        console.warn(
          "[SPERB] Não foi possível expirar reservas antigas:",
          error,
        );
      }

      let order: CheckoutOrder | null = null;
      let orderError: { message?: string } | null = null;

      /*
       * O pedido é criado no navegador e consultado imediatamente no servidor.
       * Em produção, essa troca pode chegar à leitura antes de a nova linha ficar
       * visível no endpoint de dados. Repetimos somente essa leitura curta para
       * não devolver um falso `not_found` e deixar uma reserva órfã.
       */
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await supabaseAdmin
          .from("orders")
          .select(
            "id, total, discount, coins_discount, payment_status, payment_url, payment_nsu, payment_provider, customer_name, customer_phone, customer_email, items",
          )
          .eq("id", data.orderId)
          .maybeSingle();

        order = result.data as CheckoutOrder | null;
        orderError = result.error;
        if (order || orderError) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }

      if (orderError) {
        console.error("[SPERB] Erro ao buscar pedido:", orderError);
        return {
          url: null,
          reason: `database_error: ${orderError.message ?? "consulta"}`,
        };
      }

      if (!order) {
        return { url: null, reason: "not_found" };
      }

      return await linkCheckoutToOrder(order);
    } catch (error) {
      console.error("[SPERB] ERRO createOrderCheckout:", error);
      return { url: null, reason: "provider_error" };
    }
  });

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
