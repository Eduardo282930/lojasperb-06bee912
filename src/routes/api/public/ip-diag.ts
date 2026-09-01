import { createFileRoute } from "@tanstack/react-router";

/** Diagnóstico temporário do checkout InfinitePay (sem expor o handle). */
export const Route = createFileRoute("/api/public/ip-diag")({
  server: {
    handlers: {
      GET: async () => {
        const h = (process.env["INFINITEPAY_HANDLE"] ?? "").trim();
        if (!h) return Response.json({ handle: false });
        const res = await fetch("https://api.checkout.infinitepay.io/links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: h,
            items: [{ quantity: 1, price: 1500, description: "Teste SPERB" }],
            order_nsu: `diag-${Date.now()}`,
            redirect_url: "https://lojasperb.lovable.app/pedidos",
            webhook_url: "https://lojasperb.lovable.app/api/public/infinitepay-webhook",
          }),
        });
        const text = await res.text();
        return Response.json({
          handle: true,
          handleLength: h.length,
          startsWithAt: h.startsWith("@"),
          status: res.status,
          body: text.slice(0, 500),
        });
      },
    },
  },
});
