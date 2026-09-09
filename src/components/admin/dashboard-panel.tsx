import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  PackageSearch,
  Truck,
  UserSearch,
} from "lucide-react";

import { fetchOrders, fetchDuplicates, minutesLeftToPay, type Order } from "@/lib/orders";
import { fetchCatalog } from "@/lib/loyverse.functions";
import { formatPrice } from "@/lib/cart";
import { ADMIN_MODULES, HOME_COLOR, type ModuleId } from "./admin-modules";
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
};

export function DashboardPanel({ onOpen }: { onOpen: (id: ModuleId) => void }) {
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

  const list: Order[] = orders.data ?? [];

  const kpis = useMemo(() => {
    const paidToday = list.filter(
      (o) => o.paymentStatus === "paid" && o.status !== "canceled" && isToday(o.createdAt),
    );
    const salesToday = paidToday.reduce((sum, o) => sum + (o.total || 0), 0);
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
    return { salesToday, paidToday, toPay, preparing, shipping, deliveredToday };
  }, [list]);

  const stock = useMemo(() => {
    const products = catalog.data?.products ?? [];
    const out = products.filter((p) => p.variants.some((v) => v.stock <= 0)).length;
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
        });
      }
      if (o.refundState && o.refundState !== "none" && o.refundState !== "confirmed") {
        items.push({
          id: `refund-${o.id}`,
          title: `Reembolso pendente — ${o.customerName || "Cliente"}`,
          hint: `Confirme o estorno de ${formatPrice(o.total)}`,
          color: "oklch(0.58 0.22 25)",
          target: "pedidos",
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

    return items.slice(0, 8);
  }, [kpis.toPay, list, duplicates.data, stock.out]);

  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">
          Hoje
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Vendas hoje"
            value={formatPrice(kpis.salesToday)}
            hint={`${kpis.paidToday.length} pedido(s) pago(s)`}
            color="oklch(0.62 0.19 145)"
            icon={<CircleDollarSign className="h-4 w-4" />}
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
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onOpen(a.target)}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-transform active:scale-[0.99]"
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
                  <span className="shrink-0 text-lg font-black text-muted-foreground">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">
          Módulos
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {ADMIN_MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.id)}
              className="flex min-h-[118px] flex-col items-start justify-between rounded-3xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
              style={{ borderColor: `color-mix(in oklab, ${m.color} 30%, transparent)` }}
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-sm"
                style={{ backgroundColor: m.color }}
              >
                {m.icon}
              </span>
              <span className="mt-3 min-w-0">
                <span className="block text-base font-black leading-tight text-foreground">
                  {m.label}
                </span>
                <span className="mt-1 block text-xs font-semibold leading-4 text-muted-foreground">
                  {m.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="px-1 text-xs font-semibold text-muted-foreground" style={{ color: HOME_COLOR }}>
        Os números se atualizam sozinhos conforme os pedidos mudam.
      </p>
    </div>
  );
}
