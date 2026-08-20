import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Ticket, Lock } from "lucide-react";
import {
  useCoupons,
  useProfile,
  useRedeemed,
  saveProfile,
  lookupCustomerName,
  redeemCoupon,
  unredeemCoupon,
  isAvailable,
  type Coupon,
} from "@/lib/coupons";
import { useAdmin } from "@/lib/admin";
import { formatPrice } from "@/lib/cart";
import { StoreLogoWithFallback } from "@/components/store-logo";

export const Route = createFileRoute("/eu")({
  head: () => ({
    meta: [
      { title: "Eu — SPERB" },
      {
        name: "description",
        content: "Seus dados e cupons de desconto CUPOM SPERB para usar no pedido.",
      },
      { property: "og:title", content: "Eu — SPERB" },
      {
        property: "og:description",
        content: "Seus dados e cupons de desconto CUPOM SPERB para usar no pedido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EuPage,
});

function couponLabel(c: Coupon): string {
  return c.type === "percent" ? `${c.value}% OFF` : `${formatPrice(c.value)} OFF`;
}

function EuPage() {
  const profile = useProfile();
  const coupons = useCoupons();
  const redeemed = useRedeemed();
  const { isAdmin } = useAdmin();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "known" | "new">(
    profile.name ? "known" : "idle",
  );
  const locked = status === "known";

  // Basta o telefone: se o número já tem cadastro, o nome vem do banco central
  // e não pode ser alterado no app (só a loja altera no Loyverse).
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setStatus("idle");
      return;
    }
    let alive = true;
    setStatus("checking");
    const t = setTimeout(async () => {
      const registered = await lookupCustomerName(phone);
      if (!alive) return;
      if (registered) {
        setName(registered);
        setStatus("known");
      } else {
        setStatus("new");
      }
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [phone]);


  const visible = coupons.filter(isAvailable);

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            aria-label="Voltar"
            className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <ArrowLeft className="h-7 w-7" strokeWidth={2.5} />
          </Link>
          <StoreLogoWithFallback
            storeName="SPERB"
            className="h-9 w-auto"
            fallbackClassName="text-2xl font-black text-foreground"
          />
          <h1 className="text-2xl font-black text-foreground">Eu</h1>

          <Link
            to="/admin"
            aria-label="Área do proprietário"
            className="ml-auto grid h-11 w-11 place-items-center rounded-2xl border-2 border-border bg-card text-muted-foreground"
          >
            <Lock className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[oklch(0.55_0.22_255)] to-[oklch(0.45_0.2_290)] p-5 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/20 text-3xl font-black">
              {(name || "?").trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-2xl font-black">
                {name.trim() || "Bem-vindo à SPERB"}
              </p>
              <p className="truncate text-base font-semibold text-white/80">
                {phone.trim() || "Complete seu cadastro abaixo"}
              </p>
            </div>
          </div>
        </section>

        <Link
          to="/pedidos"
          className="mt-4 flex items-center gap-4 rounded-3xl border-2 border-border bg-card p-5 shadow-sm active:scale-[0.99]"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[oklch(0.55_0.22_255)] text-white">
            <Package className="h-7 w-7" strokeWidth={2.5} />
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-black text-foreground">Meus pedidos</span>
            <span className="block text-base font-semibold text-muted-foreground">
              Acompanhe pagamento e entrega
            </span>
          </span>
        </Link>



        <section className="mt-5 rounded-3xl border-2 border-border bg-card p-5 shadow-sm">
          <h2 className="text-xl font-black text-foreground">Meus dados</h2>
          <label className="mt-3 block text-base font-bold text-muted-foreground">
            WhatsApp
            <input
              value={phone}
              maxLength={20}
              inputMode="tel"
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(51) 99999-9999"
              className="mt-1 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none focus:border-[oklch(0.55_0.22_255)]"
            />
          </label>

          {status === "checking" && (
            <p className="mt-2 text-base font-semibold text-muted-foreground">
              Procurando seu cadastro...
            </p>
          )}

          {locked && (
            <div className="mt-3 rounded-2xl border-2 border-[oklch(0.62_0.19_145)] bg-muted px-4 py-3">
              <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Cadastro encontrado
              </p>
              <p className="text-xl font-black text-foreground">{name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                O nome deste número só pode ser alterado pela loja.
              </p>
            </div>
          )}

          {status === "new" && (
            <label className="mt-3 block text-base font-bold text-muted-foreground">
              Nome completo
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome completo"
                className="mt-1 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none focus:border-[oklch(0.55_0.22_255)]"
              />
              <span className="mt-1 block text-sm font-semibold text-muted-foreground">
                Pedimos o nome só nesta primeira vez para este número.
              </span>
            </label>
          )}

          <button
            disabled={
              phone.replace(/\D/g, "").length < 10 ||
              (status === "new" && name.trim().length < 2)
            }
            onClick={async () => {
              setSaveError("");
              try {
                await saveProfile({ name: name.trim(), phone: phone.trim() });
                setStatus("known");
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
              } catch {
                setSaveError("Não foi possível salvar agora. Tente de novo.");
              }
            }}
            className={`mt-4 w-full rounded-2xl py-4 text-xl font-black text-white shadow-md transition-colors active:scale-[0.98] disabled:opacity-50 ${
              saved ? "bg-[oklch(0.62_0.19_145)]" : "bg-[oklch(0.55_0.22_255)]"
            }`}
          >
            {saved ? "Salvo!" : "Salvar cadastro"}
          </button>
          {saveError && (
            <p className="mt-2 text-base font-bold text-[oklch(0.58_0.22_25)]">
              {saveError}
            </p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Seus dados ficam guardados na sua conta da loja.
          </p>
        </section>


        <section className="mt-6">
          <h2 className="flex items-center gap-2 text-xl font-black text-foreground">
            <Ticket className="h-6 w-6 text-[oklch(0.55_0.22_255)]" /> Cupons de desconto
          </h2>
          {visible.length === 0 ? (
            <p className="mt-3 rounded-2xl border-2 border-dashed border-border p-5 text-center text-lg text-muted-foreground">
              Nenhum cupom disponível no momento.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {visible.map((c) => {
                const isRedeemed = redeemed.includes(c.id);
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-3 rounded-3xl border-2 bg-card p-4 shadow-sm transition-colors ${
                      isRedeemed
                        ? "border-[oklch(0.62_0.19_145)]"
                        : "border-border"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">
                        CUPOM SPERB · {c.code}
                      </p>
                      <p className="text-2xl font-black text-[oklch(0.62_0.19_145)]">
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
                        {c.maxUses !== null &&
                          ` · restam ${Math.max(0, c.maxUses - c.uses)} usos`}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        isRedeemed ? unredeemCoupon(c.id) : redeemCoupon(c.id)
                      }
                      className={`shrink-0 rounded-2xl px-4 py-3 text-lg font-black active:scale-95 ${
                        isRedeemed
                          ? "bg-[oklch(0.62_0.19_145)] text-white"
                          : "bg-[oklch(0.55_0.22_255)] text-white"
                      }`}
                    >
                      {isRedeemed ? "Resgatado" : "Resgatar"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            O resgate não garante o uso: o desconto é confirmado ao finalizar o pedido
            pelo WhatsApp, enquanto houver cupons disponíveis.
          </p>
        </section>

        {isAdmin && (
          <Link
            to="/admin"
            className="mt-6 block rounded-2xl bg-[oklch(0.55_0.22_255)] py-4 text-center text-xl font-black text-white shadow-md active:scale-[0.98]"
          >
            Abrir painel de administração
          </Link>
        )}
      </main>
    </div>
  );
}
