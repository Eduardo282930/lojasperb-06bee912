import { createFileRoute } from "@tanstack/react-router";

/**
 * Libera reservas de estoque de pedidos que não foram pagos no prazo.
 * Pode ser chamado por um agendador externo; também roda ao abrir um checkout.
 */
export const Route = createFileRoute("/api/public/expire-reservations")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("expire_stale_reservations");
          if (error) throw new Error(error.message);
          return Response.json({ ok: true, released: Number(data ?? 0) });
        } catch (err) {
          console.error("[expire-reservations]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
