import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ticket, Coins, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { StoreLogoWithFallback } from "@/components/store-logo";
import { BackButton } from "@/components/back-button";
import { useCart, updateQty, formatPrice, priceValue } from "@/lib/cart";
import { readSelection, clearSelection } from "@/lib/checkout-selection";
import {
  useCoupons,
  useProfile,
  useCouponsRefresh,
  useClaimedCoupons,
  useMyCouponUses,
  useSelectedCouponId,
  setSelectedCouponId,
  isAvailableForCustomer,
  chosenCouponFor,
  consumeCoupon,
  unredeemCoupon,
  deviceId,
} from "@/lib/coupons";
import { fetchCoinBalance, coinsToBRL, maxCoinsFor, COIN_MAX_RATIO } from "@/lib/coins";
import { recordOrder } from "@/lib/orders";
import { getHoldId, releaseStockHold, forgetStockHold } from "@/lib/stock";
import { startCheckout, paymentsStatus, MIN_CHECKOUT_BRL } from "@/lib/payments.functions";

const WHATSAPP_NUMBER = "5551996109657";

export const Route = createFileRoute("/confirmar")({
  head: () => ({
    meta: [
      { title: "Confirmar pedido — SPERB" },
      {
        name: "description",
        content: "Revise seus produtos, cupom, moedas e valor final antes de fechar o pedido.",
      },
      { property: "og:title", content: "Confirmar pedido — SPERB" },
      {
        property: "og:description",
        content: "Confira tudo do seu pedido SPERB antes de pagar ou enviar pelo WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfirmarPage,
});

function ConfirmarPage() {
  const cart = useCart();
  const coupons = useCoupons();
  const profile = useProfile();
  const refreshCoupons = useCouponsRefresh();
  const selectedCouponId = useSelectedCouponId();
  const qc = useQueryClient();
  const navigate = Route.useNavigate();

  const [useCoins, setUseCoins] = useState(false);
  const [busy, setBusy] = useState("");
  const [erro, setErro] = useState("");
  const [picker, setPicker] = useState(false);
  // Escolha provisória: o cupom só entra no pedido quando o cliente toca em OK.
  const [draftCouponId, setDraftCouponId] = useState<string | null>(null);

  const startPay = useServerFn(startCheckout);
  const checkPayments = useServerFn(paymentsStatus);

  const logged = profile.phone.trim().length >= 8 && profile.name.trim().length > 0;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(profile.email.trim());

  const selection = readSelection();
  const picked = cart.filter((c) => selection.length === 0 || selection.includes(c.id));

  const coinBalance = useQuery({
    queryKey: ["coins", "balance", profile.phone],
    queryFn: () => fetchCoinBalance(profile.phone),
    staleTime: 30 * 1000,
  });
  const claimed = useClaimedCoupons(profile.phone).data ?? [];
  const myUses = useMyCouponUses(profile.phone).data ?? {};

  const subtotal = picked.reduce((s, c) => s + priceValue(c.price) * c.qty, 0);

  const usable = [...coupons, ...claimed]
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
    .filter((c) => isAvailableForCustomer(c, myUses[c.id] ?? 0));

  // Cupom só entra se o cliente escolher aqui — nunca automático.
  const applied = chosenCouponFor(usable, selectedCouponId, subtotal);
  const eligible = Math.max(0, subtotal - (applied?.discount ?? 0));
  const balance = coinBalance.data ?? 0;
  // O cliente só decide SE quer usar moedas; a quantidade é sempre calculada.
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

  function limparCarrinho() {
    for (const c of picked) updateQty(c.id, 0);
    clearSelection();
    setSelectedCouponId(null);
    forgetStockHold();
  }

  async function consumirBeneficios() {
    void qc.invalidateQueries({ queryKey: ["coins"] });
    if (applied) {
      await consumeCoupon(applied.coupon.id);
      unredeemCoupon(applied.coupon.id);
      await refreshCoupons();
    }
  }

  function whatsAppText() {
    const linhas = picked.map(
      (c) => `- ${c.name} | Qtd: ${c.qty} | ${formatPrice(c.price)}`,
    );
    let texto = profile.name
      ? `Pedido SPERB\nCliente: ${profile.name}\n\n${linhas.join("\n")}`
      : `Pedido SPERB\n\n${linhas.join("\n")}`;
    texto += `\n\nSubtotal: ${formatPrice(subtotal)}`;
    if (applied) {
      texto += `\nCUPOM SPERB ${applied.coupon.code}: -${formatPrice(applied.discount)}`;
    }
    if (coinsToUse > 0) {
      texto += `\nMoedas SPERB (${coinsToUse}): -${formatPrice(coinsDiscount)}`;
    }
    texto += `\n\nTotal: ${formatPrice(total)}`;
    return texto;
  }

  /** WhatsApp: o pedido nasce só agora, consumindo a reserva já feita. */
  async function enviarWhatsApp() {
    if (picked.length === 0 || busy) return;
    if (!logged) {
      void navigate({ to: "/eu" });
      return;
    }
    setBusy("whats");
    setErro("");
    try {
      const url = `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${encodeURIComponent(whatsAppText())}`;
      window.open(url, "_blank");
      const created = await recordOrder({
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
        items: orderItems(),
        subtotal,
        discount: applied?.discount ?? 0,
        total,
        couponCode: applied?.coupon.code ?? "",
        coins: coinsToUse,
        holdId: getHoldId() || undefined,
      });
      if (!created) {
        setErro(
          "Algum produto ficou sem estoque enquanto você conferia. Volte ao carrinho e ajuste as quantidades.",
        );
        return;
      }
      await consumirBeneficios();
      limparCarrinho();
      void navigate({ to: "/pedidos", search: { status: "topay" } });
    } catch {
      setErro("Não foi possível registrar o pedido. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  /** Pix/cartão: o pedido só nasce quando o checkout abre sem erro. */
  async function pagarAgora() {
    if (picked.length === 0 || busy) return;
    if (!logged) {
      void navigate({ to: "/eu" });
      return;
    }
    if (!hasEmail) {
      setErro("Cadastre seu e-mail em “Eu” para pagar com Pix ou cartão.");
      void navigate({ to: "/eu" });
      return;
    }
    if (total < MIN_CHECKOUT_BRL) {
      setErro(
        `O pagamento online começa em ${formatPrice(MIN_CHECKOUT_BRL)}. Envie pelo WhatsApp.`,
      );
      return;
    }
    setBusy("pix");
    setErro("");
    try {
      const status = await checkPayments();
      if (!status.configured) {
        setErro("O pagamento online está indisponível agora. Envie pelo WhatsApp.");
        return;
      }
      const checkout = await startPay({
        data: {
          deviceId: deviceId(),
          holdId: getHoldId(),
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
        setErro(
          checkout.reason === "min_value"
            ? `O pagamento online começa em ${formatPrice(MIN_CHECKOUT_BRL)}.`
            : checkout.reason === "out_of_stock"
              ? "Algum produto ficou sem estoque. Volte ao carrinho e ajuste as quantidades."
              : "O pagamento online está indisponível agora. Envie pelo WhatsApp.",
        );
        return;
      }
      await consumirBeneficios();
      if (checkout.orderId) {
        window.localStorage.setItem("sperb-last-order", checkout.orderId);
      }
      limparCarrinho();
      window.location.href = checkout.url;
    } catch {
      setErro("Falha ao abrir o pagamento. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="min-h-screen bg-background pb-48">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <BackButton
            fallback="/sacola"
            className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
            iconClassName="h-8 w-8"
            onBack={() => void releaseStockHold()}
          />
          <StoreLogoWithFallback
            storeName="SPERB"
            className="h-9 w-auto max-w-24 object-contain"
            fallbackClassName="text-lg font-black text-foreground"
          />
          <h1 className="text-2xl font-black text-foreground">Confirmar pedido</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {picked.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-2xl font-semibold text-foreground">Nenhum item para confirmar.</p>
            <Link
              to="/sacola"
              className="mt-6 inline-block rounded-2xl bg-primary px-8 py-5 text-2xl font-bold text-primary-foreground"
            >
              Voltar ao carrinho
            </Link>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border-2 border-border bg-card p-3">
              <h2 className="mb-2 text-lg font-black text-foreground">Seus produtos</h2>
              <ul className="flex flex-col gap-2">
                {picked.map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
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
                      <p className="line-clamp-2 text-base font-bold leading-tight text-foreground">
                        {c.name}
                      </p>
                      <p className="text-sm font-semibold text-muted-foreground">
                        Quantidade: {c.qty} · {formatPrice(c.price)}
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-black text-foreground">
                      {formatPrice(priceValue(c.price) * c.qty)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-3 rounded-2xl border-2 border-border bg-card p-3">
              <h2 className="mb-2 text-lg font-black text-foreground">Descontos</h2>

              <div className="flex items-center justify-between gap-3 py-2">
                <span className="inline-flex items-center gap-2 text-base font-bold text-foreground">
                  <Ticket className="h-5 w-5 text-[oklch(0.55_0.22_255)]" />
                  {applied ? `Cupom ${applied.coupon.code}` : "Nenhum cupom escolhido"}
                </span>
                <button
                  onClick={() => {
                    setDraftCouponId(selectedCouponId);
                    setPicker(true);
                  }}
                  className="rounded-xl bg-muted px-3 py-2 text-sm font-black text-[oklch(0.55_0.22_255)] active:scale-95"
                >
                  {applied ? "Trocar cupom" : "Escolher cupom"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border py-2">
                <span className="inline-flex items-center gap-2 text-base font-bold text-foreground">
                  <Coins className="h-5 w-5 text-[oklch(0.72_0.17_75)]" />
                  Minhas moedas ({balance})
                </span>
                <button
                  role="switch"
                  aria-checked={useCoins}
                  aria-label="Usar minhas moedas"
                  onClick={() => setUseCoins((v) => !v)}
                  disabled={balance <= 0}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                    useCoins ? "bg-[oklch(0.72_0.17_75)]" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                      useCoins ? "left-7" : "left-1"
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs font-semibold text-muted-foreground">
                O sistema usa automaticamente até {Math.round(COIN_MAX_RATIO * 100)}% do valor do
                pedido em moedas.
              </p>
            </section>

            <section className="mt-3 rounded-2xl border-2 border-border bg-card p-3 text-lg">
              <Row label="Subtotal" value={formatPrice(subtotal)} />
              {applied && (
                <Row
                  label={`Cupom ${applied.coupon.code}`}
                  value={`- ${formatPrice(applied.discount)}`}
                  good
                />
              )}
              {coinsToUse > 0 && (
                <Row
                  label={`Moedas (${coinsToUse})`}
                  value={`- ${formatPrice(coinsDiscount)}`}
                  good
                />
              )}
              <Row label="Entrega" value="Combinada no WhatsApp" />
              <div className="mt-2 flex items-center justify-between border-t-2 border-border pt-2">
                <span className="text-xl font-black text-foreground">Total</span>
                <span className="text-3xl font-black text-foreground">{formatPrice(total)}</span>
              </div>
            </section>
          </>
        )}
      </main>

      {picker && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border-t-2 border-border bg-background p-4">
            <h2 className="text-xl font-black text-foreground">Escolher cupom</h2>
            <ul className="mt-3 flex flex-col gap-2">
              <PickerRow
                label="Não usar cupom"
                selected={!draftCouponId}
                onSelect={() => setDraftCouponId(null)}
              />
              {usable.map((c) => (
                <PickerRow
                  key={c.id}
                  label={c.code}
                  detail={c.description ?? ""}
                  selected={draftCouponId === c.id}
                  onSelect={() => setDraftCouponId(c.id)}
                />
              ))}
            </ul>
            {usable.length === 0 && (
              <p className="mt-3 text-base font-semibold text-muted-foreground">
                Você ainda não tem cupons para usar.
              </p>
            )}
            <button
              onClick={() => {
                // O cupom só é aplicado ao pedido agora, no OK.
                setSelectedCouponId(draftCouponId);
                setPicker(false);
              }}
              className="mt-4 w-full rounded-2xl bg-[oklch(0.55_0.22_255)] py-4 text-2xl font-black text-white active:scale-[0.99]"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-3 pb-3 pt-2 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {erro && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
                {erro}
              </p>
            )}
            <button
              onClick={() => void pagarAgora()}
              disabled={busy !== ""}
              className="w-full rounded-2xl bg-[oklch(0.55_0.22_255)] py-5 text-2xl font-black text-white shadow-lg disabled:opacity-50 active:scale-[0.99]"
            >
              {busy === "pix" ? "Abrindo pagamento…" : "Pagar agora via Pix"}
            </button>
            <button
              onClick={() => void enviarWhatsApp()}
              disabled={busy !== ""}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[oklch(0.62_0.19_145)] bg-background py-3.5 text-lg font-black text-[oklch(0.45_0.19_145)] disabled:opacity-50 active:scale-[0.99]"
            >
              <WhatsAppIcon className="h-6 w-6" />
              {busy === "whats" ? "Enviando…" : "Fazer pedido pelo WhatsApp"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${
          selected ? "border-[oklch(0.55_0.22_255)] bg-card" : "border-border bg-card"
        }`}
      >
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
            selected
              ? "border-[oklch(0.55_0.22_255)] bg-[oklch(0.55_0.22_255)] text-white"
              : "border-border text-transparent"
          }`}
        >
          <Check className="h-4 w-4" strokeWidth={4} />
        </span>
        <span className="min-w-0">
          <span className="block text-lg font-black text-foreground">{label}</span>
          {detail && (
            <span className="block text-sm font-semibold text-muted-foreground">{detail}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-semibold text-muted-foreground">{label}</span>
      <span
        className={`font-black ${good ? "text-[oklch(0.45_0.19_145)]" : "text-foreground"}`}
      >
        {value}
      </span>
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
