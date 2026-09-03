import { createServerFn } from "@tanstack/react-start";
import { receiptPages } from "./loyverse-sync.functions";

type AnyRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{
  data?: unknown;
  error?: { message?: string } | null;
}>;

type ReconcileOrder = {
  id: string;
  loyverse_refund_id?: string | null;
};

export type ReconcileResult = {
  ok: boolean;
  refundsApplied: number;
  resynced: number;
  reason?: string;
};

/**
 * Reconcilia o SPERB com o Loyverse.
 *
 * Regras:
 * - Reembolso/cancelamento identificado no Loyverse cancela o pedido no SPERB.
 * - O dinheiro NÃO é considerado devolvido automaticamente.
 * - O pedido fica com refund_state = "money_pending" até a confirmação real.
 * - Moedas e cupom são tratados pela RPC do banco, de forma idempotente.
 * - Pedidos pagos sem recibo são reenviados ao Loyverse.
 */
export async function reconcileWithLoyverse(
  hours = 24 * 30,
): Promise<ReconcileResult> {
  const token = process.env["LOYVERSE_TOKEN"];

  if (!token) {
    return {
      ok: false,
      refundsApplied: 0,
      resynced: 0,
      reason: "no_token",
    };
  }

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const rpc = supabaseAdmin.rpc.bind(
    supabaseAdmin,
  ) as unknown as AnyRpc;

  const since = new Date(
    Date.now() - hours * 3600 * 1000,
  ).toISOString();

  let refundsApplied = 0;
  let resynced = 0;

  /*
   * 1. Primeiro verifica cancelamentos/reembolsos do Loyverse.
   *
   * Isso precisa acontecer antes do reenvio de recibos para impedir que
   * uma venda já cancelada seja recriada indevidamente.
   */
  try {
    const receipts = await receiptPages(token, since);

    const refunds = receipts.filter((receipt) => {
      const type = String(
        receipt.receipt_type ?? "",
      ).toUpperCase();

      return (
        type === "REFUND" ||
        Boolean(receipt.cancelled_at)
      );
    });

    for (const refund of refunds) {
      const type = String(
        refund.receipt_type ?? "",
      ).toUpperCase();

      const isRefund = type === "REFUND";

      /*
       * Em um REFUND, refund_for aponta para o recibo original.
       *
       * Em um cancelamento, o próprio receipt_number identifica
       * a venda que foi cancelada.
       */
      const saleId = isRefund
        ? refund.refund_for
        : refund.receipt_number;

      if (!saleId) {
        continue;
      }

      /*
       * ID único do evento.
       *
       * O índice UNIQUE do banco impede processamento duplicado.
       */
      const refundId = isRefund
        ? refund.receipt_number
        : `cancelled:${refund.receipt_number ?? ""}`;

      if (!refundId) {
        continue;
      }

      const { data: rawOrder, error } =
        await supabaseAdmin
          .from("orders")
          .select(
            "id, loyverse_refund_id",
          )
          .eq(
            "loyverse_receipt_id",
            saleId,
          )
          .maybeSingle();

      if (error) {
        console.error(
          "[reconcile] erro ao localizar pedido pelo recibo:",
          error.message,
        );
        continue;
      }

      const order =
        rawOrder as ReconcileOrder | null;

      /*
       * Não encontrou o pedido:
       * não cria vínculo artificial.
       */
      if (!order) {
        continue;
      }

      /*
       * Já foi processado.
       */
      if (order.loyverse_refund_id) {
        continue;
      }

      /*
       * O Loyverse confirma o cancelamento/reembolso da venda,
       * mas isso NÃO significa que o dinheiro já voltou ao cliente.
       *
       * Portanto p_money_refunded = false.
       *
       * A RPC do banco:
       * - coloca status = canceled;
       * - coloca refund_state = money_pending;
       * - libera a reserva;
       * - devolve moedas usadas;
       * - libera o cupom;
       * - registra histórico;
       * - evita duplicidade.
       */
      const applied = await rpc(
        "cancel_order_from_refund",
        {
          p_order_id: order.id,
          p_refund_id: refundId,
          p_money_refunded: false,
        },
      );

      if (applied.error) {
        console.error(
          "[reconcile] erro ao aplicar reembolso:",
          applied.error.message,
        );
        continue;
      }

      if (applied.data === true) {
        refundsApplied += 1;
      }
    }
  } catch (error) {
    console.error(
      "[reconcile] erro ao consultar reembolsos do Loyverse:",
      error,
    );
  }

  /*
   * 2. Recupera pedidos pagos que ainda não possuem recibo.
   *
   * Isso mantém a integração resiliente caso uma tentativa anterior
   * tenha falhado.
   */
  try {
    const { data: pending, error } =
      await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("payment_status", "paid")
        .is("loyverse_receipt_id", null)
        .gte("created_at", since)
        .limit(50);

    if (error) {
      console.error(
        "[reconcile] erro buscando pedidos sem recibo:",
        error.message,
      );
    } else if (pending?.length) {
      const { syncPaidOrder } =
        await import(
          "@/lib/loyverse-sync.functions"
        );

      for (const order of pending) {
        try {
          const result =
            await syncPaidOrder(order.id);

          if (result.ok) {
            resynced += 1;
          }
        } catch (error) {
          console.error(
            `[reconcile] erro ao sincronizar pedido ${order.id}:`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "[reconcile] erro no reenvio:",
      error,
    );
  }

  return {
    ok: true,
    refundsApplied,
    resynced,
  };
}

/**
 * Reconciliação completa.
 *
 * Janela padrão: últimos 30 dias.
 */
export const runLoyverseReconcile =
  createServerFn({
    method: "POST",
  }).handler(
    async (): Promise<ReconcileResult> =>
      reconcileWithLoyverse(),
  );

/**
 * Reconciliação rápida.
 *
 * Usada quando o cliente abre "Minhas compras"
 * ou quando o Admin abre os pedidos.
 *
 * Verifica as últimas 72 horas para que alterações
 * recentes do Loyverse apareçam rapidamente.
 */
export const runLoyverseQuickSync =
  createServerFn({
    method: "POST",
  }).handler(
    async (): Promise<ReconcileResult> =>
      reconcileWithLoyverse(72),
  );