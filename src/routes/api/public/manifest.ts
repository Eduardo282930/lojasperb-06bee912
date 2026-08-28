import { createFileRoute } from "@tanstack/react-router";

/**
 * Dynamic PWA manifest: the app icon is the official store logo
 * coming from the Loyverse item "LOGO DA LOJA".
 */
export const Route = createFileRoute("/api/public/manifest")({
  server: {
    handlers: {
      GET: async () => {
        let logo: string | null = null;
        try {
          const { fetchStoreLogoUrl } = await import("@/lib/store-logo.server");
          logo = await fetchStoreLogoUrl();
        } catch {
          logo = null;
        }

        const icons = logo
          ? [
              { src: logo, sizes: "192x192", type: "image/png", purpose: "any" },
              { src: logo, sizes: "512x512", type: "image/png", purpose: "any" },
              { src: logo, sizes: "512x512", type: "image/png", purpose: "maskable" },
            ]
          : [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }];

        return new Response(
          JSON.stringify({
            name: "SPERB",
            short_name: "SPERB",
            description:
              "Catálogo SPERB. Escolha seus produtos e envie o pedido pelo WhatsApp.",
            start_url: "/",
            display: "standalone",
            background_color: "#ffffff",
            theme_color: "#1a53ff",
            icons,
          }),
          {
            headers: {
              "content-type": "application/manifest+json",
              "cache-control": "public, max-age=600",
            },
          },
        );
      },
    },
  },
});
