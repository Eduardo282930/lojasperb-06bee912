import { createFileRoute } from "@tanstack/react-router";

/**
 * Sincronizador de segurança Loyverse -> app.
 *
 * Roda sozinho a cada minuto (agendador do banco, pg_cron + pg_net). Relê o
 * catálogo no Loyverse e, SÓ quando preço/estoque/disponibilidade/variações
 * mudam de verdade, sobe a revisão do catálogo — o que faz todos os aparelhos
 * abertos atualizarem a vitrine na hora, sem recarregar a página.
 */
export const Route = createFileRoute("/api/public/sync-catalog")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
          const { publishCatalogRevision } = await import(
            "@/lib/catalog-revision.server"
          );
          const catalog = await syncCatalogFromLoyverse();
          const changed = await publishCatalogRevision(catalog);
          return Response.json({
            ok: true,
            changed,
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
