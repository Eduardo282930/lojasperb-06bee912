import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  PackageSearch,
  TrendingUp,
  Truck,
} from "lucide-react";

import {
  fetchOrders,
  fetchDuplicates,
  confirmRefund,
  isRepairOrder,
  minutesLeftToPay,
  type Order,
} from "@/lib/orders";
import { fetchCatalog } from "@/lib/loyverse.functions";
import { formatPrice } from "@/lib/cart";
import { HOME_COLOR, type ModuleId } from "./admin-modules";
import { StatCard } from "./admin-ui";

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

type ActionItem = {
  id: string;
  title: string;
  hint: string;
  color: string;
  target: ModuleId;
  orderId?: string;
  /** Pedido que pode ter o reembolso confirmado direto na linha. */
  refundOrder?: Order;
};

export function DashboardPanel({
  onOpen,
}: {
  onOpen: (id: ModuleId, orderId?: string) => void;
}) {
  const orders = useQuery({
    queryKey: ["admin-orders"],
    queryFn: fetchOrders,
    staleTime: 15 * 1000,
  });
  const duplicates = useQuery({
    queryKey: ["admin", "duplicates"],
    queryFn: fetchDuplicates,
    staleTime: 60 * 1000,
  });
  const catalog = useQuery({
    queryKey: ["admin", "stock-catalog"],
    queryFn: () => fetchCatalog(),
    staleTime: 60 * 1000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const list: Order[] = orders.data ?? [];

  /** Custo de cada item, tirado do catálogo do Loyverse (por id ou SKU). */
  const costByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of catalog.data?.products ?? []) {
      for (const v of p.variants) {
        const cost = Number(v.cost) || 0;
        if (v.id) map.set(String(v.id), cost);
        if (v.sku) map.set(String(v.sku).toLowerCase(), cost);
      }
      if (p.sku) map.set(String(p.sku).toLowerCase(), Number(p.variants[0]?.cost) || 0);
    }
    return map;
  }, [catalog.data]);

  const kpis = useMemo(() => {
    const paidToday = list.filter(
      (o) => o.paymentStatus === "paid" && o.status !== "canceled" && isToday(o.createdAt),
    );
    const salesToday = paidToday.reduce((sum, o) => sum + (o.total || 0), 0);
    const profitToday = paidToday.reduce((sum, o) => {
      const cost = o.items.reduce((inner, i) => {
        const unit =
          costByKey.get(String(i.id)) ??
          (i.sku ? costByKey.get(String(i.sku).toLowerCase()) : undefined) ??
          0;
        return inner + unit * (i.qty || 1);
      }, 0);
      return sum + (o.total || 0) - cost;
    }, 0);
    const toPay = list.filter(
      (o) => o.paymentStatus !== "paid" && o.status !== "canceled",
    );
    const preparing = list.filter(
      (o) => o.status === "preparing" || (o.status === "sent" && o.paymentStatus === "paid"),
    );
    const shipping = list.filter((o) => o.status === "shipping");
    const deliveredToday = list.filter(
      (o) => o.status === "delivered" && isToday(o.updatedAt || o.createdAt),
    );
    /* Consertos: serviço, sem custo de produto — o total é o lucro. */
    const repairsToday = paidToday.filter((o) => isRepairOrder(o));
    const repairProfitToday = repairsToday.reduce((sum, o) => sum + (o.total || 0), 0);
    return {
      salesToday,
      profitToday,
      paidToday,
      toPay,
      preparing,
      shipping,
      deliveredToday,
      repairsToday,
      repairProfitToday,
    };
  }, [list, costByKey]);

  const stock = useMemo(() => {
    const products = catalog.data?.products ?? [];
    const out = products.filter(
      (p) => p.variants.some((v) => v.stock <= 0) || !p.variants.some((v) => v.availableForSale),
    ).length;
    const low = products.filter((p) => {
      const hasOut = p.variants.some((v) => v.stock <= 0);
      return !hasOut && p.variants.some((v) => v.stock > 0 && v.stock <= 2);
    }).length;
    return { out, low, total: products.length };
  }, [catalog.data]);

  const actions = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [];

    for (const o of kpis.toPay) {
      const mins = minutesLeftToPay(o);
      if (mins > 0 && mins <= 20) {
        items.push({
          id: `deadline-${o.id}`,
          title: `Pagamento vencendo — ${o.customerName || "Cliente"}`,
          hint: `Faltam ${mins} min · ${formatPrice(o.total)}`,
          color: "oklch(0.70 0.16 65)",
          target: "pedidos",
          orderId: o.id,
        });
      }
    }

    for (const o of list) {
      if (o.paymentStatus === "paid" && o.status === "sent") {
        items.push({
          id: `prep-${o.id}`,
          title: `Pago e aguardando preparo — ${o.customerName || "Cliente"}`,
          hint: formatPrice(o.total),
          color: "oklch(0.55 0.22 255)",
          target: "pedidos",
          orderId: o.id,
        });
      }
      const pendingRefund =
        o.status === "canceled" && o.refundState !== "refunded" && o.paymentStatus !== "refunded";
      if (pendingRefund || (o.refundState === "money_pending")) {
        items.push({
          id: `refund-${o.id}`,
          title: `Reembolso pendente — ${o.customerName || "Cliente"}`,
          hint: `Confirme o estorno de ${formatPrice(o.total)}`,
          color: "oklch(0.58 0.22 25)",
          target: "pedidos",
          orderId: o.id,
          refundOrder: o,
        });
      }
    }

    const dups = duplicates.data?.length ?? 0;
    if (dups > 0) {
      items.push({
        id: "dups",
        title: `${dups} cadastro(s) possivelmente repetido(s)`,
        hint: "Revise para não dividir moedas do mesmo cliente",
        color: "oklch(0.70 0.16 65)",
        target: "duplicidades",
      });
    }

    if (stock.out > 0) {
      items.push({
        id: "stock-out",
        title: `${stock.out} produto(s) sem estoque`,
        hint: "Reponha ou desative na vitrine",
        color: "oklch(0.62 0.19 145)",
        target: "estoque",
      });
    }

    return items.slice(0, 10);
  }, [kpis.toPay, list, duplicates.data, stock.out]);

  async function confirmarReembolso(o: Order) {
    const nome = o.customerName || "cliente sem nome";
    if (!window.confirm(`Você já devolveu o dinheiro do pedido ${o.id.slice(0, 8).toUpperCase()} de ${nome}?`)) return;
    if (!window.confirm(`Tem certeza de que você realizou o reembolso do pedido ${o.id.slice(0, 8).toUpperCase()} de ${nome}?`)) return;
    setBusy(o.id);
    const ok = await confirmRefund(o.id, o.receiptUrl ?? "");
    setBusy(null);
    if (!ok) window.alert("Não foi possível registrar o reembolso.");
    void orders.refetch();
  }

  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">
          Hoje
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
          <StatCard
            label="Vendas hoje"
            value={formatPrice(kpis.salesToday)}
            hint={`${kpis.paidToday.length} pedido(s) pago(s)`}
            color="oklch(0.62 0.19 145)"
            icon={<CircleDollarSign className="h-4 w-4" />}
          />
          <StatCard
            label="Lucro hoje"
            value={formatPrice(kpis.profitToday)}
            hint="Vendas menos o custo dos produtos"
            color="oklch(0.52 0.20 275)"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label="A pagar"
            value={String(kpis.toPay.length)}
            hint="Aguardando pagamento"
            color="oklch(0.70 0.16 65)"
            icon={<ClipboardList className="h-4 w-4" />}
            onClick={() => onOpen("pedidos")}
          />
          <StatCard
            label="Preparando"
            value={String(kpis.preparing.length)}
            hint="Pagos e em separação"
            color="oklch(0.55 0.22 255)"
            icon={<Boxes className="h-4 w-4" />}
            onClick={() => onOpen("pedidos")}
          />
          <StatCard
            label="A caminho"
            value={String(kpis.shipping.length)}
            hint="Saíram para entrega"
            color="oklch(0.55 0.24 300)"
            icon={<Truck className="h-4 w-4" />}
            onClick={() => onOpen("pedidos")}
          />
          <StatCard
            label="Entregues hoje"
            value={String(kpis.deliveredToday.length)}
            hint="Finalizados hoje"
            color="oklch(0.52 0.20 275)"
            icon={<ClipboardList className="h-4 w-4" />}
            onClick={() => onOpen("pedidos")}
          />
          <StatCard
            label="Estoque crítico"
            value={String(stock.out + stock.low)}
            hint={`${stock.out} zerado(s) · ${stock.low} baixo(s)`}
            color="oklch(0.58 0.22 25)"
            icon={<PackageSearch className="h-4 w-4" />}
            onClick={() => onOpen("estoque")}
          />
        </div>
      </section>

      <section>
        <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">
          Precisa de você
        </p>
        {actions.length === 0 ? (
          <div className="rounded-3xl border bg-card p-5 text-sm font-semibold text-muted-foreground shadow-sm">
            Tudo em dia. Nenhum pedido ou cadastro esperando você agora.
          </div>
        ) : (
          <ul className="space-y-2">
            {actions.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onOpen(a.target, a.orderId)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                    style={{ backgroundColor: a.color }}
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-foreground">
                      {a.title}
                    </span>
                    <span className="block truncate text-xs font-semibold text-muted-foreground">
                      {a.hint}
                    </span>
                  </span>
                </button>
                {a.refundOrder ? (
                  <button
                    type="button"
                    disabled={busy === a.refundOrder.id}
                    onClick={() => void confirmarReembolso(a.refundOrder as Order)}
                    className="shrink-0 rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-60"
                    style={{ backgroundColor: a.color }}
                  >
                    {busy === a.refundOrder.id ? "…" : "Confirmar reembolso"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(a.target, a.orderId)}
                    aria-label="Abrir"
                    className="shrink-0 text-lg font-black text-muted-foreground"
                  >
                    →
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="px-1 text-xs font-semibold text-muted-foreground" style={{ color: HOME_COLOR }}>
        Os números se atualizam sozinhos conforme os pedidos mudam.
      </p>
    </div>
  );
}
