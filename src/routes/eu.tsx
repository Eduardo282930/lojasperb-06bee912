import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ticket,
  Lock,
  Package,
  Coins,
  ChevronRight,
  Truck,
  CheckCircle2,
  ClipboardList,
  Pencil,
  X,
  Bell,
  Phone,
  BadgeCheck,
} from "lucide-react";

import {
  useProfile,
  saveProfile,
  lookupCustomerName,
  useClaimedCoupons,
} from "@/lib/coupons";
import { fetchCoinBalance, coinsToBRL } from "@/lib/coins";
import { useAdmin } from "@/lib/admin";
import { fetchMyOrders } from "@/lib/orders";
import { formatPrice } from "@/lib/cart";
import { StoreLogoWithFallback } from "@/components/store-logo";
import { useNotificationWatcher, useNotificationPermission } from "@/lib/notifications";

/** (51) 99610-9657 */
function prettyPhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "").slice(-11);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}

const PURCHASE_TABS = [
  { status: "sent", label: "Recebido", icon: ClipboardList },
  { status: "preparing", label: "Preparando", icon: Package },
  { status: "shipping", label: "A caminho", icon: Truck },
  { status: "delivered", label: "Entregue", icon: CheckCircle2 },
] as const;

export const Route = createFileRoute("/eu")({
  head: () => ({
    meta: [
      { title: "Eu — SPERB" },
      {
        name: "description",
        content: "Suas compras, moedas e cupons CUPOM SPERB em um só lugar.",
      },
      { property: "og:title", content: "Eu — SPERB" },
      {
        property: "og:description",
        content: "Suas compras, moedas e cupons CUPOM SPERB em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EuPage,
});

function EuPage() {
  const profile = useProfile();
  const { isAdmin } = useAdmin();
  const [editing, setEditing] = useState(false);
  const notify = useNotificationPermission();
  useNotificationWatcher(profile.phone);

  const claimedList = useClaimedCoupons(profile.phone).data ?? [];
  const coinBalance = useQuery({
    queryKey: ["coins", "balance", profile.phone],
    queryFn: () => fetchCoinBalance(profile.phone),
    staleTime: 30 * 1000,
  });
  const balance = coinBalance.data ?? 0;

  const ordersQuery = useQuery({
    queryKey: ["my-orders", profile.phone],
    queryFn: () => fetchMyOrders(profile.phone),
    staleTime: 30 * 1000,
  });
  const ordersByStatus = (ordersQuery.data ?? []).reduce<Record<string, number>>(
    (acc, o) => {
      const k = o.status || "sent";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const registered = profile.name.trim().length > 0;

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
        {/* Cadastro só aparece resumido; o cliente digita uma única vez. */}
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[oklch(0.55_0.22_255)] to-[oklch(0.45_0.2_290)] p-5 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white/25 text-2xl font-black ring-4 ring-white/20">
              {initials(profile.name || "?")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-widest text-white/70">
                {registered ? "Cliente SPERB" : "Bem-vindo"}
              </p>
              <p className="truncate text-2xl font-black leading-tight">
                {profile.name.trim() || "Faça seu cadastro"}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-base font-bold text-white/85">
                {registered ? (
                  <>
                    <Phone className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    <span className="truncate">{prettyPhone(profile.phone)}</span>
                    <BadgeCheck className="h-4 w-4 shrink-0 text-white" strokeWidth={2.5} />
                  </>
                ) : (
                  "Toque no lápis para começar"
                )}
              </p>
            </div>
            <button
              onClick={() => setEditing(true)}
              aria-label={registered ? "Alterar meus dados" : "Fazer cadastro"}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 active:scale-95"
            >
              <Pencil className="h-6 w-6" strokeWidth={2.5} />
            </button>
          </div>
        </section>

        {notify.state !== "granted" && notify.state !== "unsupported" && (
          <button
            onClick={() => void notify.request()}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl border-2 border-border bg-card px-4 py-3 text-left active:scale-[0.99]"
          >
            <Bell className="h-7 w-7 shrink-0 text-[oklch(0.72_0.17_75)]" strokeWidth={2.5} />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-black text-foreground">
                Ativar avisos no celular
              </span>
              <span className="block text-sm font-semibold text-muted-foreground">
                Receba moedas e novos cupons na barra de notificações.
              </span>
            </span>
          </button>
        )}

        <section className="mt-4 rounded-3xl border-2 border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black text-foreground">Minhas compras</h2>
            <Link
              to="/pedidos"
              search={{ status: "sent" }}
              className="flex items-center gap-1 text-base font-bold text-muted-foreground"
            >
              Histórico <ChevronRight className="h-5 w-5" />
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1">
            {PURCHASE_TABS.map((t) => {
              const count = ordersByStatus[t.status] ?? 0;
              return (
                <Link
                  key={t.status}
                  to="/pedidos"
                  search={{ status: t.status }}
                  className="relative flex flex-col items-center gap-1 rounded-2xl py-2 active:scale-95"
                >
                  <t.icon className="h-8 w-8 text-foreground" strokeWidth={2} />
                  <span className="text-center text-sm font-bold leading-tight text-muted-foreground">
                    {t.label}
                  </span>
                  {count > 0 && (
                    <span className="absolute right-1 top-0 min-w-5 rounded-full bg-[oklch(0.58_0.22_25)] px-1.5 text-center text-xs font-black text-white">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t-2 border-border pt-3">
            <Link
              to="/moedas"
              className="flex flex-col items-center gap-1 rounded-2xl bg-muted py-3 active:scale-95"
            >
              <Coins className="h-8 w-8 text-[oklch(0.72_0.17_75)]" strokeWidth={2.5} />
              <span className="text-base font-black text-foreground">Moedas</span>
              <span className="text-sm font-bold text-[oklch(0.72_0.17_75)]">
                {balance} · {formatPrice(coinsToBRL(balance))}
              </span>
            </Link>
            <Link
              to="/cupons"
              className="flex flex-col items-center gap-1 rounded-2xl bg-muted py-3 active:scale-95"
            >
              <Ticket className="h-8 w-8 text-[oklch(0.55_0.22_255)]" strokeWidth={2.5} />
              <span className="text-base font-black text-foreground">Cupons</span>
              <span className="text-sm font-bold text-[oklch(0.55_0.22_255)]">
                {claimedList.length} resgatados
              </span>
            </Link>
          </div>
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

      {editing && <ProfileSheet onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Cadastro: aparece só quando o cliente pede para alterar (ou na 1ª vez). */
function ProfileSheet({ onClose }: { onClose: () => void }) {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "known" | "new">(
    profile.name ? "known" : "idle",
  );
  const locked = status === "known";

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

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border-2 border-border bg-card p-5 shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-foreground">Meus dados</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <X className="h-6 w-6" strokeWidth={2.5} />
          </button>
        </div>

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
              setTimeout(onClose, 700);
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
          Seus dados ficam salvos neste aparelho — você só preenche uma vez.
        </p>
      </div>
    </div>
  );
}
