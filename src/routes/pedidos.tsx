import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, ChevronRight } from "lucide-react";
import { BackButton } from "@/components/back-button";
import { useProfile } from "@/lib/coupons";

import { useServerFn } from "@tanstack/react-start";
import { createOrderCheckout } from "@/lib/payments.functions";
import { runLoyverseQuickSync } from "@/lib/loyverse-reconcile.functions";
import { formatPrice } from "@/lib/cart";
import {
  fetchMyOrders,
  fetchOrderTimeline,
  statusLabel,
  displayStatusLabel,
  paymentLabel,
  type Order,
} from "@/lib/orders";

const STATUSES = ["topay", "preparing", "shipping", "delivered", "canceled"] as const;

export const Route = createFileRoute("/pedidos")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => {
    const raw = String(search["status"] ?? "topay");
    const status = (STATUSES as readonly string[]).includes(raw)
      ? (raw as (typeof STATUSES)[number])
      : ("topay" as const);
    const checkout = String(search["checkout"] ?? "") === "1";
    return checkout ? { status, checkout: true as const } : { status };
  },

  head: () => ({
    meta: [
      { title: "Meus pedidos — SPERB" },
      {
        name: "description",
        content: "Acompanhe seus pedidos SPERB: pagamento, preparação, entrega e valores.",
      },
      { property: "og:title", content: "Meus pedidos — SPERB" },
      {
        property: "og:description",
        content: "Acompanhe seus pedidos SPERB do pagamento até a entrega.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PedidosPage,
});

const BLUE = "oklch(0.55 0.22 255)";
const GREEN = "oklch(0.62 0.19 145)";

const STEPS = ["sent", "preparing", "shipping", "delivered"] as const;

function Progress({ status, refunded }: { status: string; refunded?: boolean }) {
  if (status === "canceled" || refunded) {
    return (
      <p className="mt-2 text-base font-black text-muted-foreground">
        {refunded ? "Pedido reembolsado e cancelado" : "Pedido cancelado"}
      </p>
    );
  }
  const current = Math.max(0, STEPS.indexOf(status as (typeof STEPS)[number]));
  return (
    <ol className="mt-3 flex items-center gap-1">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col items-center gap-1">
          <span
            className="h-2 w-full rounded-full"
            style={{ backgroundColor: i <= current ? GREEN : "var(--muted)" }}
          />
          <span
            className={`text-center text-[11px] font-bold leading-tight ${
              i <= current ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {statusLabel(s)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function OrderCard({ order, phone }: { order: Order; phone: string }) {
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const startCheckout = useServerFn(createOrderCheckout);
  const refunded = order.paymentStatus === "refunded";
  const unpaid =
    order.paymentStatus !== "paid" && order.status !== "canceled" && !refunded;

  async function pagar() {
    if (paying) return;
    setPaying(true);
    try {
      const res = await startCheckout({ data: { orderId: order.id } });
      if (res.url) window.location.href = res.url;
    } finally {
      setPaying(false);
    }
  }

  const timeline = useQuery({
    queryKey: ["order-timeline", order.id],
    queryFn: () => fetchOrderTimeline(order.id, phone),
    enabled: open,
    staleTime: 30 * 1000,
  });

  return (
    <li className="rounded-3xl border-2 border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-muted-foreground">
            {new Date(order.createdAt).toLocaleString("pt-BR")}
          </p>
          <p className="text-lg font-black text-foreground">{displayStatusLabel(order)}</p>
          <p className="text-base font-semibold text-muted-foreground">
            {paymentLabel(order.paymentStatus)}
          </p>
        </div>
        <span className="shrink-0 text-2xl font-black" style={{ color: BLUE }}>
          {formatPrice(order.total)}
        </span>
      </div>

      <Progress status={order.status} refunded={refunded} />

      <ul className="mt-3 flex flex-col gap-2">
        {order.items.map((it, i) => (
          <li key={i} className="flex items-center gap-3">
            {it.image ? (
              <img
                src={it.image}
                alt={it.name}
                loading="lazy"
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted">
                <Package className="h-6 w-6 text-muted-foreground" />
              </span>
            )}
            <span className="min-w-0 flex-1 text-base font-semibold text-foreground">
              {it.qty}x {it.name}
            </span>
            <span className="shrink-0 text-base font-black text-foreground">
              {formatPrice(it.price * it.qty)}
            </span>
          </li>
        ))}
      </ul>

      {order.discount > 0 && (
        <p className="mt-2 text-base font-bold" style={{ color: GREEN }}>
          Cupom {order.couponCode} · -{formatPrice(order.discount)}
        </p>
      )}

      {unpaid && (
        <button
          onClick={() => void pagar()}
          disabled={paying}
          className="mt-3 w-full rounded-2xl px-4 py-3 text-lg font-black text-white disabled:opacity-60 active:scale-[0.98]"
          style={{ backgroundColor: BLUE }}
        >
          {paying ? "Abrindo pagamento…" : `Pagar ${formatPrice(order.total)} · Pix ou cartão`}
        </button>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 rounded-xl bg-muted px-3 py-2 text-base font-black text-foreground"
      >
        {open ? "Ocultar detalhes" : "Ver detalhes"}
        <ChevronRight className={`h-5 w-5 ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <ul className="mt-3 flex flex-col gap-2 border-t-2 border-border pt-3">
          {(timeline.data ?? []).map((t, i) => (
            <li key={i} className="text-base text-muted-foreground">
              <span className="font-black text-foreground">{statusLabel(t.status)}</span> ·{" "}
              {new Date(t.createdAt).toLocaleString("pt-BR")}
              {t.note && ` — ${t.note}`}
            </li>
          ))}
          {timeline.data?.length === 0 && (
            <li className="text-base text-muted-foreground">Sem atualizações ainda.</li>
          )}
        </ul>
      )}
    </li>
  );
}

const SECTIONS = [
  { value: "topay", label: "A pagar" },
  { value: "preparing", label: "Preparando" },
  { value: "shipping", label: "A caminho" },
  { value: "delivered", label: "Entregue" },
  { value: "canceled", label: "Cancelado" },
] as const;

type StatusValue = (typeof SECTIONS)[number]["value"];

function PedidosPage() {
  const profile = useProfile();
  const { status, checkout } = Route.useSearch();
  const [lastOrderId, setLastOrderId] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setLastOrderId(window.localStorage.getItem("sperb-last-order") ?? "");
    }
  }, []);
  const navigate = Route.useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-orders", profile.phone],
    queryFn: () => fetchMyOrders(profile.phone),
    staleTime: 30 * 1000,
    // Voltando do pagamento, acompanha até o pedido entrar em "Preparando".
    refetchInterval: checkout ? 5000 : false,
  });

  // Abrir "Meus pedidos" busca reembolsos e recibos recentes no Loyverse,
  // para o pedido reembolsado já aparecer cancelado sem esperar nada.
  const quickSync = useServerFn(runLoyverseQuickSync);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await quickSync({});
        if (alive && res.ok && (res.refundsApplied > 0 || res.resynced > 0)) {
          void refetch();
        }
      } catch {
        /* sincronização é apenas complementar ao webhook */
      }
    })();
    return () => {
      alive = false;
    };
  }, [quickSync, refetch]);

  const orders = data ?? [];
  const lastOrder = orders.find((o) => o.id === lastOrderId);

  // Pagamento confirmado → o cliente vai direto para "Preparando".
  useEffect(() => {
    if (checkout && lastOrder?.paymentStatus === "paid" && status !== "preparing") {
      void navigate({ search: { status: "preparing" }, replace: true });
    }
  }, [checkout, lastOrder?.paymentStatus, status, navigate]);

  function bucket(o: Order): StatusValue {
    // Reembolsado no Loyverse entra junto dos cancelados.
    if (o.status === "canceled" || o.paymentStatus === "refunded") return "canceled";
    if (o.status === "delivered") return "delivered";
    if (o.paymentStatus !== "paid") return "topay";
    if (o.status === "shipping") return "shipping";
    return "preparing";
  }
  const groups = SECTIONS.map((s) => ({
    ...s,
    list: orders.filter((o) => bucket(o) === s.value),
  }));

  const activeIndex = Math.max(0, SECTIONS.findIndex((s) => s.value === status));
  const trackRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Enquanto o painel está sendo movido pelo toque na aba, o scroll é nosso:
  // não deixamos o "arraste" recalcular a aba no meio da animação.
  const lockedRef = useRef(false);

  function lockScroll() {
    lockedRef.current = true;
    if (lockRef.current) clearTimeout(lockRef.current);
    lockRef.current = setTimeout(() => {
      lockedRef.current = false;
    }, 600);
  }

  // Mantém o painel visível igual à aba escolhida (sem brigar com o dedo).
  useEffect(() => {
    const el = trackRef.current;
    if (!el || lockedRef.current) return;
    const target = activeIndex * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 4) {
      lockScroll();
      el.scrollTo({ left: target, behavior: "smooth" });
    }
  }, [activeIndex]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [status]);

  useEffect(() => () => {
    if (settleRef.current) clearTimeout(settleRef.current);
    if (lockRef.current) clearTimeout(lockRef.current);
  }, []);

  function setStatus(next: StatusValue) {
    void navigate({ search: { status: next }, replace: true });
  }

  /** Toque numa aba: 1 clique já leva direto para a seção certa. */
  function goTo(next: StatusValue) {
    const el = trackRef.current;
    lockScroll();
    setStatus(next);
    if (el) {
      const idx = Math.max(0, SECTIONS.findIndex((s) => s.value === next));
      // Salto imediato: com animação, o "arraste" recalculava a aba no meio
      // do caminho e voltava para o status anterior (daí os 2 cliques).
      el.scrollTo({ left: idx * el.clientWidth, behavior: "auto" });
    }
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }


  // Ao arrastar para o lado (estilo Shopee): só troca quando o deslize para,
  // e sempre uma etapa por vez, mesmo se o dedo passar voando.
  function onScroll() {
    if (lockedRef.current) return;
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const el = trackRef.current;
      if (!el || el.clientWidth === 0 || lockedRef.current) return;
      const raw = Math.min(
        SECTIONS.length - 1,
        Math.max(0, Math.round(el.scrollLeft / el.clientWidth)),
      );
      // Nunca pula mais de uma seção por deslize.
      const idx = Math.max(activeIndex - 1, Math.min(activeIndex + 1, raw));
      const nextValue = SECTIONS[idx]?.value;
      if (!nextValue) return;
      if (idx !== raw) {
        lockScroll();
        el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
      }
      if (nextValue !== status) setStatus(nextValue);
    }, 160);
  }


  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <BackButton fallback="/eu" />

          <h1 className="text-2xl font-black text-foreground">Meus pedidos</h1>
        </div>

        {/* Abas estilo Shopee: toque para trocar, ou arraste o conteúdo. */}
        <div
          className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2 pb-1"
          style={{ scrollbarWidth: "none" }}
        >
          {groups.map((g) => {
            const active = g.value === status;
            return (
              <button
                key={g.value}
                ref={active ? activeTabRef : undefined}
                onClick={() => goTo(g.value)}
                className="relative shrink-0 px-3 pb-2 pt-1 text-base font-black transition-colors active:scale-95"
                style={{ color: active ? BLUE : "var(--muted-foreground)" }}
              >
                {g.label}
                {g.list.length > 0 && ` (${g.list.length})`}
                <span
                  className="absolute inset-x-2 bottom-0 h-1 rounded-full transition-opacity"
                  style={{ backgroundColor: BLUE, opacity: active ? 1 : 0 }}
                />
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto max-w-3xl pt-4">
        {checkout && lastOrder && (
          <div className="mx-4 mb-4 rounded-2xl border-2 border-[oklch(0.62_0.19_145)] bg-[oklch(0.62_0.19_145)]/10 p-4">
            <p className="text-lg font-black text-foreground">
              Pedido nº {lastOrder.id.slice(0, 8).toUpperCase()}
            </p>
            <p className="text-base font-bold text-muted-foreground">
              {displayStatusLabel(lastOrder)} · {paymentLabel(lastOrder.paymentStatus)}
            </p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              Assim que o pagamento for confirmado, o pedido entra em preparação
              automaticamente.
            </p>
          </div>
        )}
        {isLoading && (
          <p className="px-4 text-lg font-semibold text-muted-foreground">Carregando…</p>
        )}

        {!isLoading && orders.length === 0 && (
          <div className="mx-4 rounded-3xl border-2 border-dashed border-border p-8 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-3 text-lg font-bold text-foreground">
              Você ainda não fez pedidos.
            </p>
            <Link
              to="/"
              className="mt-4 inline-block rounded-2xl px-5 py-3 text-lg font-black text-white"
              style={{ backgroundColor: BLUE }}
            >
              Ver produtos
            </Link>
          </div>
        )}

        {!isLoading && orders.length > 0 && (
          <div
            ref={trackRef}
            onScroll={onScroll}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none" }}
          >
            {groups.map((g) => (
              <section key={g.value} className="w-full shrink-0 snap-center px-4">
                <h2 className="mb-2 flex items-center gap-2 text-xl font-black text-foreground">
                  {g.label}
                  <span
                    className="rounded-full px-2.5 py-0.5 text-sm font-black text-white"
                    style={{
                      backgroundColor:
                        g.value === "canceled" ? "var(--muted-foreground)" : BLUE,
                    }}
                  >
                    {g.list.length}
                  </span>
                </h2>
                {g.list.length === 0 ? (
                  <p className="rounded-3xl border-2 border-dashed border-border p-6 text-center text-base font-semibold text-muted-foreground">
                    Nenhum pedido em “{g.label}”. Arraste para o lado para ver outras
                    seções.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {g.list.map((o) => (
                      <OrderCard key={o.id} order={o} phone={profile.phone} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

