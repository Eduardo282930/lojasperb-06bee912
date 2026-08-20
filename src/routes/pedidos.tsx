import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, ChevronRight } from "lucide-react";
import { useProfile } from "@/lib/coupons";
import { formatPrice } from "@/lib/cart";
import {
  fetchMyOrders,
  fetchOrderTimeline,
  statusLabel,
  paymentLabel,
  type Order,
} from "@/lib/orders";

export const Route = createFileRoute("/pedidos")({
  ssr: false,
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

function Progress({ status }: { status: string }) {
  if (status === "canceled") {
    return (
      <p className="mt-2 text-base font-black text-muted-foreground">Pedido cancelado</p>
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
          <p className="text-lg font-black text-foreground">{statusLabel(order.status)}</p>
          <p className="text-base font-semibold text-muted-foreground">
            {paymentLabel(order.paymentStatus)}
          </p>
        </div>
        <span className="shrink-0 text-2xl font-black" style={{ color: BLUE }}>
          {formatPrice(order.total)}
        </span>
      </div>

      <Progress status={order.status} />

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

function PedidosPage() {
  const profile = useProfile();
  const { data, isLoading } = useQuery({
    queryKey: ["my-orders", profile.phone],
    queryFn: () => fetchMyOrders(profile.phone),
    staleTime: 30 * 1000,
  });

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
          <h1 className="text-2xl font-black text-foreground">Meus pedidos</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {isLoading && (
          <p className="text-lg font-semibold text-muted-foreground">Carregando…</p>
        )}
        {!isLoading && (data ?? []).length === 0 && (
          <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
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
        <ul className="flex flex-col gap-4">
          {(data ?? []).map((o) => (
            <OrderCard key={o.id} order={o} phone={profile.phone} />
          ))}
        </ul>
      </main>
    </div>
  );
}
