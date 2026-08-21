import { createFileRoute } from "@tanstack/react-router";

/**
 * Sincronização automática Loyverse -> Supabase (upsert, sem duplicados).
 * Pode ser chamada por um agendador externo/pg_cron para manter o banco
 * central sempre em tempo real com o Loyverse.
 */
export const Route = createFileRoute("/api/public/sync-catalog")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
          const catalog = await syncCatalogFromLoyverse();
          return Response.json({
            ok: true,
            products: catalog.products.length,
            categories: catalog.categories.length,
            syncedAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[sync-catalog]", err);
          return Response.json({ ok: false, error: "sync_failed" }, { status: 500 });
        }
      },
    },
  },
});
