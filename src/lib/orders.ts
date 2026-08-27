/**
 * Pedidos — criados e lidos exclusivamente no Medusa.js.
 */

import {
  adminToken,
  customerToken,
  ensureCustomerSession,
  getMedusaConfig,
  isMedusaConfigured,
  medusaFetch,
  onlyDigits as digitsOf,
} from "@/lib/medusa";

export type OrderItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
  image?: string | null;
  sku?: string;
};

export type Order = {
  id: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  couponCode: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  paymentStatus: string;
};

export const ORDER_STATUSES = [
  { value: "sent", label: "Pedido recebido" },
  { value: "preparing", label: "Em preparação" },
  { value: "shipping", label: "A caminho" },
  { value: "delivered", label: "Entregue" },
  { value: "canceled", label: "Cancelado" },
] as const;

export const PAYMENT_STATUSES = [
  { value: "pending", label: "Aguardando pagamento" },
  { value: "paid", label: "Pago" },
  { value: "refunded", label: "Estornado" },
] as const;

export function statusLabel(v: string): string {
  return ORDER_STATUSES.find((s) => s.value === v)?.label ?? "Pedido recebido";
}

export function paymentLabel(v: string): string {
  return PAYMENT_STATUSES.find((s) => s.value === v)?.label ?? "Aguardando pagamento";
}

export function onlyDigits(s: string): string {
  return digitsOf(s);
}

/* ------------------------------ Mapeamento ------------------------------ */

type MedusaOrder = {
  id: string;
  display_id?: number;
  created_at: string;
  email?: string | null;
  currency_code?: string;
  subtotal?: number | null;
  discount_total?: number | null;
  total?: number | null;
  payment_status?: string | null;
  fulfillment_status?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  customer?: { first_name?: string | null; phone?: string | null } | null;
  items?: Array<{
    id: string;
    title?: string | null;
    product_title?: string | null;
    variant_title?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    thumbnail?: string | null;
    variant_sku?: string | null;
  }> | null;
  promotions?: Array<{ code?: string | null }> | null;
};

function appStatus(o: MedusaOrder): string {
  const meta = (o.metadata ?? {}) as { app_status?: string };
  if (meta.app_status) return meta.app_status;
  if (o.status === "canceled") return "canceled";
  if (o.fulfillment_status === "delivered") return "delivered";
  if (o.fulfillment_status === "shipped") return "shipping";
  if (o.fulfillment_status === "fulfilled") return "preparing";
  return "sent";
}

function appPayment(o: MedusaOrder): string {
  if (o.payment_status === "captured" || o.payment_status === "paid") return "paid";
  if (o.payment_status === "refunded") return "refunded";
  return "pending";
}

function toOrder(o: MedusaOrder): Order {
  return {
    id: o.id,
    createdAt: o.created_at,
    customerName:
      o.customer?.first_name?.trim() ||
      ((o.metadata ?? {}) as { customer_name?: string }).customer_name ||
      "Cliente",
    customerPhone:
      o.customer?.phone ??
      (((o.metadata ?? {}) as { customer_phone?: string }).customer_phone || ""),
    couponCode: o.promotions?.[0]?.code ?? "",
    items: (o.items ?? []).map((i) => ({
      id: i.id,
      name: [i.product_title ?? i.title, i.variant_title].filter(Boolean).join(" — "),
      qty: Number(i.quantity) || 1,
      price: Number(i.unit_price) || 0,
      image: i.thumbnail ?? null,
      sku: i.variant_sku ?? "",
    })),
    subtotal: Number(o.subtotal) || 0,
    discount: Number(o.discount_total) || 0,
    total: Number(o.total) || 0,
    status: appStatus(o),
    paymentStatus: appPayment(o),
  };
}

/* ------------------------------- Checkout ------------------------------- */

/** Cria o pedido no Medusa antes de abrir o WhatsApp. */
export async function recordOrder(input: {
  name: string;
  phone: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string;
  coins?: number;
}): Promise<void> {
  if (!isMedusaConfigured()) return;
  const cfg = getMedusaConfig();
  try {
    await ensureCustomerSession(input.phone, input.name);
    const token = customerToken.get();

    const cart = await medusaFetch<{ cart: { id: string } }>("/store/carts", {
      method: "POST",
      token,
      body: {
        ...(cfg.regionId ? { region_id: cfg.regionId } : {}),
        ...(cfg.salesChannelId ? { sales_channel_id: cfg.salesChannelId } : {}),
        email: `${digitsOf(input.phone)}@clientes.sperb.app`,
        metadata: {
          customer_name: input.name,
          customer_phone: digitsOf(input.phone),
          coins_used: Math.max(0, Math.trunc(input.coins ?? 0)),
          app_status: "sent",
        },
        items: input.items.map((i) => ({ variant_id: i.id, quantity: i.qty })),
      },
    });

    if (input.couponCode) {
      await medusaFetch(`/store/carts/${cart.cart.id}`, {
        method: "POST",
        token,
        body: { promo_codes: [input.couponCode] },
      }).catch(() => undefined);
    }

    // Fecha o pedido usando o provedor manual do Medusa (quando disponível).
    try {
      const pc = await medusaFetch<{ payment_collection: { id: string } }>(
        "/store/payment-collections",
        { method: "POST", token, body: { cart_id: cart.cart.id } },
      );
      await medusaFetch(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, {
        method: "POST",
        token,
        body: { provider_id: "pp_system_default" },
      });
      await medusaFetch(`/store/carts/${cart.cart.id}/complete`, { method: "POST", token });
    } catch (err) {
      console.warn("[recordOrder] pedido criado como carrinho no Medusa", err);
    }
  } catch (err) {
    console.warn("[recordOrder] falhou", err);
  }
}

/* -------------------------------- Leitura ------------------------------- */

/** Administração: todos os pedidos do Medusa. */
export async function fetchOrders(): Promise<Order[]> {
  const token = adminToken.get();
  if (!token) return [];
  const res = await medusaFetch<{ orders: MedusaOrder[] }>("/admin/orders", {
    admin: true,
    token,
    query: { limit: 100, order: "-created_at", fields: "*items,*customer,*promotions" },
  });
  return (res.orders ?? []).map(toOrder);
}

/** Cliente: apenas os pedidos da conta dele. */
export async function fetchMyOrders(phone: string): Promise<Order[]> {
  if (!isMedusaConfigured()) return [];
  await ensureCustomerSession(phone, "");
  const token = customerToken.get();
  if (!token) return [];
  try {
    const res = await medusaFetch<{ orders: MedusaOrder[] }>("/store/orders", {
      token,
      query: { limit: 50, order: "-created_at" },
    });
    return (res.orders ?? []).map(toOrder);
  } catch {
    return [];
  }
}

export type TimelineEntry = {
  status: string;
  paymentStatus: string | null;
  note: string;
  createdAt: string;
};

export async function fetchOrderTimeline(
  orderId: string,
  phone: string,
): Promise<TimelineEntry[]> {
  const orders = await fetchMyOrders(phone);
  const order = orders.find((o) => o.id === orderId);
  if (!order) return [];
  return [
    {
      status: order.status,
      paymentStatus: order.paymentStatus,
      note: "Situação atual no Medusa",
      createdAt: order.createdAt,
    },
  ];
}

/** Administração: atualiza a situação do pedido no Medusa. */
export async function setOrderStatus(
  orderId: string,
  status: string,
  paymentStatus: string,
  note = "",
): Promise<boolean> {
  const token = adminToken.get();
  if (!token) return false;
  try {
    await medusaFetch(`/admin/orders/${orderId}`, {
      method: "POST",
      admin: true,
      token,
      body: {
        metadata: {
          app_status: status,
          app_payment_status: paymentStatus,
          app_note: note,
          app_updated_at: new Date().toISOString(),
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

/* ----------------------- Clientes duplicados ---------------------------- */
/* O Medusa não permite duas contas com o mesmo telefone, então não há
   duplicidades a revisar. Mantido apenas para compatibilidade da tela. */

export type DuplicateReview = {
  id: string;
  existingName: string;
  existingPhone: string;
  incomingName: string;
  incomingPhone: string;
  createdAt: string;
  status: string;
};

export async function fetchDuplicates(): Promise<DuplicateReview[]> {
  return [];
}

export async function resolveDuplicate(
  _id: string,
  _action: "update_phone" | "keep_new" | "later",
): Promise<boolean> {
  return true;
}
