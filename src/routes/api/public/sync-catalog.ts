import { createFileRoute } from "@tanstack/react-router";

/** Reconfere os avisos do Loyverse no máximo a cada 30 minutos. */
let lastWebhookCheck = 0;


/**
 * Conferência completa Loyverse -> app (rede de segurança, 1x por minuto).
 *
 * Relê tudo (nome, foto, categoria, preço, variações, estoque), regrava a
 * cópia oficial e avisa os aparelhos abertos apenas sobre os produtos que
 * realmente mudaram.
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
