import { createFileRoute } from "@tanstack/react-router";

/**
 * Limpeza automática de dados temporários no Supabase.
 * Remove reservas vencidas, retratos de estoque sem uso, cupons desativados
 * sem nenhum vínculo e avisos antigos já lidos.
 * NUNCA apaga pedidos, pagamentos, moedas ou histórico.
 * Pode ser chamada por um agendador (cron) uma vez por dia.
 */
export const Route = createFileRoute("/api/public/cleanup")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
            name: string,
          ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
          /* Pagamento online sem pagamento em 60 minutos: cancela, libera e avisa o cliente. */
          const { data: expired } = await rpc("cancel_expired_unpaid_orders_ids");
          const expiredIds = Array.isArray(expired) ? (expired as string[]) : [];
          if (expiredIds.length) {
            const { notifyOrderEvent } = await import("@/lib/web-push.server");
            for (const orderId of expiredIds) {
              try {
                await notifyOrderEvent(orderId, "canceled_unpaid");
              } catch (err) {
                console.error("[cleanup] aviso de cancelamento", orderId, err);
              }
            }
          }
          const { data, error } = await rpc("cleanup_temporary_data");
          if (error) throw new Error(error.message);
          return Response.json({
            ok: true,
            canceledUnpaid: expiredIds.length,
            removed: data ?? {},
          });
        } catch (err) {
          console.error("[cleanup]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
