import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Minus, Plus, Trash2 } from "lucide-react";
import { useCart, updateQty, formatPrice, priceValue, clearCart } from "@/lib/cart";

const WHATSAPP_NUMBER = "5551996109657";

export const Route = createFileRoute("/sacola")({
  head: () => ({
    meta: [
      { title: "Sacola — SPERB" },
      { name: "description", content: "Revise seu pedido e envie pelo WhatsApp." },
    ],
  }),
  component: SacolaPage,
});

function SacolaPage() {
  const cart = useCart();
  const total = cart.reduce((s, c) => s + priceValue(c.price) * c.qty, 0);

  function enviarWhatsApp() {
    if (cart.length === 0) return;
    const linhas = cart.map(
      (c) => `- ${c.name} | Qtd: ${c.qty} | ${formatPrice(c.price)}`,
    );
    const totalStr = formatPrice(total);
    const texto =
      `Pedido SPERB\n\n${linhas.join("\n")}\n\nTotal: ${totalStr}`;
    const url = `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="min-h-screen bg-background pb-40">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            aria-label="Voltar"
            className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <ArrowLeft className="h-9 w-9" strokeWidth={2.5} />
          </Link>
          <h1 className="text-3xl font-black text-foreground">Sua Sacola</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {cart.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-2xl font-semibold text-foreground">Sua sacola está vazia.</p>
            <Link
              to="/"
              className="mt-6 inline-block rounded-2xl bg-primary px-8 py-5 text-2xl font-bold text-primary-foreground"
            >
              Ver produtos
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {cart.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-3xl border-2 border-border bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-2xl font-bold text-foreground">{c.name}</p>
                    <p className="mt-1 text-2xl font-black text-foreground">
                      {formatPrice(c.price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      aria-label="Diminuir"
                      onClick={() => updateQty(c.id, c.qty - 1)}
                      className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
                    >
                      {c.qty === 1 ? <Trash2 className="h-8 w-8" /> : <Minus className="h-8 w-8" strokeWidth={3} />}
                    </button>
                    <span className="w-12 text-center text-3xl font-black text-foreground">
                      {c.qty}
                    </span>
                    <button
                      aria-label="Aumentar"
                      onClick={() => updateQty(c.id, c.qty + 1)}
                      className="grid h-16 w-16 place-items-center rounded-2xl bg-[oklch(0.55_0.22_255)] text-white active:scale-95"
                    >
                      <Plus className="h-8 w-8" strokeWidth={3} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex items-center justify-between rounded-3xl border-2 border-border bg-card p-5">
              <span className="text-2xl font-bold text-foreground">Total</span>
              <span className="text-4xl font-black text-foreground">
                R$ {total.toFixed(2).replace(".", ",")}
              </span>
            </div>

            <button
              onClick={() => {
                if (confirm("Esvaziar a sacola?")) clearCart();
              }}
              className="mt-4 w-full rounded-2xl border-2 border-border bg-background py-4 text-xl font-bold text-muted-foreground active:scale-95"
            >
              Esvaziar sacola
            </button>
          </>
        )}
      </main>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-border bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <button
              onClick={enviarWhatsApp}
              className="flex w-full items-center justify-center gap-3 rounded-3xl bg-[oklch(0.62_0.19_145)] px-6 py-7 text-3xl font-black text-white shadow-xl active:scale-[0.98]"
            >
              <WhatsAppIcon className="h-10 w-10" />
              Enviar Pedido pelo WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.52 3.48A11.9 11.9 0 0 0 12 0C5.37 0 0 5.37 0 12a12 12 0 0 0 1.64 6.06L0 24l6.16-1.61A12 12 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.22-3.48-8.52ZM12 21.82a9.8 9.8 0 0 1-5-1.37l-.36-.21-3.66.96.98-3.56-.24-.37A9.82 9.82 0 1 1 12 21.82Zm5.4-7.35c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.66.15-.2.3-.76.96-.93 1.16-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.34.44-.5.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.9-2.19-.24-.57-.48-.5-.66-.5l-.56-.01c-.2 0-.5.07-.77.37-.27.3-1.02 1-1.02 2.44 0 1.44 1.05 2.83 1.2 3.03.15.2 2.07 3.17 5.02 4.44.7.3 1.25.48 1.68.62.7.22 1.35.19 1.86.12.57-.09 1.75-.71 2-1.4.25-.68.25-1.27.17-1.4-.07-.13-.27-.2-.57-.34Z" />
    </svg>
  );
}