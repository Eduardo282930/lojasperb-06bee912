import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ticket } from "lucide-react";

import {
  useCoupons,
  useProfile,
  useRedeemed,
  redeemCoupon,
  claimCoupon,
  useClaimedCoupons,
  useMyCouponUses,
  isAvailableForCustomer,
  CLAIMED_KEY,
  type Coupon,
} from "@/lib/coupons";
import { formatPrice } from "@/lib/cart";

export const Route = createFileRoute("/cupons")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Meus cupons — SPERB" },
      {
        name: "description",
        content: "Resgate cupons SPERB e use o desconto no seu pedido pelo WhatsApp.",
      },
      { property: "og:title", content: "Meus cupons — SPERB" },
      {
        property: "og:description",
        content: "Resgate cupons SPERB e use o desconto no seu pedido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CuponsPage,
});

const BLUE = "oklch(0.55 0.22 255)";
const GREEN = "oklch(0.62 0.19 145)";
const GOLD = "oklch(0.72 0.17 62)";

function couponLabel(c: Coupon): string {
  if (!(c.value > 0)) return "Moedas de volta";
  return c.type === "percent" ? `${c.value}% OFF` : `${formatPrice(c.value)} OFF`;
}

function CuponsPage() {
  const profile = useProfile();
  const coupons = useCoupons();
  const redeemed = useRedeemed();
  const qc = useQueryClient();
  const [claiming, setClaiming] = useState<string | null>(null);

  const claimedList = useClaimedCoupons(profile.phone).data ?? [];
  const myUses = useMyCouponUses(profile.phone).data ?? {};
  const claimedIds = new Set(claimedList.map((c) => c.id));

  const available = coupons.filter(
    (c) => isAvailableForCustomer(c, myUses[c.id] ?? 0) && !claimedIds.has(c.id),
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            to="/eu"
            aria-label="Voltar"
            className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <ArrowLeft className="h-7 w-7" strokeWidth={2.5} />
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-foreground">
            <Ticket className="h-7 w-7" style={{ color: BLUE }} /> Meus cupons
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        <section>
          <h2 className="text-lg font-black text-foreground">
            Resgatados ({claimedList.length})
          </h2>
          {claimedList.length === 0 ? (
            <p className="mt-2 rounded-2xl border-2 border-dashed border-border p-5 text-center text-base font-semibold text-muted-foreground">
              Você ainda não resgatou cupons.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {claimedList.map((c) => {
                const used = myUses[c.id] ?? 0;
                const finished =
                  c.maxUsesPerCustomer !== null && used >= c.maxUsesPerCustomer;
                return (
                  <li
                    key={c.id}
                    className="rounded-3xl border-2 bg-card p-4 shadow-sm"
                    style={{ borderColor: finished ? "var(--border)" : GREEN }}
                  >
                    <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">
                      CUPOM SPERB · {c.code}
                    </p>
                    <p className="text-2xl font-black" style={{ color: GREEN }}>
                      {couponLabel(c)}
                    </p>
                    {c.description && (
                      <p className="text-base text-muted-foreground">{c.description}</p>
                    )}
                    <p className="mt-1 text-sm text-muted-foreground">
                      Pedido mínimo: {formatPrice(c.minOrder)}
                      {c.maxUsesPerCustomer !== null &&
                        ` · ${used}/${c.maxUsesPerCustomer} usos seus`}
                    </p>
                    {c.rewardCoins > 0 && (
                      <p className="mt-1 text-sm font-black" style={{ color: GOLD }}>
                        🪙 Devolve {c.rewardCoins} moedas quando o pedido for concluído
                      </p>
                    )}
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {finished
                        ? "Limite de uso atingido"
                        : "Guardado na sua conta — aplica sozinho na sacola"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-black text-foreground">Disponíveis para resgate</h2>
          {available.length === 0 ? (
            <p className="mt-2 rounded-2xl border-2 border-dashed border-border p-5 text-center text-base font-semibold text-muted-foreground">
              Nenhum cupom novo no momento.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {available.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-3xl border-2 border-border bg-card p-4 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">
                      CUPOM SPERB · {c.code}
                    </p>
                    <p className="text-2xl font-black" style={{ color: GREEN }}>
                      {couponLabel(c)}
                    </p>
                    {c.description && (
                      <p className="text-base text-muted-foreground">{c.description}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Pedido mínimo: {formatPrice(c.minOrder)}
                      {c.type === "percent" &&
                        c.maxDiscount !== null &&
                        ` · desconto máximo ${formatPrice(c.maxDiscount)}`}
                      {c.maxUsesPerCustomer !== null &&
                        ` · ${c.maxUsesPerCustomer} uso(s) por cliente`}
                    </p>
                    {c.rewardCoins > 0 && (
                      <p className="text-sm font-black" style={{ color: GOLD }}>
                        🪙 Ganhe {c.rewardCoins} moedas para a próxima compra
                      </p>
                    )}
                  </div>
                  <button
                    disabled={claiming === c.id || redeemed.includes(c.id)}
                    onClick={async () => {
                      setClaiming(c.id);
                      redeemCoupon(c.id);
                      await claimCoupon(c.id, profile.phone);
                      await qc.invalidateQueries({ queryKey: CLAIMED_KEY });
                      setClaiming(null);
                    }}
                    className="shrink-0 rounded-2xl px-4 py-3 text-lg font-black text-white active:scale-95 disabled:opacity-70"
                    style={{ backgroundColor: BLUE }}
                  >
                    {claiming === c.id ? "..." : "Resgatar"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-4 text-sm text-muted-foreground">
          Cada cupom fica salvo na sua conta e não precisa ser resgatado de novo.
        </p>
      </main>
    </div>
  );
}
