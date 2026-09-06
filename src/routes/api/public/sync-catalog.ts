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
      GET: async ({ request }) => {
        try {
          const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
          const catalog = await syncCatalogFromLoyverse();

          // Logo da loja: mesma velocidade dos produtos (troca na hora).
          try {
            const { refreshStoreLogoAndAnnounce } = await import("@/lib/store-logo.server");
            await refreshStoreLogoAndAnnounce();
          } catch (err) {
            console.error("[sync-catalog] logo", err);
          }

          // Mantém os avisos do Loyverse ligados, sem cadastro manual.
          if (Date.now() - lastWebhookCheck > 30 * 60 * 1000) {
            lastWebhookCheck = Date.now();
            try {
              const { ensureLoyverseWebhooks, webhookTargetUrl } = await import(
                "@/lib/loyverse-webhooks.server"
              );
              const origin =
                process.env["PUBLIC_APP_URL"] ?? new URL(request.url).origin;
              await ensureLoyverseWebhooks(webhookTargetUrl(origin));
            } catch (err) {
              console.error("[sync-catalog] webhooks", err);
            }
          }

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
