import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Minus, Plus, Trash2, Check, ShoppingCart } from "lucide-react";
import { StoreLogoWithFallback } from "@/components/store-logo";
import { BackButton } from "@/components/back-button";
import { useCart, updateQty, formatPrice, priceValue, clearCart, applyFreshCart } from "@/lib/cart";
import { SELECTION_KEY } from "@/lib/checkout-selection";
import { createStockHold, releaseStockHold } from "@/lib/stock";

export const Route = createFileRoute("/sacola")({
  head: () => ({
    meta: [
      { title: "Carrinho — SPERB" },
      { name: "description", content: "Revise seu pedido e envie pelo WhatsApp." },
    ],
  }),
  component: SacolaPage,
});

function SacolaPage() {
  const cart = useCart();
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const navigate = Route.useNavigate();

  // Estilo Shopee: o cliente escolhe quais itens entram no pedido.
  const isPicked = (id: string) => !unchecked.includes(id);
  const picked = cart.filter((c) => isPicked(c.id));
  const allPicked = cart.length > 0 && picked.length === cart.length;
  function togglePick(id: string) {
    setUnchecked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function toggleAll() {
    setUnchecked(allPicked ? cart.map((c) => c.id) : []);
  }

  const subtotal = picked.reduce((s, c) => s + priceValue(c.price) * c.qty, 0);

  /**
   * "Fazer pedido" não cria pedido nenhum: valida o estoque em tempo real e
   * reserva as unidades de forma atômica. Só depois o cliente vai conferir e
   * escolher WhatsApp ou Pix.
   */
  async function irParaConfirmacao() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setErro("");
    try {
      await releaseStockHold();
      const hold = await createStockHold(
        picked.map((c) => ({
          id: c.id,
          name: c.name,
          qty: c.qty,
          price: priceValue(c.price),
        })),
      );
      if (!hold.ok) {
        // O Loyverse é a palavra final: corrige o carrinho e explica o que mudou.
        if (hold.fresh.length > 0) applyFreshCart(hold.fresh);
        setErro(
          hold.message ||
            (hold.problems.length > 0
              ? `Sem estoque suficiente: ${hold.problems
                  .map(
                    (p) =>
                      `${p.name || "produto"} (restam ${Math.max(0, Math.floor(p.available))})`,
                  )
                  .join(", ")}. Ajuste a quantidade para continuar.`
              : "Não foi possível reservar o estoque agora. Tente novamente."),
        );
        return;
      }
      window.localStorage.setItem(SELECTION_KEY, JSON.stringify(picked.map((c) => c.id)));
      void navigate({ to: "/confirmar" });
    } catch (err) {
      console.error("[sacola] fazer pedido", err);
      setErro("Não foi possível reservar o estoque agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="layer-header safe-top sticky top-0 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <BackButton
            fallback="/"
            className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
            iconClassName="h-8 w-8"
          />
          <StoreLogoWithFallback
            storeName="SPERB"
            className="h-9 w-auto max-w-24 object-contain"
            fallbackClassName="text-lg font-black text-foreground"
          />
          <h1 className="text-2xl font-black text-foreground">Meu Carrinho</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {cart.length === 0 ? (
          <div className="mt-8 rounded-3xl border-2 border-dashed border-border bg-card p-8 text-center">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-muted">
              <ShoppingCart className="h-10 w-10 text-muted-foreground" />
            </span>
            <p className="mt-4 text-2xl font-black text-foreground">
              Seu carrinho está vazio
            </p>
            <p className="mt-1 text-base font-semibold text-muted-foreground">
              Escolha seus produtos com calma. Eles ficam guardados aqui.
            </p>
            <Link
              to="/"
              className="mt-6 inline-block rounded-2xl bg-[oklch(0.55_0.22_255)] px-8 py-4 text-xl font-black text-white active:scale-95"
            >
              Ver produtos
            </Link>
          </div>
        ) : (
          <>
            <button
              onClick={toggleAll}
              className="mb-2 inline-flex items-center gap-2 text-sm font-black text-foreground"
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-md border-2 ${
                  allPicked
                    ? "border-[oklch(0.62_0.19_145)] bg-[oklch(0.62_0.19_145)] text-white"
                    : "border-border bg-background text-transparent"
                }`}
              >
                <Check className="h-4 w-4" strokeWidth={4} />
              </span>
              {allPicked ? "Desmarcar todos" : "Selecionar todos"}
            </button>

            <ul className="flex flex-col gap-2">
              {cart.map((c) => {
                const max =
                  typeof c.stock === "number" && Number.isFinite(c.stock)
                    ? Math.floor(c.stock)
                    : 999;
                const atMax = c.qty >= max;
                const on = isPicked(c.id);
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-2 rounded-xl border bg-card p-2 ${
                      on ? "border-border" : "border-dashed border-border opacity-60"
                    }`}
                  >
                    <button
                      aria-label={on ? "Tirar do pedido" : "Incluir no pedido"}
                      onClick={() => togglePick(c.id)}
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 ${
                        on
                          ? "border-[oklch(0.62_0.19_145)] bg-[oklch(0.62_0.19_145)] text-white"
                          : "border-border bg-background text-transparent"
                      }`}
                    >
                      <Check className="h-4 w-4" strokeWidth={4} />
                    </button>

                    {/* Tocar no produto abre os detalhes; a seta volta ao carrinho. */}
                    <Link
                      to="/produto/$id"
                      params={{ id: c.id }}
                      className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                    >
                      {c.image ? (
                        <img
                          src={c.image}
                          alt={c.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[10px] font-bold text-muted-foreground">
                          SPERB
                        </div>
                      )}
                    </Link>

                    <Link
                      to="/produto/$id"
                      params={{ id: c.id }}
                      className="min-w-0 flex-1"
                    >
                      <p className="line-clamp-2 text-sm font-bold leading-tight text-foreground">
                        {c.name}
                      </p>
                      <p className="text-xs font-semibold text-muted-foreground">
                        {formatPrice(c.price)}
                        {atMax && ` · máx. ${max}`}
                      </p>
                      <p className="text-base font-black text-[oklch(0.55_0.22_255)]">
                        {formatPrice(priceValue(c.price) * c.qty)}
                      </p>
                    </Link>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        aria-label="Diminuir"
                        onClick={() => updateQty(c.id, c.qty - 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-foreground active:scale-95"
                      >
                        {c.qty === 1 ? (
                          <Trash2 className="h-4 w-4" />
                        ) : (
                          <Minus className="h-4 w-4" strokeWidth={3} />
                        )}
                      </button>
                      <span className="w-5 text-center text-base font-black text-foreground">
                        {c.qty}
                      </span>
                      <button
                        aria-label="Aumentar"
                        disabled={atMax}
                        onClick={() => updateQty(c.id, c.qty + 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-[oklch(0.55_0.22_255)] text-white disabled:opacity-40 active:scale-95"
                      >
                        <Plus className="h-4 w-4" strokeWidth={3} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <button
              onClick={() => {
                if (confirm("Esvaziar o carrinho?")) clearCart();
              }}
              className="mt-4 w-full rounded-2xl border-2 border-border bg-background py-3 text-base font-bold text-muted-foreground active:scale-95"
            >
              Esvaziar carrinho
            </button>
          </>
        )}
      </main>

      {cart.length > 0 && (
        <div className="layer-bottombar safe-bottom fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto max-w-3xl px-3 pb-3 pt-2">
            {erro && (
              <p className="mb-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
                {erro}
              </p>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-muted-foreground">
                  {picked.length} de {cart.length} {cart.length === 1 ? "item" : "itens"}
                </p>
                <p className="truncate text-2xl font-black text-foreground">
                  {formatPrice(subtotal)}
                </p>
              </div>
              <button
                onClick={() => void irParaConfirmacao()}
                disabled={picked.length === 0 || busy}
                className="shrink-0 rounded-2xl bg-[oklch(0.55_0.22_255)] px-7 py-4 text-xl font-black text-white shadow-lg disabled:opacity-50 active:scale-[0.98]"
              >
                {busy ? "Reservando…" : "Fazer pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
