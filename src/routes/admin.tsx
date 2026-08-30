import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  UserSearch,
  LogOut,
  Plus,
  Receipt,
  Ticket,
  Trash2,
  Users,
  Coins,
} from "lucide-react";
import {
  findCustomerId,
  adminCoinBalance,
  adminAdjustCoins,
  coinsToBRL,
} from "@/lib/coins";
import {
  fetchReceipts,
  fetchLoyverseCustomers,
  type SimpleReceipt,
  type SimpleCustomer,
} from "@/lib/loyverse-customers.functions";
import {
  useCoupons,
  useCouponsRefresh,
  saveCoupon,
  deleteCoupon,
  isExhausted,
  type Coupon,
} from "@/lib/coupons";
import {
  fetchOrders,
  onlyDigits,
  setOrderStatus,
  fetchDuplicates,
  resolveDuplicate,
  statusLabel,
  paymentLabel,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type Order,
} from "@/lib/orders";
import { useAdmin, adminSignIn, adminSignOut } from "@/lib/admin";
import { formatPrice } from "@/lib/cart";
import { broadcastNotification } from "@/lib/notifications";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Administração — SPERB" },
      {
        name: "description",
        content: "Painel do proprietário SPERB: cupons, recibos do Loyverse e clientes.",
      },
      { property: "og:title", content: "Administração — SPERB" },
      {
        property: "og:description",
        content: "Painel do proprietário SPERB: cupons, recibos e clientes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const BLUE = "oklch(0.55 0.22 255)";
const GREEN = "oklch(0.62 0.19 145)";
const RED = "oklch(0.58 0.22 25)";

function couponLabel(c: Coupon): string {
  return c.type === "percent" ? `${c.value}% OFF` : `${formatPrice(c.value)} OFF`;
}

type Section = "home" | "pedidos" | "cupons" | "recibos" | "clientes" | "duplicidades";

const SECTIONS: {
  id: Exclude<Section, "home">;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "pedidos",
    label: "Pedidos",
    hint: "Status, pagamento e entrega",
    icon: <ClipboardList className="h-7 w-7" />,
  },
  {
    id: "clientes",
    label: "Clientes",
    hint: "Histórico, compras e cupons",
    icon: <Users className="h-7 w-7" />,
  },
  {
    id: "cupons",
    label: "Cupons",
    hint: "Criar, editar e desativar",
    icon: <Ticket className="h-7 w-7" />,
  },
  {
    id: "recibos",
    label: "Recibos Loyverse",
    hint: "Vendas registradas na loja",
    icon: <Receipt className="h-7 w-7" />,
  },
  {
    id: "duplicidades",
    label: "Revisão de cadastros",
    hint: "Possíveis clientes repetidos",
    icon: <UserSearch className="h-7 w-7" />,
  },
];

function AdminPage() {
  const { isAdmin, checking } = useAdmin();
  const [section, setSection] = useState<Section>("home");

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-lg font-bold text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!isAdmin) return <AdminLogin />;

  const current = SECTIONS.find((s) => s.id === section);

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          {section === "home" ? (
            <Link
              to="/"
              aria-label="Voltar à loja"
              className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
            >
              <ArrowLeft className="h-6 w-6" strokeWidth={2.5} />
            </Link>
          ) : (
            <button
              onClick={() => setSection("home")}
              aria-label="Voltar ao menu"
              className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
            >
              <ArrowLeft className="h-6 w-6" strokeWidth={2.5} />
            </button>
          )}
          <h1 className="text-xl font-black text-foreground">
            {current ? current.label : "Administração SPERB"}
          </h1>
          <button
            onClick={() => adminSignOut()}
            className="ml-auto inline-flex items-center gap-1 rounded-xl bg-muted px-3 py-2 text-sm font-black text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-4">
        {section === "home" && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  className="flex w-full items-center gap-4 rounded-3xl border-2 border-border bg-card p-5 text-left shadow-sm active:scale-[0.99]"
                >
                  <span
                    className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
                    style={{ backgroundColor: BLUE }}
                  >
                    {s.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg font-black text-foreground">
                      {s.label}
                    </span>
                    <span className="block text-sm font-semibold text-muted-foreground">
                      {s.hint}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {section === "pedidos" && <OrdersPanel />}
        {section === "cupons" && <CouponsPanel />}
        {section === "recibos" && <ReceiptsPanel />}
        {section === "clientes" && <CustomersPanel />}
        {section === "duplicidades" && <DuplicatesPanel />}
      </main>
    </div>
  );
}

function AdminLogin() {
  const { recheck } = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const { error } = await adminSignIn(email, password);
      if (error) {
        setError("E-mail ou senha incorretos.");
        return;
      }
      const ok = await recheck();
      if (!ok) {
        await adminSignOut();
        setError("Esta conta não tem permissão de proprietário.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-3xl border-2 border-border bg-card p-6 shadow-lg">
        <h1 className="text-2xl font-black text-foreground">Área do proprietário</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Entre com sua conta de administrador.
        </p>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          placeholder="E-mail"
          className="mt-4 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="mt-3 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
        />
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-4 w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-60"
          style={{ backgroundColor: BLUE }}
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
        {error && (
          <p className="mt-3 text-base font-bold" style={{ color: RED }}>
            {error}
          </p>
        )}
        <Link
          to="/"
          className="mt-4 block text-center text-base font-bold text-muted-foreground"
        >
          Voltar à loja
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------- Cupons -------------------------------- */

const emptyCoupon: Coupon = {
  id: "",
  code: "",
  description: "",
  type: "percent",
  value: 10,
  maxDiscount: null,
  minOrder: 0,
  maxUses: null,
  maxUsesPerCustomer: null,
  rewardCoins: 0,
  uses: 0,
  active: true,
  customerPhone: null,
};

function CouponForm({
  initial,
  onSaved,
  compact,
  editing,
}: {
  initial?: Partial<Coupon>;
  onSaved: () => void;
  compact?: boolean;
  editing?: boolean;
}) {
  const [draft, setDraft] = useState<Coupon>({ ...emptyCoupon, ...initial });
  const [capped, setCapped] = useState(Boolean(initial?.maxDiscount));
  const [limited, setLimited] = useState(initial?.maxUses != null);
  const [perCustomer, setPerCustomer] = useState(initial?.maxUsesPerCustomer != null);
  const [benefit, setBenefit] = useState<"percent" | "fixed" | "coins">(
    initial?.type === "fixed"
      ? "fixed"
      : (initial?.value ?? 0) === 0 && (initial?.rewardCoins ?? 0) > 0
        ? "coins"
        : "percent",
  );
  const [notifyClients, setNotifyClients] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const isCoins = benefit === "coins";

  async function submit() {
    setError("");
    const code = draft.code.trim().toUpperCase();
    if (!code) {
      setError("Dê um nome ao cupom.");
      return;
    }
    try {
      const saved: Coupon = {
        ...draft,
        code,
        type: isCoins ? "fixed" : benefit,
        value: isCoins ? 0 : draft.value,
        maxDiscount: benefit === "percent" && capped ? (draft.maxDiscount ?? 0) : null,
        maxUses: limited ? (draft.maxUses ?? 1) : null,
        maxUsesPerCustomer: perCustomer ? (draft.maxUsesPerCustomer ?? 1) : null,
      };
      await saveCoupon(saved);
      if (notifyClients) {
        const label = isCoins
          ? `${saved.rewardCoins} moedas de volta`
          : saved.type === "percent"
            ? `${saved.value}% OFF`
            : `${formatPrice(saved.value)} OFF`;
        await broadcastNotification(
          "coupon",
          `🎟️ Novo cupom disponível: ${label}`,
          saved.description.trim() || "Abra o app SPERB e resgate o seu cupom.",
        );
      }
      setOk(true);
      setTimeout(() => setOk(false), 1500);
      setDraft({ ...emptyCoupon, ...initial });
      setNotifyClients(false);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível salvar o cupom.",
      );
    }
  }

  const input =
    "w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none";

  const BENEFITS = [
    { id: "percent" as const, label: "% desconto" },
    { id: "fixed" as const, label: "R$ desconto" },
    { id: "coins" as const, label: "Moedas" },
  ];

  return (
    <div className={`flex flex-col gap-3 ${compact ? "" : "mt-3"}`}>
      <input
        value={draft.code}
        onChange={(e) => setDraft({ ...draft, code: e.target.value })}
        maxLength={24}
        placeholder="Nome do cupom (ex: NATAL10)"
        className={input}
      />
      <input
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        maxLength={120}
        placeholder="O que ele faz (ex: 10% em toda a loja)"
        className={input}
      />

      <p className="text-base font-black text-muted-foreground">Tipo de benefício</p>
      <div className="grid grid-cols-3 gap-2">
        {BENEFITS.map((b) => {
          const active = benefit === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setBenefit(b.id)}
              className="rounded-2xl border-2 py-3 text-base font-black active:scale-95"
              style={{
                borderColor: active ? BLUE : "var(--border)",
                backgroundColor: active ? BLUE : "var(--card)",
                color: active ? "#fff" : "var(--foreground)",
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      {!isCoins && (
        <input
          type="number"
          min={0}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
          className={input}
          placeholder={benefit === "percent" ? "Desconto em %" : "Desconto em R$"}
        />
      )}

      {benefit === "percent" && (
        <>
          <label className="flex items-center gap-3 text-lg font-bold text-foreground">
            <input
              type="checkbox"
              checked={capped}
              onChange={(e) => setCapped(e.target.checked)}
              className="h-6 w-6"
            />
            Limitar desconto máximo (R$)
          </label>
          {capped && (
            <input
              type="number"
              min={0}
              value={draft.maxDiscount ?? 0}
              onChange={(e) => setDraft({ ...draft, maxDiscount: Number(e.target.value) })}
              placeholder="Ex: 20"
              className={input}
            />
          )}
        </>
      )}


      <input
        type="number"
        min={0}
        value={draft.minOrder}
        onChange={(e) => setDraft({ ...draft, minOrder: Number(e.target.value) })}
        placeholder="Valor mínimo do pedido (R$)"
        className={input}
      />
      <label className="flex items-center gap-3 text-lg font-bold text-foreground">
        <input
          type="checkbox"
          checked={limited}
          onChange={(e) => setLimited(e.target.checked)}
          className="h-6 w-6"
        />
        Limitar número de usos
      </label>
      {limited && (
        <input
          type="number"
          min={1}
          value={draft.maxUses ?? 1}
          onChange={(e) => setDraft({ ...draft, maxUses: Number(e.target.value) })}
          placeholder="Quantidade de usos"
          className={input}
        />
      )}

      <label className="flex items-center gap-3 text-lg font-bold text-foreground">
        <input
          type="checkbox"
          checked={perCustomer}
          onChange={(e) => setPerCustomer(e.target.checked)}
          className="h-6 w-6"
        />
        Limitar usos por cliente
      </label>
      {perCustomer && (
        <input
          type="number"
          min={1}
          value={draft.maxUsesPerCustomer ?? 1}
          onChange={(e) =>
            setDraft({ ...draft, maxUsesPerCustomer: Number(e.target.value) })
          }
          placeholder="Usos por cliente (ex: 1)"
          className={input}
        />
      )}

      <label className="flex items-center gap-3 text-lg font-bold text-foreground">
        <input
          type="checkbox"
          checked={notifyClients}
          onChange={(e) => setNotifyClients(e.target.checked)}
          className="h-6 w-6"
        />
        Enviar notificação aos clientes
      </label>

      <label className="text-base font-bold text-foreground">
        Moedas de volta ao concluir o pedido
        <input
          type="number"
          min={0}
          value={draft.rewardCoins}
          onChange={(e) => setDraft({ ...draft, rewardCoins: Number(e.target.value) })}
          placeholder="0"
          className={input}
        />
      </label>

      <button
        onClick={() => void submit()}
        className="inline-flex items-center justify-center gap-2 rounded-2xl py-4 text-xl font-black text-white active:scale-[0.98]"
        style={{ backgroundColor: ok ? GREEN : BLUE }}
      >
        <Plus className="h-6 w-6" strokeWidth={3} />
        {ok ? "Cupom salvo!" : editing ? "Salvar alterações" : "Salvar cupom"}
      </button>
      {error && (
        <p className="text-base font-bold" style={{ color: RED }}>
          {error}
        </p>
      )}
    </div>
  );
}

function CouponList({ coupons, onChanged }: { coupons: Coupon[]; onChanged: () => void }) {
  if (coupons.length === 0)
    return <p className="mt-2 text-muted-foreground">Nenhum cupom ainda.</p>;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {coupons.map((c) => (
        <CouponRow key={c.id} coupon={c} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function CouponRow({ coupon: c, onChanged }: { coupon: Coupon; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-2xl border-2 border-border p-3">
      <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-black text-foreground">
              {c.code} · {couponLabel(c)}
              {c.customerPhone && " · exclusivo"}
            </p>
            <p className="text-sm text-muted-foreground">
              Mín. {formatPrice(c.minOrder)}
              {c.type === "percent" &&
                c.maxDiscount !== null &&
                ` · máx. ${formatPrice(c.maxDiscount)}`}{" "}
              ·{" "}
              {c.maxUses === null ? "usos ilimitados" : `${c.uses}/${c.maxUses} usos`}
              {c.maxUsesPerCustomer !== null &&
                ` · ${c.maxUsesPerCustomer} por cliente`}
              {c.rewardCoins > 0 && ` · devolve ${c.rewardCoins} moedas`}
              {isExhausted(c) && " · esgotado"}
            </p>
          </div>
          <button
            onClick={async () => {
              await saveCoupon({ ...c, active: !c.active });
              onChanged();
            }}
            className={`rounded-xl px-3 py-2 text-sm font-black ${
              c.active ? "text-white" : "bg-muted text-muted-foreground"
            }`}
            style={c.active ? { backgroundColor: GREEN } : undefined}
          >
            {c.active ? <Check className="h-4 w-4" /> : "Off"}
          </button>
          <button
            aria-label={`Excluir ${c.code}`}
            onClick={async () => {
              await deleteCoupon(c.id);
              onChanged();
            }}
            className="rounded-xl bg-muted p-2"
            style={{ color: RED }}
          >
            <Trash2 className="h-5 w-5" />
          </button>
      </div>
      <button
        onClick={() => setEditing((v) => !v)}
        className="mt-2 w-full rounded-xl bg-muted py-2 text-base font-black text-foreground"
      >
        {editing ? "Fechar edição" : "Editar cupom"}
      </button>
      {editing && (
        <CouponForm
          initial={c}
          editing
          compact
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function CouponsPanel() {
  const coupons = useCoupons();
  const refresh = useCouponsRefresh();

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4">
      <h2 className="text-xl font-black text-foreground">Cupons dos clientes SPERB</h2>
      <CouponForm onSaved={() => void refresh()} />
      <h3 className="mt-6 text-lg font-black text-foreground">Cupons cadastrados</h3>
      <CouponList coupons={coupons} onChanged={() => void refresh()} />
    </section>
  );
}

/* ------------------------------- Recibos ------------------------------- */

const WHATSAPP_COUNTRY = "55";

function receiptText(r: SimpleReceipt): string {
  const linhas = r.lines
    .map((l) => `- ${l.name} x${l.quantity} — ${formatPrice(l.total)}`)
    .join("\n");
  const data = new Date(r.date).toLocaleString("pt-BR");
  return `*Recibo SPERB*\nPedido: ${r.number}\nData: ${data}\nCliente: ${r.customerName}\n\n${linhas}\n\nTotal: ${formatPrice(r.total)}\n\nObrigado pela preferência!`;
}

function whatsappLink(r: SimpleReceipt): string | null {
  const digits = onlyDigits(r.customerPhone);
  if (digits.length < 10) return null;
  const phone = digits.startsWith(WHATSAPP_COUNTRY) ? digits : `${WHATSAPP_COUNTRY}${digits}`;
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(receiptText(r))}`;
}

function useReceipts() {
  return useQuery({
    queryKey: ["loyverse-receipts"],
    queryFn: () => fetchReceipts(),
    staleTime: 60 * 1000,
  });
}

function ReceiptCard({ r }: { r: SimpleReceipt }) {
  const link = whatsappLink(r);
  return (
    <li className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-black text-foreground">{r.customerName}</p>
          <p className="text-xs font-semibold text-muted-foreground">
            {r.number} · {new Date(r.date).toLocaleString("pt-BR")}
          </p>
        </div>
        <span className="shrink-0 text-lg font-black" style={{ color: GREEN }}>
          {formatPrice(r.total)}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {r.lines.map((l, i) => (
          <li key={i} className="text-sm text-muted-foreground">
            {l.quantity}x {l.name} — {formatPrice(l.total)}
          </li>
        ))}
      </ul>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex rounded-xl px-3 py-2 text-sm font-black text-white"
          style={{ backgroundColor: GREEN }}
        >
          Enviar recibo no WhatsApp
        </a>
      ) : (
        <p className="mt-2 text-xs font-bold text-muted-foreground">
          Cliente sem telefone cadastrado no Loyverse.
        </p>
      )}
    </li>
  );
}

function ReceiptsPanel() {
  const { data, isLoading, error, refetch, isFetching } = useReceipts();

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black text-foreground">Recibos do Loyverse</h2>
        <button
          onClick={() => void refetch()}
          className="rounded-xl bg-muted px-3 py-2 text-sm font-black text-foreground active:scale-95"
        >
          {isFetching ? "..." : "Atualizar"}
        </button>
      </div>

      {isLoading && <p className="mt-3 text-base text-muted-foreground">Carregando vendas…</p>}
      {error && (
        <p className="mt-3 text-base font-bold" style={{ color: RED }}>
          Não foi possível carregar os recibos do Loyverse.
        </p>
      )}
      {data && (
        <p className="mt-1 text-sm font-bold text-muted-foreground">
          {data.length} venda(s) sincronizada(s).
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {(data ?? []).map((r) => (
          <ReceiptCard key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------ Clientes ------------------------------- */

function CustomersPanel() {
  const customers = useQuery({
    queryKey: ["loyverse-customers"],
    queryFn: () => fetchLoyverseCustomers(),
    staleTime: 60 * 1000,
  });
  const receipts = useReceipts();
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    staleTime: 30 * 1000,
  });
  const [selected, setSelected] = useState<SimpleCustomer | null>(null);
  const [search, setSearch] = useState("");

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = customers.data ?? [];
    if (!q) return all;
    return all.filter(
      (c) => c.name.toLowerCase().includes(q) || onlyDigits(c.phone).includes(onlyDigits(q)),
    );
  }, [customers.data, search]);

  if (selected) {
    return (
      <CustomerDetail
        customer={selected}
        receipts={receipts.data ?? []}
        orders={orders.data ?? []}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black text-foreground">Clientes do Loyverse</h2>
        <button
          onClick={() => void customers.refetch()}
          className="rounded-xl bg-muted px-3 py-2 text-sm font-black text-foreground"
        >
          {customers.isFetching ? "..." : "Atualizar"}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou telefone"
        className="mt-3 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
      />

      {customers.isLoading && (
        <p className="mt-3 text-muted-foreground">Carregando clientes…</p>
      )}
      {customers.error && (
        <p className="mt-3 font-bold" style={{ color: RED }}>
          Não foi possível carregar os clientes do Loyverse.
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {list.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => setSelected(c)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-3 text-left active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-black text-foreground">{c.name}</p>
                <p className="text-sm font-semibold text-muted-foreground">
                  {c.phone || "sem telefone"}
                </p>
              </div>
              <span className="shrink-0 text-sm font-black" style={{ color: GREEN }}>
                {c.totalVisits} compra(s)
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoinsPanel({ phone }: { phone: string }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    setBalance(null);
    setCustomerId(null);
    void (async () => {
      const id = await findCustomerId(phone);
      if (!alive) return;
      setCustomerId(id);
      if (id) setBalance(await adminCoinBalance(id));
    })();
    return () => {
      alive = false;
    };
  }, [phone]);

  async function apply(sign: 1 | -1) {
    if (!customerId) return;
    const value = Math.abs(parseInt(amount, 10) || 0);
    if (value <= 0) return;
    const next = await adminAdjustCoins(customerId, sign * value, reason);
    if (next === null) {
      setMsg("Não foi possível ajustar as moedas.");
      return;
    }
    setBalance(next);
    setAmount("");
    setReason("");
    setMsg("Saldo atualizado.");
    setTimeout(() => setMsg(""), 1500);
  }

  return (
    <section className="mt-4 rounded-2xl border-2 border-border bg-background p-4">
      <h3 className="flex items-center gap-2 text-lg font-black text-foreground">
        <Coins className="h-5 w-5 text-[oklch(0.72_0.17_75)]" /> Moedas do cliente
      </h3>
      {!customerId ? (
        <p className="mt-1 text-base text-muted-foreground">
          Este cliente ainda não tem cadastro no banco central (precisa de telefone).
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-black text-foreground">
            {balance ?? 0}{" "}
            <span className="text-base font-semibold text-muted-foreground">
              ({formatPrice(coinsToBRL(balance ?? 0))})
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="Qtd. de moedas"
              className="w-36 rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-bold text-foreground"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo"
              className="min-w-40 flex-1 rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-bold text-foreground"
            />
            <button
              onClick={() => void apply(1)}
              className="rounded-xl bg-[oklch(0.62_0.19_145)] px-4 py-2 text-base font-black text-white active:scale-95"
            >
              Adicionar
            </button>
            <button
              onClick={() => void apply(-1)}
              className="rounded-xl bg-[oklch(0.58_0.22_25)] px-4 py-2 text-base font-black text-white active:scale-95"
            >
              Retirar
            </button>
          </div>
          {msg && <p className="mt-2 text-base font-bold text-muted-foreground">{msg}</p>}
        </>
      )}
    </section>
  );
}

function CustomerDetail({
  customer,
  receipts,
  orders,
  onBack,
}: {
  customer: SimpleCustomer;
  receipts: SimpleReceipt[];
  orders: Order[];
  onBack: () => void;
}) {
  const coupons = useCoupons();
  const refresh = useCouponsRefresh();
  const phone = onlyDigits(customer.phone);

  const mineReceipts = receipts.filter((r) => phone && onlyDigits(r.customerPhone) === phone);
  const mineOrders = orders.filter((o) => phone && onlyDigits(o.customerPhone) === phone);
  const usedCoupons = Array.from(
    new Set(mineOrders.map((o) => o.couponCode).filter(Boolean)),
  );
  const exclusive = coupons.filter(
    (c) => c.customerPhone && onlyDigits(c.customerPhone) === phone,
  );
  const spent = mineReceipts.reduce((s, r) => s + r.total, 0) || customer.totalSpent;

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm font-black text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Todos os clientes
      </button>

      <h2 className="mt-3 text-2xl font-black text-foreground">{customer.name}</h2>
      <p className="text-base font-semibold text-muted-foreground">
        {customer.phone || "sem telefone"} · total comprado {formatPrice(spent)}
      </p>

      <CoinsPanel phone={customer.phone} />


      <h3 className="mt-5 text-lg font-black text-foreground">
        Pedidos enviados pelo app ({mineOrders.length})
      </h3>
      {mineOrders.length === 0 ? (
        <p className="text-muted-foreground">Nenhum pedido pelo app ainda.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {mineOrders.map((o) => (
            <li key={o.id} className="rounded-2xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-foreground">
                  {new Date(o.createdAt).toLocaleString("pt-BR")}
                </p>
                <span className="text-base font-black" style={{ color: BLUE }}>
                  {formatPrice(o.total)}
                </span>
              </div>
              <ul className="mt-1">
                {o.items.map((it, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    {it.qty}x {it.name} — {formatPrice(it.price * it.qty)}
                  </li>
                ))}
              </ul>
              {o.couponCode && (
                <p className="mt-1 text-sm font-bold" style={{ color: GREEN }}>
                  Cupom {o.couponCode} · -{formatPrice(o.discount)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-lg font-black text-foreground">
        Recibos de venda ({mineReceipts.length})
      </h3>
      {mineReceipts.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma venda no Loyverse para este cliente.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {mineReceipts.map((r) => (
            <ReceiptCard key={r.id} r={r} />
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-lg font-black text-foreground">Cupons usados</h3>
      {usedCoupons.length === 0 ? (
        <p className="text-muted-foreground">Nenhum cupom usado.</p>
      ) : (
        <p className="mt-1 text-base font-bold text-foreground">{usedCoupons.join(", ")}</p>
      )}

      <h3 className="mt-5 text-lg font-black text-foreground">Cupons exclusivos dele</h3>
      <CouponList coupons={exclusive} onChanged={() => void refresh()} />

      <h3 className="mt-5 text-lg font-black text-foreground">
        Criar cupom exclusivo para {customer.name}
      </h3>
      {phone ? (
        <CouponForm
          compact
          initial={{ customerPhone: phone, description: `Exclusivo ${customer.name}` }}
          onSaved={() => void refresh()}
        />
      ) : (
        <p className="text-muted-foreground">
          Cadastre um telefone para este cliente no Loyverse para criar cupons exclusivos.
        </p>
      )}
    </section>
  );
}

/* ----------------------------- Pedidos --------------------------------- */

function OrdersPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: fetchOrders,
    staleTime: 30 * 1000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function change(o: Order, status: string, payment: string) {
    setBusy(o.id);
    await setOrderStatus(o.id, status, payment);
    setBusy(null);
    void refetch();
  }

  if (isLoading) {
    return <p className="text-lg font-semibold text-muted-foreground">Carregando…</p>;
  }
  if ((data ?? []).length === 0) {
    return <p className="text-lg font-semibold text-muted-foreground">Nenhum pedido ainda.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {(data ?? []).map((o) => (
        <li key={o.id} className="rounded-3xl border-2 border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-black text-foreground">
                {o.customerName || "Sem nome"}
              </p>
              <p className="text-sm font-bold text-muted-foreground">
                {o.customerPhone} · {new Date(o.createdAt).toLocaleString("pt-BR")}
              </p>
            </div>
            <span className="shrink-0 text-xl font-black" style={{ color: BLUE }}>
              {formatPrice(o.total)}
            </span>
          </div>

          <ul className="mt-2 flex flex-col gap-1">
            {o.items.map((it, i) => (
              <li key={i} className="text-base font-semibold text-foreground">
                {it.qty}x {it.name} — {formatPrice(it.price * it.qty)}
              </li>
            ))}
          </ul>

          {o.discount > 0 && (
            <p className="mt-1 text-base font-bold text-muted-foreground">
              Cupom {o.couponCode}: -{formatPrice(o.discount)}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {ORDER_STATUSES.map((st) => {
              const activeStep = o.status === st.value;
              return (
                <button
                  key={st.value}
                  disabled={busy === o.id || activeStep}
                  onClick={() => void change(o, st.value, o.paymentStatus)}
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-black active:scale-95 disabled:opacity-100 ${
                    activeStep
                      ? "border-transparent text-white"
                      : "border-border bg-background text-foreground"
                  }`}
                  style={activeStep ? { backgroundColor: BLUE } : undefined}
                >
                  {st.label}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={o.status}
              disabled={busy === o.id}
              onChange={(e) => void change(o, e.target.value, o.paymentStatus)}
              aria-label={`Status do pedido de ${o.customerName}`}
              className="rounded-xl border-2 border-border bg-background px-3 py-2 text-base font-black text-foreground"
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={o.paymentStatus}
              disabled={busy === o.id}
              onChange={(e) => void change(o, o.status, e.target.value)}
              aria-label={`Pagamento do pedido de ${o.customerName}`}
              className="rounded-xl border-2 border-border bg-background px-3 py-2 text-base font-black text-foreground"
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="text-sm font-bold text-muted-foreground">
              {statusLabel(o.status)} · {paymentLabel(o.paymentStatus)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------- Duplicidades ------------------------------- */

function DuplicatesPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-duplicates"],
    queryFn: fetchDuplicates,
    staleTime: 30 * 1000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "update_phone" | "keep_new" | "later") {
    setBusy(id);
    await resolveDuplicate(id, action);
    setBusy(null);
    void refetch();
  }

  if (isLoading) {
    return <p className="text-lg font-semibold text-muted-foreground">Carregando…</p>;
  }
  if ((data ?? []).length === 0) {
    return (
      <p className="text-lg font-semibold text-muted-foreground">
        Nenhum cadastro suspeito de duplicidade.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {(data ?? []).map((d) => (
        <li key={d.id} className="rounded-3xl border-2 border-border bg-card p-4 shadow-sm">
          <p className="text-base font-bold text-muted-foreground">
            Cadastro existente
          </p>
          <p className="text-lg font-black text-foreground">
            {d.existingName} · {d.existingPhone}
          </p>
          <p className="mt-2 text-base font-bold text-muted-foreground">Novo cadastro</p>
          <p className="text-lg font-black text-foreground">
            {d.incomingName} · {d.incomingPhone}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={busy === d.id}
              onClick={() => void act(d.id, "update_phone")}
              className="rounded-xl px-4 py-2 text-base font-black text-white"
              style={{ backgroundColor: BLUE }}
            >
              É a mesma pessoa
            </button>
            <button
              disabled={busy === d.id}
              onClick={() => void act(d.id, "keep_new")}
              className="rounded-xl border-2 border-border bg-card px-4 py-2 text-base font-black text-foreground"
            >
              São clientes diferentes
            </button>
            <button
              disabled={busy === d.id}
              onClick={() => void act(d.id, "later")}
              className="rounded-xl bg-muted px-4 py-2 text-base font-black text-foreground"
            >
              Decidir depois
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
