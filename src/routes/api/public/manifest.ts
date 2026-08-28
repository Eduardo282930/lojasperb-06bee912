import { createFileRoute } from "@tanstack/react-router";

/**
 * Manifesto PWA do app SPERB. O ícone padrão é local; o logo da loja
 * configurado no Medusa é usado dentro do app.
 */
export const Route = createFileRoute("/api/public/manifest")({
  server: {
    handlers: {
      GET: async () => {
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
            icons: [
              { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            ],
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
