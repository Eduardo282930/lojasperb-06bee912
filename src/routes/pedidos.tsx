import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  ChevronRight,
  Check,
  Clock3,
  Truck,
  XCircle,
  CreditCard,
  RotateCcw,
} from "lucide-react";
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
  paymentDisplayLabel,
  minutesLeftToPay,
  cancelExpiredUnpaidOrders,
  type Order,
} from "@/lib/orders";

const STATUSES = [
  "topay",
  "preparing",
  "shipping",
  "delivered",
  "refund",
  "canceled",
] as const;

type StatusValue = (typeof STATUSES)[number];

const SECTIONS: {
  value: StatusValue;
  label: string;
}[] = [
  { value: "topay", label: "A pagar" },
  { value: "preparing", label: "Preparando" },
  { value: "shipping", label: "A caminho" },
  { value: "delivered", label: "Finalizado" },
  { value: "refund", label: "Reembolso" },
  { value: "canceled", label: "Cancelado" },
];

export const Route = createFileRoute("/pedidos")({
  ssr: false,

  validateSearch: (search: Record<string, unknown>) => {
    const raw = String(search["status"] ?? "topay");

    const status = (STATUSES as readonly string[]).includes(raw)
      ? (raw as StatusValue)
      : "topay";

    const checkout = String(search["checkout"] ?? "") === "1";

    return checkout
      ? { status, checkout: true as const }
      : { status };
  },

  head: () => ({
    meta: [
      { title: "Minhas compras — SPERB" },
      {
        name: "description",
        content:
          "Acompanhe suas compras SPERB, pagamentos, preparação, entrega e reembolsos.",
      },
    ],
  }),

  component: PedidosPage,
});

const BRAND = "oklch(0.55 0.22 255)";
const SUCCESS = "oklch(0.62 0.19 145)";
const WARNING = "oklch(0.72 0.16 75)";
const DANGER = "oklch(0.60 0.20 25)";

const STEPS = ["sent", "preparing", "shipping", "delivered"] as const;

function Progress({
  status,
  refunded,
}: {
  status: string;
  refunded?: boolean;
}) {
  if (status === "canceled" || refunded) {
    return (
      <div className="mt-4 rounded-2xl bg-muted/70 px-4 py-3">
        <div className="flex items-center gap-2">
          {refunded ? (
            <RotateCcw className="h-5 w-5" style={{ color: SUCCESS }} />
          ) : (
            <XCircle className="h-5 w-5" style={{ color: DANGER }} />
          )}

          <span className="text-sm font-medium text-foreground">
            {refunded
              ? "Pedido cancelado e reembolso concluído"
              : "Pedido cancelado"}
          </span>
        </div>
      </div>
    );
  }

  const current = Math.max(
    0,
    STEPS.indexOf(status as (typeof STEPS)[number]),
  );

  return (
    <div className="mt-5">
      <div className="flex items-center">
        {STEPS.map((step, index) => {
          const active = index <= current;

          return (
            <div
              key={step}
              className="flex flex-1 items-center"
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2"
                style={{
                  borderColor: active ? SUCCESS : "var(--border)",
                  backgroundColor: active ? SUCCESS : "var(--background)",
                }}
              >
                {active ? (
                  <Check className="h-4 w-4 text-white" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                )}
              </div>

              {index < STEPS.length - 1 && (
                <div
                  className="h-[2px] flex-1"
                  style={{
                    backgroundColor:
                      index < current
                        ? SUCCESS
                        : "var(--border)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between">
        {STEPS.map((step, index) => (
          <span
            key={step}
            className={`text-[11px] ${
              index <= current
                ? "font-medium text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {statusLabel(step)
              .replace("Pedido ", "")
              .replace("Em ", "")}
          </span>
        ))}
      </div>
    </div>
  );
}

function getRefundType(order: Order): "infinitepay" | "whatsapp" | "other" {
  const provider = String(order.paymentProvider ?? "").toLowerCase();
  const method = String(order.paymentMethod ?? "").toLowerCase();

  if (
    provider.includes("infinite") ||
    provider.includes("infinitepay")
  ) {
    return "infinitepay";
  }

  if (
    provider.includes("whatsapp") ||
    method.includes("whatsapp") ||
    method.includes("manual")
  ) {
    return "whatsapp";
  }

  return "other";
}

function RefundMessage({ order }: { order: Order }) {
  const refundState = order.refundState ?? "none";

  if (refundState === "refunded") {
    return (
      <div className="mt-4 rounded-2xl bg-emerald-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <RotateCcw
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ color: SUCCESS }}
          />

          <div>
            <p className="text-sm font-medium text-foreground">
              Reembolso confirmado
            </p>

            <p className="mt-1 text-sm text-muted-foreground">
              O reembolso deste pedido já foi processado.
            </p>

            {order.refundProofUrl && (
              <a
                href={order.refundProofUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-medium underline"
                style={{ color: BRAND }}
              >
                Ver comprovante
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (
    refundState === "money_pending" ||
    order.status === "canceled"
  ) {
    const type = getRefundType(order);

    if (type === "infinitepay") {
      return (
        <div className="mt-4 rounded-2xl bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <Clock3
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: WARNING }}
            />

            <div>
              <p className="text-sm font-medium text-foreground">
                Reembolso aguardando processamento
              </p>

              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Seu pedido foi cancelado. O reembolso do pagamento
                realizado pelo InfinitePay está sendo processado.
                <strong className="font-medium text-foreground">
                  {" "}
                  Em algumas horas você receberá o reembolso.
                </strong>
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (type === "whatsapp") {
      return (
        <div className="mt-4 rounded-2xl bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <Clock3
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: WARNING }}
            />

            <div>
              <p className="text-sm font-medium text-foreground">
                Reembolso em processamento
              </p>

              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Seu pedido foi cancelado. Como o pagamento não foi
                realizado pelo InfinitePay, o reembolso será tratado
                diretamente pela SPERB.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-4 rounded-2xl bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <Clock3
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ color: WARNING }}
          />

          <div>
            <p className="text-sm font-medium text-foreground">
              Reembolso em processamento
            </p>

            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Seu pedido foi cancelado e o reembolso está sendo
              processado. Em algumas horas você receberá uma
              atualização.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function OrderCard({
  order,
  phone,
}: {
  order: Order;
  phone: string;
}) {
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  const startCheckout = useServerFn(createOrderCheckout);

  const refunded = order.paymentStatus === "refunded";

  const unpaid =
    order.paymentStatus !== "paid" &&
    order.status !== "canceled" &&
    !refunded;

  const [minutesLeft, setMinutesLeft] = useState(() =>
    minutesLeftToPay(order),
  );

  useEffect(() => {
    setMinutesLeft(minutesLeftToPay(order));

    const timer = setInterval(() => {
      setMinutesLeft(minutesLeftToPay(order));
    }, 30000);

    return () => clearInterval(timer);
  }, [order]);

  async function pagar() {
    if (paying) return;

    setPaying(true);

    try {
      const res = await startCheckout({
        data: {
          orderId: order.id,
        },
      });

      if (res.url) {
        window.location.href = res.url;
      }
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

  const hasRefund =
    order.refundState === "money_pending" ||
    order.refundState === "refunded" ||
    order.paymentStatus === "refunded";

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {/* Cabeçalho do pedido */}
      <div className="px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Pedido em{" "}
              {new Date(order.createdAt).toLocaleDateString("pt-BR")}
            </p>

            <h3 className="mt-1 text-base font-medium text-foreground">
              {displayStatusLabel(order)}
            </h3>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-lg font-medium text-foreground">
              {formatPrice(order.total)}
            </p>

            <p className="mt-0.5 text-xs text-muted-foreground">
              {paymentDisplayLabel(order)}
            </p>
          </div>
        </div>
      </div>

      {/* Produtos */}
      <div className="mt-4 divide-y divide-border border-y border-border">
        {order.items.map((item, index) => (
          <div
            key={`${item.id}-${index}`}
            className="flex items-center gap-3 px-4 py-3"
          >
            {item.image ? (
              <img
                src={item.image}
                alt={item.name}
                loading="lazy"
                className="h-16 w-16 shrink-0 rounded-2xl border border-border object-cover"
              />
            ) : (
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-muted">
                <Package className="h-7 w-7 text-muted-foreground" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">
                {item.name}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Quantidade: {item.qty}
              </p>
            </div>

            <p className="shrink-0 text-sm font-medium text-foreground">
              {formatPrice(item.price * item.qty)}
            </p>
          </div>
        ))}
      </div>

      {/* Desconto */}
      {order.discount > 0 && (
        <div className="px-4 pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Desconto
              {order.couponCode
                ? ` · ${order.couponCode}`
                : ""}
            </span>

            <span
              className="font-medium"
              style={{ color: SUCCESS }}
            >
              -{formatPrice(order.discount)}
            </span>
          </div>
        </div>
      )}

      {/* Total */}
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-sm text-muted-foreground">
          Total da compra
        </span>

        <span className="text-base font-medium text-foreground">
          {formatPrice(order.total)}
        </span>
      </div>

      {/* Progresso */}
      <div className="px-4">
        <Progress
          status={order.status}
          refunded={refunded}
        />
      </div>

      {/* Prazo de pagamento */}
      {unpaid && minutesLeft > 0 && (
        <div className="mx-4 mt-4 rounded-2xl bg-blue-500/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <Clock3
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: BRAND }}
            />

            <div>
              <p className="text-sm font-medium text-foreground">
                Pagamento aguardando
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Seu pedido fica reservado por mais{" "}
                <strong className="font-medium text-foreground">
                  {minutesLeft}{" "}
                  {minutesLeft === 1
                    ? "minuto"
                    : "minutos"}
                </strong>
                .
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reembolso */}
      {hasRefund && <RefundMessage order={order} />}

      {/* Ações */}
      <div className="flex gap-2 px-4 pb-4 pt-4">
        {unpaid ? (
          <button
            type="button"
            onClick={() => void pagar()}
            disabled={paying}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
            style={{ backgroundColor: BRAND }}
          >
            <CreditCard className="h-5 w-5" />

            {paying
              ? "Abrindo pagamento..."
              : "Pagar agora"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition active:scale-[0.98] ${
            unpaid ? "flex-1" : "w-full"
          }`}
        >
          {open ? "Ocultar detalhes" : "Ver detalhes"}

          <ChevronRight
            className={`h-5 w-5 transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
        </button>
      </div>

      {/* Detalhes */}
      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                Número do pedido
              </span>

              <span className="text-sm font-medium text-foreground">
                #{order.id.slice(0, 8).toUpperCase()}
              </span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                Data
              </span>

              <span className="text-sm text-foreground">
                {new Date(order.createdAt).toLocaleString(
                  "pt-BR",
                )}
              </span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                Forma de pagamento
              </span>

              <span className="text-sm font-medium text-foreground">
                {paymentDisplayLabel(order)}
              </span>
            </div>

            {order.subtotal !== order.total && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">
                  Subtotal
                </span>

                <span className="text-sm text-foreground">
                  {formatPrice(order.subtotal)}
                </span>
              </div>
            )}

            {order.discount > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">
                  Desconto
                </span>

                <span
                  className="text-sm font-medium"
                  style={{ color: SUCCESS }}
                >
                  -{formatPrice(order.discount)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-3 flex items-center gap-2">
              <Truck className="h-5 w-5 text-muted-foreground" />

              <h4 className="text-sm font-medium text-foreground">
                Atualizações do pedido
              </h4>
            </div>

            {timeline.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Carregando atualizações...
              </p>
            ) : timeline.data?.length ? (
              <div className="space-y-3">
                {timeline.data.map((entry, index) => (
                  <div
                    key={`${entry.createdAt}-${index}`}
                    className="flex gap-3"
                  >
                    <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground" />

                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {statusLabel(entry.status)}
                      </p>

                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(
                          entry.createdAt,
                        ).toLocaleString("pt-BR")}
                      </p>

                      {entry.note && (
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {entry.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma atualização adicional ainda.
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function PedidosPage() {
  const profile = useProfile();
  const { status, checkout } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [lastOrderId, setLastOrderId] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLastOrderId(
        window.localStorage.getItem("sperb-last-order") ?? "",
      );
    }
  }, []);

  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["my-orders", profile.phone],
    queryFn: () => fetchMyOrders(profile.phone),
    staleTime: 30 * 1000,
    refetchInterval: checkout ? 5000 : false,
  });

  const quickSync = useServerFn(runLoyverseQuickSync);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const expired =
          await cancelExpiredUnpaidOrders();

        const result = await quickSync({});

        if (
          alive &&
          (
            expired > 0 ||
            (
              result.ok &&
              (
                result.refundsApplied > 0 ||
                result.resynced > 0
              )
            )
          )
        ) {
          void refetch();
        }
      } catch {
        // O webhook continua sendo a sincronização principal.
      }
    })();

    return () => {
      alive = false;
    };
  }, [quickSync, refetch]);

  const orders = data ?? [];

  const lastOrder = orders.find(
    (order) => order.id === lastOrderId,
  );

  useEffect(() => {
    if (
      checkout &&
      lastOrder?.paymentStatus === "paid" &&
      status !== "preparing"
    ) {
      void navigate({
        search: {
          status: "preparing",
        },
        replace: true,
      });
    }
  }, [
    checkout,
    lastOrder?.paymentStatus,
    status,
    navigate,
  ]);

  function bucket(order: Order): StatusValue {
    /*
     * REEMBOLSO:
     * Cancelamento com dinheiro a devolver fica em
     * "Reembolso" enquanto o dinheiro estiver pendente.
     *
     * Depois que o reembolso for concluído, continua em
     * "Reembolso" para o cliente encontrar facilmente
     * o histórico do reembolso.
     */
    if (
      order.refundState === "money_pending" ||
      order.refundState === "refunded"
    ) {
      return "refund";
    }

    if (
      order.paymentStatus === "refunded"
    ) {
      return "refund";
    }

    if (order.status === "canceled") {
      return "canceled";
    }

    if (order.status === "delivered") {
      return "delivered";
    }

    if (order.paymentStatus !== "paid") {
      return "topay";
    }

    if (order.status === "shipping") {
      return "shipping";
    }

    return "preparing";
  }

  const groups = SECTIONS.map((section) => ({
    ...section,
    list: orders.filter(
      (order) => bucket(order) === section.value,
    ),
  }));

  const activeIndex = Math.max(
    0,
    SECTIONS.findIndex(
      (section) => section.value === status,
    ),
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const activeTabRef =
    useRef<HTMLButtonElement>(null);

  const settleRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const lockRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const lockedRef = useRef(false);

  function lockScroll() {
    lockedRef.current = true;

    if (lockRef.current) {
      clearTimeout(lockRef.current);
    }

    lockRef.current = setTimeout(() => {
      lockedRef.current = false;
    }, 500);
  }

  useEffect(() => {
    const element = trackRef.current;

    if (!element || lockedRef.current) {
      return;
    }

    const target =
      activeIndex * element.clientWidth;

    if (
      Math.abs(element.scrollLeft - target) > 4
    ) {
      lockScroll();

      element.scrollTo({
        left: target,
        behavior: "auto",
      });
    }
  }, [activeIndex]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [status]);

  useEffect(() => {
    return () => {
      if (settleRef.current) {
        clearTimeout(settleRef.current);
      }

      if (lockRef.current) {
        clearTimeout(lockRef.current);
      }
    };
  }, []);

  function setStatus(next: StatusValue) {
    void navigate({
      search: {
        status: next,
      },
      replace: true,
    });
  }

  /*
   * Um toque:
   * a aba muda imediatamente e o conteúdo acompanha
   * sem animação que possa causar o problema de dois toques.
   */
  function goTo(next: StatusValue) {
    const element = trackRef.current;

    lockScroll();
    setStatus(next);

    if (element) {
      const index = Math.max(
        0,
        SECTIONS.findIndex(
          (section) => section.value === next,
        ),
      );

      element.scrollTo({
        left: index * element.clientWidth,
        behavior: "auto",
      });
    }

    if (typeof window !== "undefined") {
      window.scrollTo({
        top: 0,
        behavior: "auto",
      });
    }
  }

  /*
   * Arrastar lateral:
   * uma etapa por gesto, sem pular várias abas.
   */
  function onScroll() {
    if (lockedRef.current) {
      return;
    }

    if (settleRef.current) {
      clearTimeout(settleRef.current);
    }

    settleRef.current = setTimeout(() => {
      const element = trackRef.current;

      if (
        !element ||
        element.clientWidth === 0 ||
        lockedRef.current
      ) {
        return;
      }

      const raw = Math.min(
        SECTIONS.length - 1,
        Math.max(
          0,
          Math.round(
            element.scrollLeft /
              element.clientWidth,
          ),
        ),
      );

      const index = Math.max(
        activeIndex - 1,
        Math.min(activeIndex + 1, raw),
      );

      const next =
        SECTIONS[index]?.value;

      if (!next) {
        return;
      }

      if (index !== raw) {
        lockScroll();

        element.scrollTo({
          left: index * element.clientWidth,
          behavior: "auto",
        });
      }

      if (next !== status) {
        setStatus(next);
      }
    }, 120);
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Cabeçalho */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <BackButton fallback="/eu" />

          <h1 className="text-xl font-medium tracking-tight text-foreground">
            Minhas compras
          </h1>
        </div>

        {/* Abas */}
        <div
          className="mx-auto max-w-3xl overflow-x-auto"
          style={{
            scrollbarWidth: "none",
          }}
        >
          <div className="flex min-w-max px-3">
            {groups.map((group) => {
              const active =
                group.value === status;

              return (
                <button
                  key={group.value}
                  ref={
                    active
                      ? activeTabRef
                      : undefined
                  }
                  type="button"
                  onClick={() =>
                    goTo(group.value)
                  }
                  className="relative min-h-12 shrink-0 px-3 text-sm transition-colors active:scale-[0.98]"
                  style={{
                    color: active
                      ? BRAND
                      : "var(--muted-foreground)",
                  }}
                >
                  <span
                    className={
                      active
                        ? "font-medium"
                        : "font-normal"
                    }
                  >
                    {group.label}
                  </span>

                  {group.list.length > 0 && (
                    <span className="ml-1 text-xs">
                      {group.list.length}
                    </span>
                  )}

                  <span
                    className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
                    style={{
                      backgroundColor: BRAND,
                      opacity: active ? 1 : 0,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl pt-4">
        {/* Retorno do pagamento */}
        {checkout && lastOrder && (
          <div className="mx-4 mb-4 rounded-3xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                style={{
                  backgroundColor:
                    "oklch(0.62 0.19 145 / 0.12)",
                }}
              >
                <Check
                  className="h-5 w-5"
                  style={{ color: SUCCESS }}
                />
              </div>

              <div>
                <p className="text-sm font-medium text-foreground">
                  Pedido #{lastOrder.id
                    .slice(0, 8)
                    .toUpperCase()}
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {displayStatusLabel(lastOrder)}
                </p>

                <p className="mt-2 text-sm leading-5 text-muted-foreground">
                  Assim que o pagamento for confirmado,
                  o pedido seguirá automaticamente para
                  preparação.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Carregando */}
        {isLoading && (
          <div className="px-4">
            <div className="rounded-3xl border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                Carregando suas compras...
              </p>
            </div>
          </div>
        )}

        {/* Nenhum pedido */}
        {!isLoading && orders.length === 0 && (
          <div className="mx-4 rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-muted">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>

            <h2 className="mt-5 text-lg font-medium text-foreground">
              Você ainda não fez nenhuma compra
            </h2>

            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Quando você fizer seu primeiro pedido,
              ele aparecerá aqui.
            </p>

            <Link
              to="/"
              className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl px-6 text-sm font-medium text-white"
              style={{
                backgroundColor: BRAND,
              }}
            >
              Ver produtos
            </Link>
          </div>
        )}

        {/* Conteúdo */}
        {!isLoading && orders.length > 0 && (
          <div
            ref={trackRef}
            onScroll={onScroll}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              scrollbarWidth: "none",
            }}
          >
            {groups.map((group) => (
              <section
                key={group.value}
                className="w-full shrink-0 snap-center px-4"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {group.value === "preparing" && (
                      <Clock3 className="h-5 w-5 text-muted-foreground" />
                    )}

                    {group.value === "shipping" && (
                      <Truck className="h-5 w-5 text-muted-foreground" />
                    )}

                    {group.value === "delivered" && (
                      <Check className="h-5 w-5 text-muted-foreground" />
                    )}

                    {group.value === "refund" && (
                      <RotateCcw className="h-5 w-5 text-muted-foreground" />
                    )}

                    {group.value === "canceled" && (
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    )}

                    <h2 className="text-base font-medium text-foreground">
                      {group.label}
                    </h2>
                  </div>

                  <span className="text-sm text-muted-foreground">
                    {group.list.length}
                  </span>
                </div>

                {group.list.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-10 text-center">
                    <Package className="mx-auto h-9 w-9 text-muted-foreground/60" />

                    <p className="mt-3 text-sm text-muted-foreground">
                      Nenhuma compra nesta seção.
                    </p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {group.list.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        phone={profile.phone}
                      />
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