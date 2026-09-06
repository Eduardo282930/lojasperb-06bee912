import { createServerFn } from "@tanstack/react-start";

/**
 * Conferência final antes de fechar um pedido pelo WhatsApp.
 *
 * O aparelho não decide preço nem estoque: o servidor relê o Loyverse e
 * responde se pode seguir. Se algo mudou, devolve a mensagem pronta e os
 * valores atuais para corrigir o carrinho na tela.
 */
export const checkCartBeforeOrder = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { items: Array<{ id: string; name: string; qty: number; price: number }> }) => ({
      items: (Array.isArray(data?.items) ? data.items : []).slice(0, 50).map((i) => ({
        id: String(i?.id ?? ""),
        name: String(i?.name ?? "").slice(0, 120),
        qty: Math.max(1, Math.min(999, Math.round(Number(i?.qty) || 1))),
        price: Math.max(0, Number(i?.price) || 0),
      })),
    }),
  )
  .handler(async ({ data }) => {
    const { validateCartAgainstLoyverse, problemMessage } = await import(
      "@/lib/checkout-validate.server"
    );
    try {
      const check = await validateCartAgainstLoyverse(data.items);
      return {
        ok: check.ok,
        message: check.ok ? "" : problemMessage(check.problems),
        fresh: check.items.map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          stock: i.stock,
          available: i.available,
        })),
      };
    } catch (err) {
      console.error("[checkCartBeforeOrder]", err);
      return {
        ok: false,
        message:
          "Não foi possível confirmar os preços e o estoque agora. Tente novamente em instantes.",
        fresh: [] as Array<{
          id: string;
          name: string;
          price: number;
          stock: number;
          available: boolean;
        }>,
      };
    }
  });
