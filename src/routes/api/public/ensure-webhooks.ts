import { createFileRoute } from "@tanstack/react-router";

const FALLBACK_ORIGIN =
  "https://project--50628d9d-ee67-4887-b808-5e0452dad905-dev.lovable.app";

/** Em desenvolvimento a URL é local: o Loyverse precisa da URL pública. */
function publicOrigin(origin: string): string {
  const configured = process.env["PUBLIC_APP_URL"];
  if (configured) return configured;
  if (/localhost|127\.0\.0\.1|^http:/.test(origin)) return FALLBACK_ORIGIN;
  return origin;
}

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
            publicOrigin(new URL(request.url).origin);
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
