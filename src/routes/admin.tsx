import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
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
  Star,
  CreditCard,
  PackageSearch,
  Search,
  TrendingUp,
  AlertTriangle,
  CircleDollarSign,
  Boxes,
  LockKeyhole,
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
  setPayOnDelivery,
  confirmRefund,
  cancelExpiredUnpaidOrders,
  paymentDisplayLabel,
  displayStatusLabel,
  fetchDuplicates,
  resolveDuplicate,
  statusLabel,
  minutesLeftToPay,
  type Order,
} from "@/lib/orders";
import { useServerFn } from "@tanstack/react-start";
import { retryLoyverseSync } from "@/lib/loyverse-sync.functions";
import { runLoyverseQuickSync } from "@/lib/loyverse-reconcile.functions";
import { useAdmin, adminSignIn, adminSignOut } from "@/lib/admin";
import { formatPrice } from "@/lib/cart";
import { broadcastNotification } from "@/lib/notifications";
import { fetchDevelopmentMode, setDevelopmentMode } from "@/lib/desenvolvimento";
import { fetchCatalog, type CatalogProduct } from "@/lib/loyverse.functions";
import { useLiveInvalidate } from "@/lib/live";
import { ReceiptDownload } from "@/components/receipt-download";
import {
  FEATURED_SECTIONS,
  fetchFeatured,
  addFeatured,
  removeFeatured,
  sectionLabel,
  type FeaturedSection,
} from "@/lib/merchandising";
import { AdminShell } from "@/components/admin/admin-shell";
import { DashboardPanel } from "@/components/admin/dashboard-panel";
import { isModuleId, moduleById, type ModuleId } from "@/components/admin/admin-modules";
import { ModuleHeader, Toolbar, FilterPill, EmptyState } from "@/components/admin/admin-ui";

export const Route = createFileRoute("/admin")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { m?: ModuleId } =>
    isModuleId(s["m"]) ? { m: s["m"] } : {},
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
  if (!(c.value > 0)) return "Moedas de volta";
  return c.type === "percent" ? `${c.value}% OFF` : `${formatPrice(c.value)} OFF`;
}

function AdminPage() {
  // Pedidos novos e mudanças de pagamento aparecem sozinhos no painel.
  useLiveInvalidate([
    { table: "orders", keys: [["orders"], ["admin-orders"]] },
  ]);
  const { isAdmin, checking } = useAdmin();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const active: ModuleId = isModuleId(search.m) ? search.m : "inicio";

  const open = (id: ModuleId) => {
    void navigate({ search: id === "inicio" ? {} : { m: id }, replace: false });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-lg font-bold text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!isAdmin) return <AdminLogin />;

  return (
    <AdminShell active={active} onSelect={open} onSignOut={() => adminSignOut()}>
      {active === "inicio" && <DashboardPanel onOpen={open} />}
      {active === "pedidos" && <OrdersPanel />}
      {active === "cupons" && <CouponsPanel />}
      {active === "recibos" && <ReceiptsPanel />}
      {active === "estoque" && <StockPanel />}
      {active === "clientes" && <CustomersPanel />}
      {active === "destaques" && <FeaturedPanel />}
      {active === "duplicidades" && <DuplicatesPanel />}
      {active === "desenvolvimento" && <DevelopmentPanel />}
    </AdminShell>
  );
}

function DevelopmentPanel() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetchDevelopmentMode().then((value) => {
      setEnabled(value);
      setLoading(false);
    });
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage("");
    const ok = await setDevelopmentMode(next);
    if (ok) {
      setEnabled(next);
      setMessage(next ? "Modo desenvolvimento ativado." : "Loja liberada para os clientes.");
    } else {
      setMessage("Não foi possível alterar o modo desenvolvimento.");
    }
    setBusy(false);
  }

  if (loading) {
    return <div className="rounded-3xl border bg-card p-6 text-base font-bold text-muted-foreground">Carregando configuração…</div>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border-2 border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <LockKeyhole className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-black text-foreground">Modo desenvolvimento</h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-muted-foreground">
              Quando estiver ligado, os clientes não conseguem entrar na loja. Somente uma conta de administrador consegue acessar o aplicativo.
            </p>
          </div>
        </div>

        <div className={`mt-5 rounded-2xl border-2 p-4 ${enabled ? "border-destructive/30 bg-destructive/5" : "border-primary/20 bg-primary/5"}`}>
          <p className="text-base font-black text-foreground">
            {enabled ? "🔒 Loja em manutenção" : "🟢 Loja aberta para clientes"}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            {enabled
              ? "A tela de manutenção será mostrada automaticamente para quem acessar o aplicativo."
              : "O aplicativo está funcionando normalmente para os clientes."}
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy || enabled}
            onClick={() => void toggle(true)}
            className="rounded-2xl bg-destructive px-4 py-3.5 text-base font-black text-destructive-foreground disabled:opacity-50"
          >
            {busy && !enabled ? "Ativando…" : "Ativar manutenção"}
          </button>
          <button
            type="button"
            disabled={busy || !enabled}
            onClick={() => void toggle(false)}
            className="rounded-2xl bg-primary px-4 py-3.5 text-base font-black text-primary-foreground disabled:opacity-50"
          >
            {busy && enabled ? "Liberando…" : "Desativar e abrir loja"}
          </button>
        </div>

        {message && <p className="mt-4 text-sm font-bold text-muted-foreground">{message}</p>}
      </section>

      <p className="px-1 text-sm font-semibold leading-5 text-muted-foreground">
        O login usado aqui é o mesmo login de administrador já existente no painel SPERB. Não criamos uma segunda senha.
      </p>
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
  rewardType: "fixed",
  rewardPercent: 0,
  rewardMinOrder: 0,
  rewardMaxCoins: null,

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
  const [hasMinOrder, setHasMinOrder] = useState((initial?.minOrder ?? 0) > 0);
  const [rewardCapped, setRewardCapped] = useState(initial?.rewardMaxCoins != null);

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
        minOrder: hasMinOrder ? draft.minOrder : 0,
        rewardMaxCoins:
          draft.rewardType === "percent" && rewardCapped
            ? (draft.rewardMaxCoins ?? 0)
            : null,

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


      <label className="flex items-center gap-3 text-lg font-bold text-foreground">
        <input
          type="checkbox"
          checked={hasMinOrder}
          onChange={(e) => {
            setHasMinOrder(e.target.checked);
            if (!e.target.checked) setDraft({ ...draft, minOrder: 0 });
          }}
          className="h-6 w-6"
        />
        Exigir valor mínimo do pedido (R$)
      </label>
      {hasMinOrder && (
        <input
          type="number"
          min={0}
          value={draft.minOrder}
          onChange={(e) => setDraft({ ...draft, minOrder: Number(e.target.value) })}
          placeholder="Valor mínimo do pedido (R$)"
          className={input}
        />
      )}

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

      <p className="text-base font-black text-muted-foreground">
        Moedas de volta ao concluir o pedido
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { id: "fixed" as const, label: "Valor fixo" },
            { id: "percent" as const, label: "% da compra" },
          ]
        ).map((r) => {
          const active = draft.rewardType === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setDraft({ ...draft, rewardType: r.id })}
              className="rounded-2xl border-2 py-3 text-base font-black active:scale-95"
              style={{
                borderColor: active ? BLUE : "var(--border)",
                backgroundColor: active ? BLUE : "var(--card)",
                color: active ? "#fff" : "var(--foreground)",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {draft.rewardType === "fixed" ? (
        <input
          type="number"
          min={0}
          value={draft.rewardCoins}
          onChange={(e) => setDraft({ ...draft, rewardCoins: Number(e.target.value) })}
          placeholder="Moedas (ex: 500)"
          className={input}
        />
      ) : (
        <>
          <input
            type="number"
            min={0}
            max={100}
            value={draft.rewardPercent}
            onChange={(e) =>
              setDraft({ ...draft, rewardPercent: Number(e.target.value) })
            }
            placeholder="% da compra em moedas (ex: 50)"
            className={input}
          />
          <input
            type="number"
            min={0}
            value={draft.rewardMinOrder}
            onChange={(e) =>
              setDraft({ ...draft, rewardMinOrder: Number(e.target.value) })
            }
            placeholder="Compra mínima para ganhar moedas (R$)"
            className={input}
          />
          <label className="flex items-center gap-3 text-lg font-bold text-foreground">
            <input
              type="checkbox"
              checked={rewardCapped}
              onChange={(e) => setRewardCapped(e.target.checked)}
              className="h-6 w-6"
            />
            Limitar moedas máximas
          </label>
          {rewardCapped && (
            <input
              type="number"
              min={0}
              value={draft.rewardMaxCoins ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, rewardMaxCoins: Number(e.target.value) })
              }
              placeholder="Máximo de moedas (1.000 moedas = R$ 10,00)"
              className={input}
            />
          )}
          <p className="text-sm text-muted-foreground">
            Ex.: 50% em uma compra de R$ 10,00 gera R$ 5,00 em moedas (500 moedas),
            respeitando o limite máximo.
          </p>
        </>
      )}


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

  const color = moduleById("cupons")?.color ?? BLUE;
  return (
    <div>
      <ModuleHeader
        color={color}
        icon={<Ticket className="h-6 w-6" />}
        title="Cupons"
        hint={`${coupons.length} cupom(ns) cadastrado(s)`}
      />
      <section className="rounded-3xl border bg-card p-4 shadow-sm">
        <CouponForm onSaved={() => void refresh()} />
        <h3 className="mt-6 text-lg font-black text-foreground">Cupons cadastrados</h3>
        <CouponList coupons={coupons} onChanged={() => void refresh()} />
      </section>
    </div>
  );
}

/* -------------------------------- Estoque -------------------------------- */

function StockPanel() {
  const catalog = useQuery({
    queryKey: ["admin", "stock-catalog"],
    queryFn: () => fetchCatalog(),
    staleTime: 20 * 1000,
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">("all");

  const products = catalog.data?.products ?? [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (filter === "in") return p.stock > 0;
        if (filter === "out") return p.stock <= 0;
        if (filter === "low") {
          // Estoque baixo da SPERB: qualquer variação com 1 ou 2 unidades.
          // Se houver alguma variação zerada, o produto pertence a "Sem estoque".
          const hasOutOfStockVariant = p.variants.some((v) => v.stock <= 0);
          return !hasOutOfStockVariant && p.variants.some((v) => v.stock > 0 && v.stock <= 2);
        }
        return true;
      })
      .filter((p) => {
        if (!term) return true;
        return (
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          p.categoryName.toLowerCase().includes(term)
        );
      })
      .map((p) => {
        const costValue = p.variants.reduce(
          (sum, v) => sum + (Number.isFinite(v.stock) ? v.stock * v.cost : 0),
          0,
        );
        const saleValue = p.variants.reduce(
          (sum, v) => sum + (Number.isFinite(v.stock) ? v.stock * v.price : 0),
          0,
        );
        const profit = saleValue - costValue;
        const hasOutOfStockVariant = p.variants.some((v) => v.stock <= 0);
        const low = !hasOutOfStockVariant && p.variants.some((v) => v.stock > 0 && v.stock <= 2);
        const out = hasOutOfStockVariant;
        const active = p.variants.some((v) => v.availableForSale);
        return { product: p, costValue, saleValue, profit, low, out, active };
      });
  }, [products, search, filter]);

  const totals = useMemo(() => {
    const totalUnits = products.reduce(
      (sum, p) => sum + (Number.isFinite(p.stock) ? p.stock : 0),
      0,
    );
    const costValue = products.reduce(
      (sum, p) =>
        sum +
        p.variants.reduce(
          (inner, v) => inner + (Number.isFinite(v.stock) ? v.stock * v.cost : 0),
          0,
        ),
      0,
    );
    const saleValue = products.reduce(
      (sum, p) =>
        sum +
        p.variants.reduce(
          (inner, v) => inner + (Number.isFinite(v.stock) ? v.stock * v.price : 0),
          0,
        ),
      0,
    );
    const low = products.filter((p) => {
      const hasOutOfStockVariant = p.variants.some((v) => v.stock <= 0);
      return !hasOutOfStockVariant && p.variants.some((v) => v.stock > 0 && v.stock <= 2);
    }).length;
    const out = products.filter((p) => p.variants.some((v) => v.stock <= 0)).length;
    const active = products.filter((p) => p.variants.some((v) => v.availableForSale)).length;
    return { totalUnits, costValue, saleValue, profit: saleValue - costValue, low, out, active };
  }, [products]);

  if (catalog.isLoading) {
    return <p className="text-lg font-semibold text-muted-foreground">Carregando estoque…</p>;
  }

  if (catalog.error) {
    return (
      <div className="rounded-3xl border-2 border-border bg-card p-5">
        <p className="font-black text-foreground">Não foi possível carregar o estoque.</p>
        <button
          type="button"
          onClick={() => void catalog.refetch()}
          className="mt-3 rounded-xl px-4 py-2 text-sm font-black text-white"
          style={{ backgroundColor: BLUE }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div
        className="overflow-hidden rounded-[2rem] p-5 text-white shadow-sm sm:p-6"
        style={{ backgroundColor: BLUE }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-white/75">
              Meu estoque
            </p>
            <h2 className="mt-1 text-2xl font-black sm:text-3xl">Patrimônio em mercadoria</h2>
            <p className="mt-1 text-sm font-semibold text-white/80">
              Valores calculados a partir dos produtos e estoques do Loyverse.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void catalog.refetch()}
            className="rounded-2xl bg-white/15 px-3 py-2 text-sm font-black backdrop-blur active:scale-95"
          >
            {catalog.isFetching ? "…" : "Atualizar"}
          </button>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs font-bold text-white/70">Custo do estoque</p>
            <p className="mt-1 text-2xl font-black">{formatPrice(totals.costValue)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs font-bold text-white/70">Valor de venda</p>
            <p className="mt-1 text-2xl font-black">{formatPrice(totals.saleValue)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs font-bold text-white/70">Lucro potencial</p>
            <p className="mt-1 text-2xl font-black">{formatPrice(totals.profit)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border bg-card p-4">
          <Boxes className="h-5 w-5" style={{ color: BLUE }} />
          <p className="mt-2 text-xs font-bold text-muted-foreground">Produtos</p>
          <p className="text-2xl font-black text-foreground">{products.length}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <TrendingUp className="h-5 w-5" style={{ color: GREEN }} />
          <p className="mt-2 text-xs font-bold text-muted-foreground">Unidades</p>
          <p className="text-2xl font-black text-foreground">{totals.totalUnits}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <AlertTriangle className="h-5 w-5" style={{ color: "oklch(0.72 0.17 62)" }} />
          <p className="mt-2 text-xs font-bold text-muted-foreground">Estoque baixo</p>
          <p className="text-2xl font-black text-foreground">{totals.low}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <CircleDollarSign className="h-5 w-5" style={{ color: RED }} />
          <p className="mt-2 text-xs font-bold text-muted-foreground">Sem estoque</p>
          <p className="text-2xl font-black text-foreground">{totals.out}</p>
        </div>
      </div>

      <div className="rounded-3xl border-2 border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto, SKU ou categoria"
              className="w-full rounded-2xl border-2 border-border bg-background py-3 pl-12 pr-4 text-base font-semibold text-foreground outline-none"
            />
          </label>
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1 sm:w-auto">
            {[
              ["all", "Todos"],
              ["in", "Em estoque"],
              ["low", "Baixo"],
              ["out", "Zerado"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id as typeof filter)}
                className="rounded-xl px-2 py-2 text-xs font-black sm:px-3"
                style={
                  filter === id
                    ? { backgroundColor: BLUE, color: "#fff" }
                    : { color: "var(--muted-foreground)" }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
            <PackageSearch className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 font-black text-foreground">Nenhum produto encontrado</p>
          </div>
        ) : (
          rows.map(({ product, costValue, saleValue, profit, low, out, active }) => (
            <div
              key={product.id}
              className="rounded-3xl border-2 border-border bg-card p-4 shadow-sm"
            >
              <div className="flex gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted">
                  {product.image ? (
                    <img src={product.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center">
                      <PackageSearch className="h-7 w-7 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-foreground">{product.name}</p>
                      <p className="text-xs font-semibold text-muted-foreground">
                        {product.categoryName}{product.sku ? ` · SKU ${product.sku}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <span
                        className="rounded-full px-2 py-1 text-[10px] font-black text-white"
                        style={{ backgroundColor: active ? GREEN : "var(--muted-foreground)" }}
                      >
                        {active ? "Ativo" : "Pausado"}
                      </span>
                      {out ? (
                        <span className="rounded-full bg-destructive px-2 py-1 text-[10px] font-black text-white">
                          Sem estoque
                        </span>
                      ) : low ? (
                        <span className="rounded-full bg-[oklch(0.72_0.17_62)] px-2 py-1 text-[10px] font-black text-white">
                          Baixo
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-muted/60 p-2">
                      <p className="text-[10px] font-bold text-muted-foreground">Estoque</p>
                      <p className="text-base font-black text-foreground">
                        {Number.isFinite(product.stock) ? product.stock : "∞"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/60 p-2">
                      <p className="text-[10px] font-bold text-muted-foreground">Custo</p>
                      <p className="text-sm font-black text-foreground">{formatPrice(costValue)}</p>
                    </div>
                    <div className="rounded-xl bg-muted/60 p-2">
                      <p className="text-[10px] font-bold text-muted-foreground">Venda</p>
                      <p className="text-sm font-black text-foreground">{formatPrice(saleValue)}</p>
                    </div>
                    <div className="rounded-xl bg-muted/60 p-2">
                      <p className="text-[10px] font-bold text-muted-foreground">Lucro</p>
                      <p className="text-sm font-black" style={{ color: profit >= 0 ? GREEN : RED }}>
                        {formatPrice(profit)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              {product.variants.length > 1 && (
                <div className="mt-3 border-t pt-3">
                  <p className="mb-2 text-xs font-black text-muted-foreground">Variações</p>
                  <div className="flex flex-wrap gap-2">
                    {product.variants.map((v) => (
                      <span key={v.id} className="rounded-xl bg-muted px-2.5 py-1.5 text-xs font-bold text-foreground">
                        {v.label || "Única"}: {Number.isFinite(v.stock) ? v.stock : "∞"} un · {formatPrice(v.price)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
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
          {r.refunded && (
            <span
              className="mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-black text-white"
              style={{ backgroundColor: RED }}
            >
              Reembolsado no Loyverse
            </span>
          )}
        </div>
        <span
          className="shrink-0 text-lg font-black"
          style={{ color: r.refunded ? RED : GREEN }}
        >
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

  const color = moduleById("recibos")?.color ?? BLUE;
  return (
    <section className="rounded-3xl border bg-card p-4 shadow-sm">
      <ModuleHeader
        color={color}
        icon={<Receipt className="h-6 w-6" />}
        title="Recibos Loyverse"
        hint="Vendas registradas na loja física"
        action={
          <button
            onClick={() => void refetch()}
            className="rounded-2xl px-3 py-2 text-sm font-black text-white active:scale-95"
            style={{ backgroundColor: color }}
          >
            {isFetching ? "..." : "Atualizar"}
          </button>
        }
      />


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

/** Há quanto tempo o pedido do WhatsApp espera pagamento. */
function waitingLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)} dias`;
}

function OrdersPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: fetchOrders,
    staleTime: 30 * 1000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState("all");
  const [q, setQ] = useState("");
  const [activeStatus, setActiveStatus] = useState<"topay" | "preparing" | "shipping" | "delivered" | "canceled">("topay");
  const syncReceipt = useServerFn(retryLoyverseSync);
  const quickSync = useServerFn(runLoyverseQuickSync);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const expired = await cancelExpiredUnpaidOrders();
        const res = await quickSync({});
        if (alive && (expired > 0 || (res.ok && (res.refundsApplied > 0 || res.resynced > 0)))) {
          void refetch();
        }
      } catch {
        /* o webhook continua sendo o canal principal */
      }
    })();
    return () => { alive = false; };
  }, [quickSync, refetch]);

  async function change(o: Order, status: string) {
    setBusy(o.id);
    const ok = await setOrderStatus(o.id, status, "");
    setBusy(null);
    if (!ok) window.alert("Esta mudança de status não é permitida.");
    void refetch();
  }

  async function payOnDelivery(o: Order) {
    setBusy(o.id);
    const ok = await setPayOnDelivery(o.id);
    if (ok) await syncReceipt({ data: { orderId: o.id } }).catch(() => null);
    setBusy(null);
    if (!ok) window.alert("Não foi possível marcar o pagamento na entrega.");
    void refetch();
  }

  function isInfinitePayPaid(o: Order): boolean {
    if (o.paymentMethod === "delivery") return false;
    const provider = `${o.paymentProvider ?? ""}`.toLowerCase();
    return Boolean(provider.includes("infinite") || o.paymentTransactionNsu || o.paymentSlug || o.paymentOrderNsu || o.receiptUrl);
  }

  async function refundWithInfinitePay(o: Order) {
    openInfinitePaySale(o);
    const proof = window.prompt(
      "Depois de devolver o dinheiro na InfinitePay, cole aqui o link do comprovante do reembolso (opcional):",
      o.receiptUrl ?? "",
    );
    if (proof === null) return;
    setBusy(o.id);
    const ok = await confirmRefund(o.id, proof.trim());
    setBusy(null);
    if (!ok) window.alert("Não foi possível registrar o reembolso.");
    void refetch();
  }

  async function markRefunded(o: Order) {
    const proof = window.prompt("Link do comprovante do reembolso (opcional):", "");
    if (proof === null) return;
    setBusy(o.id);
    const ok = await confirmRefund(o.id, proof.trim());
    setBusy(null);
    if (!ok) window.alert("Não foi possível registrar o reembolso.");
    void refetch();
  }

  function openInfinitePaySale(o: Order) {
    const ids = [
      o.paymentTransactionNsu ? `transaction_nsu: ${o.paymentTransactionNsu}` : "",
      o.paymentSlug ? `slug: ${o.paymentSlug}` : "",
      o.paymentOrderNsu ? `order_nsu: ${o.paymentOrderNsu}` : "",
    ].filter(Boolean).join("\n");
    if (o.receiptUrl) {
      window.open(o.receiptUrl, "_blank", "noopener");
      return;
    }
    window.alert(ids ? `Abra o app InfinitePay em Vendas e localize a venda:\n\n${ids}` : "Sem identificadores da InfinitePay para este pedido.");
  }

  function bucket(order: Order): "topay" | "preparing" | "shipping" | "delivered" | "canceled" {
    if (order.status === "canceled" || order.paymentStatus === "refunded") return "canceled";
    if (order.status === "delivered") return "delivered";
    if (order.paymentStatus !== "paid") return "topay";
    if (order.status === "shipping") return "shipping";
    return "preparing";
  }

  if (isLoading) return <p className="px-4 text-base text-muted-foreground">Carregando pedidos…</p>;

  const orders = data ?? [];
  const customerOptions = Array.from(
    new Map(
      orders
        .filter((o) => o.customerPhone)
        .map((o) => [onlyDigits(o.customerPhone), { phone: onlyDigits(o.customerPhone), name: o.customerName || o.customerPhone }]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const term = q.trim().toLowerCase();
  const customerOrders = (selectedCustomer === "all"
    ? orders
    : orders.filter((o) => onlyDigits(o.customerPhone) === selectedCustomer)
  ).filter((o) => {
    if (!term) return true;
    return (
      (o.customerName ?? "").toLowerCase().includes(term) ||
      onlyDigits(o.customerPhone).includes(onlyDigits(term)) ||
      o.id.toLowerCase().includes(term)
    );
  });

  const groups = [
    { value: "topay" as const, label: "A pagar" },
    { value: "preparing" as const, label: "Preparando" },
    { value: "shipping" as const, label: "A caminho" },
    { value: "delivered" as const, label: "Finalizado" },
    { value: "canceled" as const, label: "Cancelado" },
  ].map((section) => ({
    ...section,
    list: customerOrders.filter((o) => bucket(o) === section.value),
  }));

  const currentGroup = groups.find((g) => g.value === activeStatus) ?? groups[0];
  const refunded = (o: Order) => o.paymentStatus === "refunded" || o.refundState === "refunded";

  return (
    <div className="min-h-0">
      <ModuleHeader
        color={moduleById("pedidos")?.color ?? BLUE}
        icon={<ClipboardList className="h-6 w-6" />}
        title="Pedidos"
        hint={`${customerOrders.length} pedido(s) em vista`}
        action={
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-2xl px-3 py-2 text-sm font-black text-white active:scale-95"
            style={{ backgroundColor: BLUE }}
          >
            Atualizar
          </button>
        }
      />

      <Toolbar
        value={q}
        onChange={setQ}
        placeholder="Buscar por nome, telefone ou número do pedido"
      >
        <select
          value={selectedCustomer}
          onChange={(e) => setSelectedCustomer(e.target.value)}
          className="rounded-2xl border bg-card px-3 py-2.5 text-sm font-black text-foreground outline-none"
        >
          <option value="all">Todos os clientes</option>
          {customerOptions.map((customer) => (
            <option key={customer.phone} value={customer.phone}>
              {customer.name} · {customer.phone}
            </option>
          ))}
        </select>
      </Toolbar>

      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-border bg-background/95 px-1 backdrop-blur sm:-mx-6">
        <div className="relative flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((group) => (
            <button
              key={group.value}
              type="button"
              onClick={() => setActiveStatus(group.value)}
              className="relative flex min-w-[84px] flex-1 flex-col items-center justify-end whitespace-nowrap px-1 pb-3 pt-1 text-[13px] font-medium transition-colors sm:px-2 sm:text-sm"
              style={{ color: activeStatus === group.value ? BLUE : "var(--muted-foreground)" }}
            >
              <span className="mb-0.5 flex h-4 items-center justify-center">
                {group.list.length > 0 ? (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white" style={{ backgroundColor: BLUE }}>
                    {group.list.length}
                  </span>
                ) : <span aria-hidden="true" className="h-4" />}
              </span>
              <span className="leading-5">{group.label}</span>
              {activeStatus === group.value && (
                <span aria-hidden="true" className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ backgroundColor: BLUE }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <main>
        {currentGroup.list.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-9 w-9" />}
            title="Nenhum pedido nesta seção"
            hint={
              term || selectedCustomer !== "all"
                ? "Nenhum pedido corresponde à busca nesta etapa."
                : "Assim que um pedido chegar nesta etapa ele aparece aqui."
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {currentGroup.list.map((o) => (
              <AdminOrderCard
                key={o.id}
                order={o}
                busy={busy === o.id}
                onChange={change}
                onPayOnDelivery={payOnDelivery}
                onRefundInfinite={refundWithInfinitePay}
                onMarkRefunded={markRefunded}
                isInfinitePayPaid={isInfinitePayPaid(o)}
                refunded={refunded(o)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function AdminOrderCard({
  order,
  busy,
  onChange,
  onPayOnDelivery,
  onRefundInfinite,
  onMarkRefunded,
  isInfinitePayPaid,
  refunded,
}: {
  order: Order;
  busy: boolean;
  onChange: (order: Order, status: string) => Promise<void>;
  onPayOnDelivery: (order: Order) => Promise<void>;
  onRefundInfinite: (order: Order) => Promise<void>;
  onMarkRefunded: (order: Order) => Promise<void>;
  isInfinitePayPaid: boolean;
  refunded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const unpaid = order.paymentStatus !== "paid" && order.status !== "canceled" && !refunded;
  const refundText = order.refundState === "money_pending"
    ? "Pedido cancelado · Reembolso pendente de confirmação."
    : null;

  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{new Date(order.createdAt).toLocaleString("pt-BR")}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{displayStatusLabel(order)}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{paymentDisplayLabel(order)}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{order.customerName || "Cliente sem nome"}</p>
            <p className="text-xs text-muted-foreground">{order.customerPhone}</p>
            {order.origin === "store" && (
              <p className="mt-1 inline-block rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-foreground">Pedido feito pelo vendedor da loja</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-medium text-muted-foreground">Total</p>
            <p className="text-xl font-semibold" style={{ color: BLUE }}>{formatPrice(order.total)}</p>
          </div>
        </div>

        {order.status !== "canceled" && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5">
              {["sent", "preparing", "shipping", "delivered"].map((step, index) => {
                const steps = ["sent", "preparing", "shipping", "delivered"];
                const current = Math.max(0, steps.indexOf(order.status));
                return <div key={step} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: index <= current ? GREEN : "var(--muted)" }} />;
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
              <span>Recebido</span><span>Preparando</span><span>A caminho</span><span>Entregue</span>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl bg-muted/50 p-3">
          <p className="mb-2 text-sm font-semibold text-foreground">Produtos do pedido</p>
          <ul className="space-y-3">
            {order.items.map((item, index) => (
              <li key={`${item.id}-${index}`} className="flex items-center gap-3">
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-xl bg-background object-cover" />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-background"><Boxes className="h-6 w-6 text-muted-foreground" /></span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{item.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">Quantidade: <span className="font-semibold text-foreground">{item.qty}</span></p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-foreground">{formatPrice(item.price * item.qty)}</p>
              </li>
            ))}
          </ul>
        </div>

        {order.discount > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm"><span className="text-muted-foreground">{order.couponCode ? `Desconto do cupom ${order.couponCode}` : "Desconto"}</span><span className="font-semibold" style={{ color: GREEN }}>-{formatPrice(order.discount)}</span></div>
        )}
        {(order.sellerDiscount ?? 0) > 0 && (
          <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">Desconto do vendedor</span><span className="font-semibold" style={{ color: GREEN }}>-{formatPrice(order.sellerDiscount ?? 0)}</span></div>
        )}
        {(order.coinsDiscount ?? 0) > 0 && (
          <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">Moedas usadas ({(order.coinsUsed ?? 0).toLocaleString("pt-BR")})</span><span className="font-semibold" style={{ color: GREEN }}>-{formatPrice(order.coinsDiscount ?? 0)}</span></div>
        )}

        {unpaid && order.paymentDeadlineAt && (
          <div className="mt-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-foreground dark:bg-blue-950/30"><span className="font-semibold">Pagamento pendente.</span> Aguardando pagamento.</div>
        )}
        {refundText && <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-900/40 dark:bg-orange-950/20"><p className="text-sm font-medium leading-5 text-foreground">{refundText}</p></div>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={order.status}
            disabled={busy}
            onChange={(e) => void onChange(order, e.target.value)}
            aria-label={`Status do pedido de ${order.customerName}`}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground"
          >
            <option value="sent">Recebido</option>
            <option value="preparing">Preparando</option>
            <option value="shipping">A caminho</option>
            <option value="delivered">Entregue</option>
            <option value="canceled">Cancelado</option>
          </select>

          {order.paymentStatus !== "paid" && order.status !== "canceled" && (
            <button type="button" disabled={busy} onClick={() => void onPayOnDelivery(order)} className="rounded-xl px-3 py-2 text-sm font-black text-white" style={{ backgroundColor: GREEN }}>Pagamento na entrega</button>
          )}

          {(order.paymentStatus === "paid" || refunded) && <ReceiptDownload orderId={order.id} phone={order.customerPhone} showWhatsApp />}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span>{statusLabel(order.status)} · {paymentDisplayLabel(order)}</span>
          {order.refundState === "refunded" && <span style={{ color: GREEN }}>✅ Reembolso realizado</span>}
          {order.refundProofUrl && <a href={order.refundProofUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: GREEN }}>Comprovante do reembolso</a>}
          {order.receiptUrl && <a href={order.receiptUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: BLUE }}>Comprovante do pagamento</a>}
        </div>

        {order.status === "canceled" && order.refundState !== "refunded" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3">
            <span className="text-sm font-black" style={{ color: "oklch(0.72 0.17 62)" }}>Reembolso pendente de confirmação</span>
            {isInfinitePayPaid ? (
              <button type="button" disabled={busy} onClick={() => void onRefundInfinite(order)} className="rounded-xl px-3 py-2 text-sm font-black text-white" style={{ backgroundColor: BLUE }}>💳 Devolver dinheiro com InfinitePay</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void onMarkRefunded(order)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-black text-foreground">Confirmar reembolso</button>
            )}
          </div>
        )}

        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-foreground">
          <span>{open ? "Ocultar detalhes" : "Ver detalhes do pedido"}</span>
          <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-sm font-semibold text-foreground">Pedido nº {order.id.slice(0, 8).toUpperCase()}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{displayStatusLabel(order)} · {paymentDisplayLabel(order)}</p>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">Cliente: <span className="font-semibold text-foreground">{order.customerName || "Sem nome"}</span> · {order.customerPhone}</p>
          </div>
        )}
      </div>
    </li>
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


function FeaturedPanel() {
  const [section, setSection] = useState<FeaturedSection>("featured");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const catalog = useQuery({
    queryKey: ["admin", "catalog"],
    queryFn: () => fetchCatalog(),
    staleTime: 5 * 60 * 1000,
  });
  const featured = useQuery({
    queryKey: ["admin", "featured"],
    queryFn: fetchFeatured,
    staleTime: 30 * 1000,
  });

  const products: CatalogProduct[] = catalog.data?.products ?? [];
  const chosen = (featured.data ?? []).filter((f) => f.section === section);
  const chosenKeys = new Set(chosen.map((f) => f.productKey));

  const term = search.trim().toLowerCase();
  const results = term
    ? products.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 20)
    : [];

  async function add(p: CatalogProduct) {
    setBusy(true);
    await addFeatured(p.id, section, chosen.length);
    await featured.refetch();
    setBusy(false);
    setSearch("");
  }

  async function remove(id: string) {
    setBusy(true);
    await removeFeatured(id);
    await featured.refetch();
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {FEATURED_SECTIONS.map((s) => {
          const active = s.value === section;
          return (
            <button
              key={s.value}
              onClick={() => setSection(s.value)}
              className="rounded-2xl border-2 px-2 py-3 text-sm font-black active:scale-95"
              style={{
                borderColor: active ? BLUE : "var(--border)",
                backgroundColor: active ? BLUE : "var(--card)",
                color: active ? "#fff" : "var(--foreground)",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <p className="text-base font-semibold text-muted-foreground">
        Sem escolha manual, a vitrine mostra automaticamente os produtos mais vendidos.
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Procurar produto para destacar"
        className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
      />

      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-2xl border-2 border-border bg-card p-3"
            >
              <span className="min-w-0 flex-1 text-base font-bold text-foreground">
                {p.name}
              </span>
              <button
                disabled={busy || chosenKeys.has(p.id)}
                onClick={() => void add(p)}
                className="rounded-xl px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                style={{ backgroundColor: GREEN }}
              >
                {chosenKeys.has(p.id) ? "Já está" : "Destacar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-xl font-black text-foreground">
        {sectionLabel(section)} · {chosen.length}
      </h2>
      {chosen.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border p-5 text-center text-base font-semibold text-muted-foreground">
          Nenhum produto escolhido nesta seção.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {chosen.map((f) => {
            const p = products.find((x) => x.id === f.productKey);
            return (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-2xl border-2 border-border bg-card p-3"
              >
                <span className="min-w-0 flex-1 text-base font-bold text-foreground">
                  {p?.name ?? f.productKey}
                </span>
                <button
                  disabled={busy}
                  onClick={() => void remove(f.id)}
                  className="grid h-10 w-10 place-items-center rounded-xl text-white disabled:opacity-50"
                  style={{ backgroundColor: RED }}
                  aria-label="Remover destaque"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
