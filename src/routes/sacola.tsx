import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Trash2, Ticket, Coins, Check } from "lucide-react";
import { StoreLogoWithFallback } from "@/components/store-logo";
import { useCart, updateQty, formatPrice, priceValue, clearCart } from "@/lib/cart";
import {
  useCoupons,
  useRedeemed,
  useProfile,
  useCouponsRefresh,
  useClaimedCoupons,
  useMyCouponUses,
  isAvailableForCustomer,
  activeCouponFor,
  consumeCoupon,
  unredeemCoupon,
} from "@/lib/coupons";
import { fetchCoinBalance, coinsToBRL, maxCoinsFor, COIN_MAX_RATIO } from "@/lib/coins";
import { recordOrder } from "@/lib/orders";
import { deviceId } from "@/lib/coupons";
import { useServerFn } from "@tanstack/react-start";
import {
  startCheckout,
  paymentsStatus,
  MIN_CHECKOUT_BRL,
} from "@/lib/payments.functions";


const WHATSAPP_NUMBER = "5551996109657";

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
  const coupons = useCoupons();
  const redeemed = useRedeemed();
  const profile = useProfile();
  const refreshCoupons = useCouponsRefresh();
  const qc = useQueryClient();
  const [useCoins, setUseCoins] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const startPay = useServerFn(startCheckout);
  const checkPayments = useServerFn(paymentsStatus);
  const navigate = Route.useNavigate();
  const logged = profile.phone.trim().length >= 8 && profile.name.trim().length > 0;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(profile.email.trim());

  const coinBalance = useQuery({
    queryKey: ["coins", "balance", profile.phone],
    queryFn: () => fetchCoinBalance(profile.phone),
    staleTime: 30 * 1000,
  });

  const claimed = useClaimedCoupons(profile.phone).data ?? [];
  const myUses = useMyCouponUses(profile.phone).data ?? {};

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
  // Cupons resgatados ficam salvos para o cliente; o limite pessoal é respeitado.
  const usable = [...coupons, ...claimed]
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
    .filter((c) => isAvailableForCustomer(c, myUses[c.id] ?? 0));
  const owned = [...redeemed, ...claimed.map((c) => c.id)];
  const applied = activeCouponFor(usable, owned, subtotal);
  const eligible = Math.max(0, subtotal - (applied?.discount ?? 0));
  const balance = coinBalance.data ?? 0;
  const coinsToUse = useCoins ? maxCoinsFor(eligible, balance) : 0;
  const coinsDiscount = coinsToBRL(coinsToUse);
  const total = Math.max(0, eligible - coinsDiscount);

  function orderItems() {
    return picked.map((c) => ({
      id: c.id,
      name: c.name,
      qty: c.qty,
      price: priceValue(c.price),
      image: c.image ?? null,
    }));
  }

  /** Tira do carrinho apenas os itens que foram comprados. */
  function removePicked() {
    for (const c of picked) updateQty(c.id, 0);
  }

  async function saveOrder(): Promise<string | null> {
    const id = await recordOrder({
      name: profile.name,
      phone: profile.phone,
      email: profile.email,
      items: orderItems(),
      subtotal,
      discount: applied?.discount ?? 0,
      total,
      couponCode: applied?.coupon.code ?? "",
      coins: coinsToUse,
    });
    void qc.invalidateQueries({ queryKey: ["coins"] });
    if (applied) {
      await consumeCoupon(applied.coupon.id);
      unredeemCoupon(applied.coupon.id);
      await refreshCoupons();
    }
    return id;
  }


  function whatsAppText() {
    const linhas = picked.map(
      (c) => `- ${c.name} | Qtd: ${c.qty} | ${formatPrice(c.price)}`,
    );
    let texto = profile.name
      ? `Pedido SPERB\nCliente: ${profile.name}\n\n${linhas.join("\n")}`
      : `Pedido SPERB\n\n${linhas.join("\n")}`;
    if (applied || coinsToUse > 0) texto += `\n\nSubtotal: ${formatPrice(subtotal)}`;
    if (applied) {
      texto += `\nCUPOM SPERB ${applied.coupon.code}: -${formatPrice(applied.discount)}`;
    }
    if (coinsToUse > 0) {
      texto += `\nMoedas SPERB (${coinsToUse}): -${formatPrice(coinsDiscount)}`;
    }
    texto += `\n\nTotal: ${formatPrice(total)}`;
    return texto;
  }

  /**
   * Pagamento online: o pedido só nasce depois que o checkout responde com a
   * tela de pagamento. Se algo falhar, o pedido é apagado na hora e o estoque
   * reservado volta para a loja.
   */
  async function pagarAgora() {
    if (picked.length === 0 || paying) return;

    if (!logged) {
      void navigate({ to: "/eu" });
      return;
    }
    if (!hasEmail) {
      setPayError("Cadastre seu e-mail em “Eu” para pagar com Pix ou cartão.");
      void navigate({ to: "/eu" });
      return;
    }
    if (total < MIN_CHECKOUT_BRL) {
      setPayError(
        `O pagamento online começa em ${formatPrice(MIN_CHECKOUT_BRL)}. Envie pelo WhatsApp.`,
      );
      return;
    }
    setPaying(true);
    setPayError("");
    try {
      // Só criamos o pedido (e a reserva de estoque) depois de confirmar que o
      // pagamento online está disponível. Assim nada vira "pedido recebido" à toa.
      const status = await checkPayments();
      if (!status.configured) {
        setPayError(
          "O pagamento online está indisponível agora. Você pode enviar o pedido pelo WhatsApp.",
        );
        return;
      }

      /*
       * Tudo acontece no servidor, em uma chamada só:
       * cria o pedido + reserva de estoque, cria o checkout da InfinitePay
       * e devolve a URL. Se algo falhar, o próprio servidor apaga o pedido
       * e libera a reserva.
       */
      const checkout = await startPay({
        data: {
          deviceId: deviceId(),
          name: profile.name,
          phone: profile.phone,
          email: profile.email,
          items: orderItems(),
          subtotal,
          discount: applied?.discount ?? 0,
          total,
          couponCode: applied?.coupon.code ?? "",
          coins: coinsToUse,
        },
      });

      if (!checkout.url) {
        setPayError(
          checkout.reason === "min_value"
            ? `O pagamento online começa em ${formatPrice(MIN_CHECKOUT_BRL)}.`
            : `O pagamento online está indisponível agora (${checkout.reason ?? "erro"}). Você pode enviar o pedido pelo WhatsApp.`,
        );
        return;
      }

      /*
       * Checkout abriu: confirma o consumo do cupom e das moedas
       * (o pedido e a reserva já foram criados pelo servidor).
       */
      void qc.invalidateQueries({ queryKey: ["coins"] });
      if (applied) {
        await consumeCoupon(applied.coupon.id);
        unredeemCoupon(applied.coupon.id);
        await refreshCoupons();
      }

      if (typeof window !== "undefined" && checkout.orderId) {
        window.localStorage.setItem("sperb-last-order", checkout.orderId);
      }
      removePicked();
      window.location.href = checkout.url;
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 120) : "";
      setPayError(`Falha ao abrir o pagamento. ${detail}`.trim());
    } finally {
      setPaying(false);
    }
  }

  async function enviarWhatsApp() {
    if (picked.length === 0) return;

    if (!logged) {
      void navigate({ to: "/eu" });
      return;
    }
    const url = `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${encodeURIComponent(whatsAppText())}`;
    window.open(url, "_blank");
    await saveOrder();
  }



  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            aria-label="Voltar"
            className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <ArrowLeft className="h-8 w-8" strokeWidth={2.5} />
          </Link>
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
          <div className="mt-16 text-center">
            <p className="text-2xl font-semibold text-foreground">
              Seu carrinho está vazio.
            </p>
            <Link
              to="/"
              className="mt-6 inline-block rounded-2xl bg-primary px-8 py-5 text-2xl font-bold text-primary-foreground"
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

                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
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
                    </div>

                    <div className="min-w-0 flex-1">
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
                    </div>

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
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto max-w-3xl px-3 pb-3 pt-2">
            {payError && (
              <p className="mb-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
                {payError}
              </p>
            )}

            {/* Linha compacta: cupom + moedas, estilo Shopee. */}
            <div className="mb-2 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {applied ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[oklch(0.62_0.19_145)]/12 px-3 py-1.5 text-xs font-black text-[oklch(0.45_0.19_145)]">
                  <Ticket className="h-4 w-4" />
                  {applied.coupon.code} · -{formatPrice(applied.discount)}
                </span>
              ) : (
                <Link
                  to="/cupons"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-black text-[oklch(0.55_0.22_255)]"
                >
                  <Ticket className="h-4 w-4" /> Usar cupom
                </Link>
              )}

              {balance > 0 && (
                <button
                  onClick={() => setUseCoins((v) => !v)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black ${
                    useCoins
                      ? "bg-[oklch(0.72_0.17_75)] text-white"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <Coins className="h-4 w-4" />
                  {coinsToUse > 0
                    ? `${coinsToUse} moedas · -${formatPrice(coinsDiscount)}`
                    : `Usar moedas (${balance})`}
                </button>
              )}
              {balance > 0 && (
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                  até {Math.round(COIN_MAX_RATIO * 100)}% do pedido
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-muted-foreground">
                  {picked.length} de {cart.length} {cart.length === 1 ? "item" : "itens"}
                </p>
                <p className="truncate text-2xl font-black text-foreground">
                  {formatPrice(total)}
                </p>
              </div>
              <button
                onClick={() => void pagarAgora()}
                disabled={paying || picked.length === 0}
                className="shrink-0 rounded-2xl bg-[oklch(0.55_0.22_255)] px-5 py-3 text-base font-black text-white shadow-lg disabled:opacity-50 active:scale-[0.98]"
              >
                {paying ? "Abrindo…" : "Pagar Pix/cartão"}
              </button>
              <button
                onClick={() => void enviarWhatsApp()}
                disabled={picked.length === 0}
                aria-label="Enviar pelo WhatsApp"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-2 border-[oklch(0.62_0.19_145)] text-[oklch(0.45_0.19_145)] disabled:opacity-50 active:scale-95"
              >
                <WhatsAppIcon className="h-6 w-6" />
              </button>
            </div>
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
