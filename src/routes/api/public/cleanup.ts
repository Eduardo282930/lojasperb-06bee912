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
          const { data, error } = await rpc("cleanup_temporary_data");
          if (error) throw new Error(error.message);
          return Response.json({ ok: true, removed: data ?? {} });
        } catch (err) {
          console.error("[cleanup]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
