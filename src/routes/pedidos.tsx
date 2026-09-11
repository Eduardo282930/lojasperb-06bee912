import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ClipboardList,
  Package,
} from "lucide-react";
import { BackButton } from "@/components/back-button";
import { ReceiptDownload } from "@/components/receipt-download";
import { useProfile } from "@/lib/coupons";
import { useServerFn } from "@tanstack/react-start";
import { createOrderCheckout } from "@/lib/payments.functions";
import { runLoyverseQuickSync } from "@/lib/loyverse-reconcile.functions";
import { formatPrice } from "@/lib/cart";
import { useLiveInvalidate } from "@/lib/live";
import {
  fetchMyOrders,
  fetchOrderTimeline,
  statusLabel,
  displayStatusLabel,
  isRepairOrder,
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
  "canceled",
] as const;

type StatusValue = (typeof STATUSES)[number];

const SECTIONS: { value: StatusValue; label: string }[] = [
  { value: "topay", label: "A pagar" },
  { value: "preparing", label: "Preparando" },
  { value: "shipping", label: "A caminho" },
  { value: "delivered", label: "Finalizado" },
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
    const order = String(search["order"] ?? "");

    return {
      status,
      ...(checkout ? { checkout: true as const } : {}),
      ...(order ? { order } : {}),
    };
  },

  head: () => ({
    meta: [
      {
        title: "Minhas compras — SPERB",
      },
      {
        name: "description",
        content:
          "Acompanhe seus pedidos SPERB: pagamento, preparação, entrega e valores.",
      },
    ],
  }),

  component: PedidosPage,
});

const BLUE = "oklch(0.55 0.22 255)";
const GREEN = "oklch(0.62 0.19 145)";

const STEPS = [
  "sent",
  "preparing",
  "shipping",
  "delivered",
] as const;

function Progress({ status }: { status: string }) {
  if (status === "canceled") {
    return null;
  }

  const current = Math.max(
    0,
    STEPS.indexOf(status as (typeof STEPS)[number]),
  );

  return (
    <div className="mt-4">
      <div className="flex items-center gap-1.5">
        {STEPS.map((step, index) => (
          <div
            key={step}
            className="h-1.5 flex-1 rounded-full"
            style={{
              backgroundColor:
                index <= current ? GREEN : "var(--muted)",
            }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
        <span>Recebido</span>
        <span>Preparando</span>
        <span>A caminho</span>
        <span>Entregue</span>
      </div>
    </div>
  );
}

function refundMessage(order: Order): string | null {
  if (order.refundState !== "money_pending") {
    return null;
  }

  const provider =
    `${order.paymentProvider ?? ""} ${order.paymentMethod ?? ""}`.toLowerCase();

  const isInfinitePay = provider.includes("infinite");

  const isWhatsApp =
    provider.includes("whatsapp") ||
    provider.includes("manual") ||
    provider.includes("delivery");

  if (isInfinitePay) {
    return "Pedido cancelado · Reembolso pendente de confirmação. Assim que a InfinitePay concluir o estorno, você verá aqui: Reembolso realizado.";
  }

  if (isWhatsApp) {
    return "Pedido cancelado · Reembolso pendente de confirmação pelo atendimento da SPERB.";
  }

  return "Pedido cancelado · Reembolso pendente de confirmação. Você verá aqui quando for concluído.";
}

function OrderCard({
  order,
  phone,
  autoOpen,
}: {
  order: Order;
  phone: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const cardRef = useRef<HTMLLIElement | null>(null);

  // Vindo de uma notificação: abre e mostra exatamente este pedido.
  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    const timer = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [autoOpen]);
  const [paying, setPaying] = useState(false);

  const startCheckout = useServerFn(createOrderCheckout);

  const refunded =
    order.paymentStatus === "refunded" ||
    order.refundState === "refunded";

  const unpaid =
    order.paymentStatus !== "paid" &&
    order.status !== "canceled" &&
    !refunded;

  const refundText = refundMessage(order);

  const [minutesLeft, setMinutesLeft] = useState(() =>
    minutesLeftToPay(order),
  );

  useEffect(() => {
    setMinutesLeft(minutesLeftToPay(order));

    const timer = window.setInterval(() => {
      setMinutesLeft(minutesLeftToPay(order));
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [order]);

  const timeline = useQuery({
    queryKey: ["order-timeline", order.id],
    queryFn: () => fetchOrderTimeline(order.id, phone),
    enabled: open,
    staleTime: 30 * 1000,
  });

  async function pagar() {
    if (paying) return;

    setPaying(true);

    try {
      const result = await startCheckout({
        data: {
          orderId: order.id,
        },
      });

      if (result.url) {
        window.location.href = result.url;
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <li ref={cardRef} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {new Date(order.createdAt).toLocaleString("pt-BR")}
            </p>

            <p className="mt-1 text-lg font-semibold text-foreground">
              {displayStatusLabel(order)}
            </p>

            <p className="mt-0.5 text-sm text-muted-foreground">
              {paymentDisplayLabel(order)}
            </p>

            {isRepairOrder(order) ? (
              <p className="mt-1 inline-block rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                Conserto feito na loja · 3 meses de garantia
              </p>
            ) : (
              order.origin === "store" && (
                <p className="mt-1 inline-block rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                  Pedido feito pelo vendedor da loja
                </p>
              )
            )}
          </div>

          <div className="shrink-0 text-right">
            <p className="text-xs font-medium text-muted-foreground">
              Total
            </p>

            <p
              className="text-xl font-semibold"
              style={{ color: BLUE }}
            >
              {formatPrice(order.total)}
            </p>
          </div>
        </div>

        <Progress status={order.status} />

        <div className="mt-4 rounded-xl bg-muted/50 p-3">
          <p className="mb-2 text-sm font-semibold text-foreground">
            Produtos do pedido
          </p>

          <ul className="space-y-3">
            {order.items.map((item, index) => (
              <li
                key={`${item.id}-${index}`}
                className="flex items-center gap-3"
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt=""
                    loading="lazy"
                    className="h-14 w-14 shrink-0 rounded-xl bg-background object-cover"
                  />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-background">
                    <Package className="h-6 w-6 text-muted-foreground" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">
                    {item.name}
                  </p>

                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Quantidade:{" "}
                    <span className="font-semibold text-foreground">
                      {item.qty}
                    </span>
                  </p>
                </div>

                <p className="shrink-0 text-sm font-semibold text-foreground">
                  {formatPrice(item.price * item.qty)}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {order.discount > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {order.couponCode
                ? `Desconto do cupom ${order.couponCode}`
                : "Desconto"}
            </span>

            <span
              className="font-semibold"
              style={{ color: GREEN }}
            >
              -{formatPrice(order.discount)}
            </span>
          </div>
        )}

        {(order.sellerDiscount ?? 0) > 0 && (
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Desconto do vendedor</span>
            <span className="font-semibold" style={{ color: GREEN }}>
              -{formatPrice(order.sellerDiscount ?? 0)}
            </span>
          </div>
        )}

        {(order.coinsDiscount ?? 0) > 0 && (
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Moedas usadas ({(order.coinsUsed ?? 0).toLocaleString("pt-BR")})
            </span>
            <span className="font-semibold" style={{ color: GREEN }}>
              -{formatPrice(order.coinsDiscount ?? 0)}
            </span>
          </div>
        )}

        {unpaid && minutesLeft > 0 && (
          <div className="mt-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-foreground dark:bg-blue-950/30">
            <span className="font-semibold">
              Pagamento pendente.
            </span>{" "}
            Você tem {minutesLeft}{" "}
            {minutesLeft === 1 ? "minuto" : "minutos"} para pagar.
          </div>
        )}

        {unpaid && (
          <button
            type="button"
            onClick={() => void pagar()}
            disabled={paying}
            className="mt-3 w-full rounded-xl px-4 py-3 text-base font-semibold text-white transition-opacity disabled:opacity-60 active:scale-[0.99]"
            style={{ backgroundColor: BLUE }}
          >
            {paying
              ? "Abrindo pagamento…"
              : `Pagar ${formatPrice(order.total)}`}
          </button>
        )}

        {refundText && (
          <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-900/40 dark:bg-orange-950/20">
            <p className="text-sm font-medium leading-5 text-foreground">
              {refundText}
            </p>
          </div>
        )}

        {order.paymentStatus === "paid" &&
          order.paymentMethod !== "delivery" &&
          order.receiptUrl && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-950/30">
              <span className="text-sm font-semibold text-foreground">
                Pagamento confirmado
              </span>
              <a
                href={order.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold underline"
                style={{ color: BLUE }}
              >
                Comprovante do pagamento
              </a>
            </div>
          )}

        {(order.paymentStatus === "paid" || refunded) && (
          <ReceiptDownload orderId={order.id} phone={phone} />
        )}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-3 flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-foreground"
        >
          <span>
            {open
              ? "Ocultar detalhes"
              : "Ver detalhes do pedido"}
          </span>

          <ChevronDown
            className={`h-5 w-5 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        {open && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-sm font-semibold text-foreground">
              Histórico do pedido
            </p>

            <ul className="mt-2 space-y-3">
              {(timeline.data ?? []).map((entry, index) => (
                <li
                  key={`${entry.createdAt}-${index}`}
                  className="text-sm leading-5 text-muted-foreground"
                >
                  <span className="font-semibold text-foreground">
                    {statusLabel(entry.status)}
                  </span>

                  <span>
                    {" "}
                    ·{" "}
                    {new Date(entry.createdAt).toLocaleString(
                      "pt-BR",
                    )}
                  </span>

                  {entry.note && (
                    <span> — {entry.note}</span>
                  )}
                </li>
              ))}

              {timeline.data?.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  Ainda não há atualizações.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

function PedidosPage() {
  // O que o Admin mudar (status, pagamento, reembolso) aparece na hora.
  useLiveInvalidate([
    { table: "orders", keys: [["my-orders"], ["order-timeline"]] },
    { table: "order_status_history", keys: [["order-timeline"]] },
  ]);
  const profile = useProfile();
  const { status, checkout, order: focusOrderId } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [lastOrderId, setLastOrderId] = useState("");

  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      SECTIONS.findIndex(
        (item) => item.value === status,
      ),
    ),
  );

  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
  });

  const trackRef =
    useRef<HTMLDivElement>(null);

  const tabsRef =
    useRef<HTMLDivElement>(null);

  const tabRefs = useRef<
    Array<HTMLButtonElement | null>
  >([]);

  const rafRef =
    useRef<number | null>(null);

  const scrollStopRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const initialTrackSyncRef =
    useRef(false);

  const autoPickedRef =
    useRef(false);

  // Impede que o onScroll sobrescreva uma troca
  // feita diretamente pelo clique em uma aba.
  const programmaticScrollRef =
    useRef(false);

  const { data, isLoading, refetch } =
    useQuery({
      queryKey: ["my-orders", profile.phone],

      queryFn: () =>
        fetchMyOrders(profile.phone),

      staleTime: 30 * 1000,

      refetchOnWindowFocus: true,

      // Reembolso pendente: a tela vira "Reembolso realizado" sozinha.
      refetchInterval: (query) => {
        if (checkout) return 5000;
        const list = (query.state.data ?? []) as Order[];
        const waiting = list.some(
          (o) => o.refundState === "money_pending",
        );
        return waiting ? 8000 : false;
      },
    });

  const quickSync =
    useServerFn(runLoyverseQuickSync);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const expired =
          await cancelExpiredUnpaidOrders();

        const result =
          await quickSync({});

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
        // O webhook continua sendo a principal fonte de atualização.
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    quickSync,
    refetch,
  ]);

  const orders = data ?? [];

  const lastOrder = orders.find(
    (order) =>
      order.id === lastOrderId,
  );

  useEffect(() => {
    if (
      typeof window !== "undefined"
    ) {
      setLastOrderId(
        window.localStorage.getItem(
          "sperb-last-order",
        ) ?? "",
      );
    }
  }, []);

  useEffect(() => {
    const foundIndex =
      SECTIONS.findIndex(
        (item) =>
          item.value === status,
      );

    const index = Math.max(
      0,
      foundIndex === -1
        ? 0
        : foundIndex,
    );

    const track =
      trackRef.current;

    if (
      track &&
      track.clientWidth > 0
    ) {
      const targetLeft =
        index *
        track.clientWidth;

      if (
        Math.abs(
          track.scrollLeft -
            targetLeft,
        ) > 1
      ) {
        track.scrollLeft =
          targetLeft;
      }
    }

    setActiveIndex(index);
  }, [status]);

  useEffect(() => {
    if (
      checkout &&
      lastOrder?.paymentStatus ===
        "paid" &&
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

  function bucket(
    order: Order,
  ): StatusValue {
    if (
      order.status === "canceled" ||
      order.paymentStatus ===
        "refunded"
    ) {
      return "canceled";
    }

    /* Conserto: o cliente vê direto em Finalizado, com o recibo. */
    if (
      order.status === "delivered" ||
      isRepairOrder(order)
    ) {
      return "delivered";
    }

    if (
      order.paymentStatus !==
      "paid"
    ) {
      return "topay";
    }

    if (
      order.status === "shipping"
    ) {
      return "shipping";
    }

    return "preparing";
  }

  const groups =
    SECTIONS.map((section) => ({
      ...section,

      list: orders.filter(
        (order) =>
          bucket(order) ===
          section.value,
      ),
    }));

  useEffect(() => {
    if (
      autoPickedRef.current ||
      isLoading ||
      orders.length === 0
    ) {
      return;
    }

    const currentIndex =
      Math.max(
        0,
        SECTIONS.findIndex(
          (item) =>
            item.value === status,
        ),
      );

    const currentGroup =
      groups[currentIndex];

    if (
      currentGroup &&
      currentGroup.list
        .length > 0
    ) {
      autoPickedRef.current =
        true;

      return;
    }

    const priority: StatusValue[] =
      [
        "topay",
        "preparing",
        "shipping",
        "delivered",
      ];

    const firstPopulated =
      priority.find(
        (value) =>
          (groups.find(
            (group) =>
              group.value ===
              value,
          )?.list.length ?? 0) > 0,
      );

    if (!firstPopulated) {
      autoPickedRef.current =
        true;

      return;
    }

    if (
      firstPopulated !== status
    ) {
      autoPickedRef.current =
        true;

      void navigate({
        search: {
          status:
            firstPopulated,
        },
        replace: true,
      });
    } else {
      autoPickedRef.current =
        true;
    }
  }, [
    groups,
    isLoading,
    navigate,
    orders.length,
    status,
  ]);

  useEffect(() => {
    if (
      initialTrackSyncRef.current
    ) {
      return;
    }

    if (
      isLoading ||
      orders.length === 0
    ) {
      return;
    }

    const foundIndex =
      SECTIONS.findIndex(
        (item) =>
          item.value === status,
      );

    const index = Math.max(
      0,
      foundIndex === -1
        ? 0
        : foundIndex,
    );

    const syncInitialTrack =
      () => {
        const track =
          trackRef.current;

        if (
          !track ||
          track.clientWidth <= 0
        ) {
          return false;
        }

        track.scrollLeft =
          index *
          track.clientWidth;

        setActiveIndex(index);

        return true;
      };

    requestAnimationFrame(
      () => {
        if (
          syncInitialTrack()
        ) {
          initialTrackSyncRef.current =
            true;
        } else {
          requestAnimationFrame(
            () => {
              if (
                syncInitialTrack()
              ) {
                initialTrackSyncRef.current =
                  true;
              }
            },
          );
        }
      },
    );
  }, [
    isLoading,
    orders.length,
    status,
  ]);

  const updateIndicator =
    useCallback(
      (
        progressIndex = activeIndex,
      ) => {
        const tabs =
          tabsRef.current;

        if (!tabs) return;

        const buttons =
          tabRefs.current;

        const floorIndex =
          Math.max(
            0,
            Math.min(
              SECTIONS.length -
                1,
              Math.floor(
                progressIndex,
              ),
            ),
          );

        const ceilIndex =
          Math.max(
            0,
            Math.min(
              SECTIONS.length -
                1,
              Math.ceil(
                progressIndex,
              ),
            ),
          );

        const current =
          buttons[floorIndex];

        const next =
          buttons[ceilIndex];

        if (
          !current ||
          !next
        ) {
          return;
        }

        const tabsRect =
          tabs.getBoundingClientRect();

        const currentRect =
          current.getBoundingClientRect();

        const nextRect =
          next.getBoundingClientRect();

        const progress =
          progressIndex -
          Math.floor(
            progressIndex,
          );

        const currentLeft =
          currentRect.left -
          tabsRect.left +
          tabs.scrollLeft;

        const nextLeft =
          nextRect.left -
          tabsRect.left +
          tabs.scrollLeft;

        const left =
          currentLeft +
          (nextLeft -
            currentLeft) *
            progress;

        const width =
          currentRect.width +
          (nextRect.width -
            currentRect.width) *
            progress;

        setIndicator({
          left,
          width,
        });
      },
      [activeIndex],
    );

  useEffect(() => {
    updateIndicator();

    const onResize = () => {
      updateIndicator();
    };

    window.addEventListener(
      "resize",
      onResize,
    );

    return () => {
      window.removeEventListener(
        "resize",
        onResize,
      );
    };
  }, [
    updateIndicator,
    groups.length,
  ]);

  function setStatus(
    next: StatusValue,
  ) {
    void navigate({
      search: {
        status: next,
      },
      replace: true,
    });
  }

  function selectTab(
    index: number,
  ) {
    const track =
      trackRef.current;

    if (!track) return;

    if (
      scrollStopRef.current
    ) {
      clearTimeout(
        scrollStopRef.current,
      );

      scrollStopRef.current =
        null;
    }

    if (
      rafRef.current !== null
    ) {
      cancelAnimationFrame(
        rafRef.current,
      );

      rafRef.current = null;
    }

    // Marca esta movimentação como sendo
    // causada pelo clique, não pelo usuário.
    programmaticScrollRef.current =
      true;

    setActiveIndex(index);

    setStatus(
      SECTIONS[index].value,
    );

    track.scrollLeft =
      index *
      track.clientWidth;

    updateIndicator(index);

    // Depois que o navegador terminar de
    // disparar os eventos de scroll dessa
    // movimentação, libera novamente o scroll manual.
    window.setTimeout(() => {
      programmaticScrollRef.current =
        false;
    }, 250);
  }

  function onTrackScroll() {
    // Se o movimento foi causado por um clique
    // em uma aba, não deixa o onScroll mudar
    // novamente a seção escolhida.
    if (
      programmaticScrollRef.current
    ) {
      return;
    }

    const track =
      trackRef.current;

    if (
      !track ||
      track.clientWidth === 0
    ) {
      return;
    }

    const raw = Math.max(
      0,
      Math.min(
        SECTIONS.length - 1,
        track.scrollLeft /
          track.clientWidth,
      ),
    );

    if (
      rafRef.current !== null
    ) {
      cancelAnimationFrame(
        rafRef.current,
      );
    }

    rafRef.current =
      requestAnimationFrame(
        () => {
          setActiveIndex(raw);
          updateIndicator(raw);
        },
      );

    if (
      scrollStopRef.current
    ) {
      clearTimeout(
        scrollStopRef.current,
      );
    }

    scrollStopRef.current =
      setTimeout(() => {
        const currentTrack =
          trackRef.current;

        if (
          !currentTrack ||
          currentTrack.clientWidth ===
            0
        ) {
          return;
        }

        const nearest =
          Math.max(
            0,
            Math.min(
              SECTIONS.length - 1,
              Math.round(
                currentTrack.scrollLeft /
                  currentTrack.clientWidth,
              ),
            ),
          );

        setActiveIndex(
          nearest,
        );

        setStatus(
          SECTIONS[nearest].value,
        );
      }, 120);
  }

  useEffect(() => {
    return () => {
      if (
        rafRef.current !== null
      ) {
        cancelAnimationFrame(
          rafRef.current,
        );
      }

      if (
        scrollStopRef.current
      ) {
        clearTimeout(
          scrollStopRef.current,
        );
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <BackButton fallback="/eu" />

          <h1 className="text-2xl font-semibold text-foreground">
            Minhas compras
          </h1>
        </div>

        <div
          ref={tabsRef}
          className="relative mx-auto flex max-w-3xl overflow-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {groups.map(
            (group, index) => (
              <button
                key={
                  group.value
                }
                ref={(element) => {
                  tabRefs.current[
                    index
                  ] = element;
                }}
                type="button"
                onClick={() =>
                  selectTab(index)
                }
                className="relative flex min-w-0 flex-1 flex-col items-center justify-end whitespace-nowrap px-1 pb-3 pt-1 text-[13px] font-medium transition-colors sm:px-2 sm:text-sm"
                style={{
                  color:
                    Math.round(
                      activeIndex,
                    ) === index
                      ? BLUE
                      : "var(--muted-foreground)",
                }}
              >
                <span className="mb-0.5 flex h-4 items-center justify-center">
                  {group.list.length >
                  0 ? (
                    <span
                      className="grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
                      style={{
                        backgroundColor:
                          BLUE,
                      }}
                    >
                      {
                        group
                          .list
                          .length
                      }
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-4"
                    />
                  )}
                </span>

                <span className="leading-5">
                  {
                    group.label
                  }
                </span>
              </button>
            ),
          )}

          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full"
            style={{
              left:
                indicator.left,
              width:
                indicator.width,
              backgroundColor:
                BLUE,
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-3xl pt-4">
        {checkout &&
          lastOrder && (
            <div className="mx-4 mb-4 rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-900/40 dark:bg-green-950/20">
              <p className="text-base font-semibold text-foreground">
                Pedido nº{" "}
                {lastOrder.id
                  .slice(0, 8)
                  .toUpperCase()}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {displayStatusLabel(
                  lastOrder,
                )}{" "}
                ·{" "}
                {paymentDisplayLabel(
                  lastOrder,
                )}
              </p>
            </div>
          )}

        {isLoading && (
          <p className="px-4 text-base text-muted-foreground">
            Carregando suas compras…
          </p>
        )}

        {!isLoading &&
          orders.length ===
            0 && (
            <div className="mx-4 flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
              <div className="grid h-24 w-24 place-items-center rounded-3xl bg-muted/50">
                <ClipboardList
                  className="h-12 w-12"
                  style={{
                    color: BLUE,
                  }}
                />
              </div>

              <p className="mt-5 text-lg font-semibold text-foreground">
                Ainda não há pedidos
              </p>

              <p className="mt-1 max-w-xs text-sm leading-5 text-muted-foreground">
                Quando você fizer uma compra, seus pedidos aparecerão aqui.
              </p>

              <a
                href="/"
                className="mt-5 rounded-xl px-5 py-3 text-base font-semibold text-white"
                style={{
                  backgroundColor:
                    BLUE,
                }}
              >
                Ver produtos
              </a>
            </div>
          )}

        {!isLoading &&
          orders.length >
            0 && (
            <div
              ref={trackRef}
              onScroll={
                onTrackScroll
              }
              className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={{
                scrollbarWidth:
                  "none",
              }}
            >
              {groups.map(
                (group) => (
                  <section
                    key={
                      group.value
                    }
                    className="w-full shrink-0 snap-start px-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-xl font-semibold text-foreground">
                        {
                          group.label
                        }
                      </h2>

                      <span className="text-sm font-medium text-muted-foreground">
                        {
                          group
                            .list
                            .length
                        }
                      </span>
                    </div>

                    {group.list
                      .length ===
                    0 ? (
                      <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
                        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-muted/50">
                          <ClipboardList
                            className="h-10 w-10"
                            style={{
                              color:
                                BLUE,
                            }}
                          />
                        </div>

                        <p className="mt-4 text-base font-semibold text-foreground">
                          Ainda não há pedidos
                        </p>

                        <p className="mt-1 max-w-xs text-sm leading-5 text-muted-foreground">
                          Nenhum pedido está nesta seção no momento.
                        </p>
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {group.list.map(
                          (
                            order,
                          ) => (
                            <OrderCard
                              key={
                                order.id
                              }
                              order={
                                order
                              }
                              phone={
                                profile.phone
                              }
                              autoOpen={
                                order.id ===
                                focusOrderId
                              }
                            />
                          ),
                        )}
                      </ul>
                    )}
                  </section>
                ),
              )}
            </div>
          )}
      </main>
    </div>
  );
}