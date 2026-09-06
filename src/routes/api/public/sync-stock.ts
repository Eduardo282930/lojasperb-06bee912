import { createFileRoute } from "@tanstack/react-router";

/**
 * Conferência rápida de estoque (Loyverse -> app).
 *
 * Chamada pelo próprio servidor de 5 em 5 segundos (agendador do banco). Lê
 * apenas os níveis de estoque no Loyverse e, quando algo muda, atualiza a
 * cópia oficial e avisa os aparelhos abertos — que trocam só aqueles produtos.
 */
export const Route = createFileRoute("/api/public/sync-stock")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { syncStockFromLoyverse } = await import(
            "@/lib/catalog-snapshot.server"
          );
          const { changed, checked } = await syncStockFromLoyverse();
          return Response.json({
            ok: true,
            changed: changed.length,
            changedIds: changed,
            checked,
            syncedAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[sync-stock]", err);
          return Response.json({ ok: false, error: "sync_failed" }, { status: 500 });
        }
      },
    },
  },
});
