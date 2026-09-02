import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint de reconciliação Loyverse → SPERB.
 * Pode ser chamado por um agendador (cron) a cada poucos minutos.
 * Não devolve dados de clientes, apenas contadores.
 */
export const Route = createFileRoute("/api/public/loyverse-reconcile")({
  server: {
    handlers: {
      GET: async () => {
        const { reconcileWithLoyverse } = await import("@/lib/loyverse-reconcile.functions");
        const result = await reconcileWithLoyverse(72);
        return Response.json(result);
      },
      POST: async () => {
        const { reconcileWithLoyverse } = await import("@/lib/loyverse-reconcile.functions");
        const result = await reconcileWithLoyverse(72);
        return Response.json(result);
      },
    },
  },
});
