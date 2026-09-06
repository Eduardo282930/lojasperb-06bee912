import { createFileRoute } from "@tanstack/react-router";

/**
 * Garante que o Loyverse avise este app na hora (webhooks), sem cadastro manual.
 * Chamado sozinho pela conferência de catálogo e disponível para conferência.
 */
export const Route = createFileRoute("/api/public/ensure-webhooks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { ensureLoyverseWebhooks, webhookTargetUrl } = await import(
            "@/lib/loyverse-webhooks.server"
          );
          const origin =
            process.env["PUBLIC_APP_URL"] ?? new URL(request.url).origin;
          const result = await ensureLoyverseWebhooks(webhookTargetUrl(origin));
          return Response.json({ ...result, target: webhookTargetUrl(origin) });
        } catch (err) {
          console.error("[ensure-webhooks]", err);
          return Response.json({ ok: false, error: "ensure_failed" }, { status: 500 });
        }
      },
    },
  },
});
