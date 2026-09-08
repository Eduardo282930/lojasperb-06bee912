import { supabase } from "@/integrations/supabase/client";
import { deviceId } from "@/lib/coupons";

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
  updatedAt: string;
  customerName: string;
  customerPhone: string;
  couponCode: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod?: string;
  paymentUrl?: string | null;
  receiptUrl?: string | null;
  paymentProvider?: string;
  paymentDeadlineAt?: string | null;
  refundState?: string;
  refundProofUrl?: string | null;
  /** Identificadores oficiais da transação InfinitePay. */
  paymentOrderNsu?: string | null;
  paymentTransactionNsu?: string | null;
  paymentSlug?: string | null;
  /** "store" quando a venda foi feita pelo vendedor no balcão. */
  origin?: string;
  /** Como o cliente pagou na loja: Dinheiro, Pix, Cartão… */
  paymentTypeLabel?: string | null;
  coinsUsed?: number;
  coinsDiscount?: number;
  sellerDiscount?: number;
  /** Opção escolhida no Loyverse: Consumir no local, Entrega… */
  diningOption?: string | null;
};

/** true quando o pedido foi lançado pelo vendedor na loja física. */
export function isStoreOrder(order: { origin?: string }): boolean {
  return order.origin === "store";
}

/** Pagamento na entrega tem rótulo próprio, nunca aparece só como "Pago". */
export function paymentDisplayLabel(order: {
  paymentStatus: string;
  paymentMethod?: string;
  origin?: string;
  paymentTypeLabel?: string | null;
}): string {
  if (order.paymentStatus === "paid" && order.paymentMethod === "delivery") {
    return "Pagamento na entrega";
  }
  if (order.paymentStatus === "paid" && isStoreOrder(order)) {
    const tipo = (order.paymentTypeLabel ?? "").trim();
    return tipo ? `Pago na loja · ${tipo}` : "Pago na loja";
  }
  return paymentLabel(order.paymentStatus);
}

/** Minutos restantes do prazo de pagamento (0 quando não há prazo). */
export function minutesLeftToPay(order: {
  paymentStatus: string;
  status: string;
  paymentDeadlineAt?: string | null;
}): number {
  if (order.paymentStatus === "paid" || order.status === "canceled") return 0;
  const t = order.paymentDeadlineAt ? Date.parse(order.paymentDeadlineAt) : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - Date.now()) / 60000));
}

/* ------------------------- Status do pedido ---------------------------- */

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
  { value: "refunded", label: "Reembolsado" },
] as const;

export function statusLabel(v: string): string {
  return ORDER_STATUSES.find((s) => s.value === v)?.label ?? "Pedido recebido";
}

/** Rótulo que o cliente vê: pedido sem pagamento ainda não é "recebido". */
export function displayStatusLabel(order: {
  status: string;
  paymentStatus: string;
}): string {
  // Reembolso feito no Loyverse: o cliente vê cancelado e reembolsado.
  if (order.paymentStatus === "refunded") return "Reembolsado e cancelado";
  if (order.status === "canceled") return "Cancelado";
  if (order.status === "sent" && order.paymentStatus !== "paid") {
    return "Aguardando pagamento";
  }
  return statusLabel(order.status);
}

export function paymentLabel(v: string): string {
  return PAYMENT_STATUSES.find((s) => s.value === v)?.label ?? "Aguardando pagamento";
}

/** Registers the WhatsApp order so it shows up in the admin panel. */
export async function recordOrder(input: {
  name: string;
  phone: string;
  email?: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string;
  coins?: number;
  /** Reserva temporária criada em "Fazer pedido" (vira reserva do pedido). */
  holdId?: string;
}): Promise<string | null> {
  const args = {
    p_device_id: deviceId(),
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email ?? "",
    p_items: input.items,
    p_subtotal: input.subtotal,
    p_discount: input.discount,
    p_total: input.total,
    p_coupon_code: input.couponCode,
    p_coins: Math.max(0, Math.trunc(input.coins ?? 0)),
  };
  const call = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    a: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
  const { data, error } = input.holdId
    ? await call("create_order_from_hold", { p_hold_id: input.holdId, ...args })
    : await call("create_order", args);
  if (error) {
    console.warn("[recordOrder] falhou", error);
    return null;
  }
  return (data as string | null) ?? null;
}


function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function toItems(raw: unknown): OrderItem[] {
  return Array.isArray(raw) ? (raw as unknown as OrderItem[]) : [];
}

/** Admin-only: every order sent through the app. */
export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: (r as { updated_at?: string }).updated_at ?? r.created_at,
    customerName: r.customer_name ?? "",
    customerPhone: r.customer_phone ?? "",
    couponCode: r.coupon_code ?? "",
    items: toItems(r.items),
    subtotal: num(r.subtotal),
    discount: num(r.discount),
    total: num(r.total),
    status: r.status,
    paymentStatus: (r as { payment_status?: string }).payment_status ?? "pending",
    paymentMethod: (r as { payment_method?: string }).payment_method ?? "",
    paymentUrl: (r as { payment_url?: string | null }).payment_url ?? null,
    receiptUrl: (r as { payment_receipt_url?: string | null }).payment_receipt_url ?? null,
    paymentProvider: (r as { payment_provider?: string }).payment_provider ?? "",
    paymentDeadlineAt:
      (r as { payment_deadline_at?: string | null }).payment_deadline_at ?? null,
    refundState: (r as { refund_state?: string }).refund_state ?? "none",
    refundProofUrl: (r as { refund_proof_url?: string | null }).refund_proof_url ?? null,
    paymentOrderNsu:
      (r as { payment_order_nsu?: string | null }).payment_order_nsu ??
      (r as { payment_nsu?: string | null }).payment_nsu ??
      null,
    paymentTransactionNsu:
      (r as { payment_transaction_nsu?: string | null }).payment_transaction_nsu ??
      (r as { payment_id?: string | null }).payment_id ??
      null,
    paymentSlug: (r as { payment_slug?: string | null }).payment_slug ?? null,
    origin: (r as { origin?: string }).origin ?? "app",
    paymentTypeLabel:
      (r as { payment_type_label?: string | null }).payment_type_label ?? null,
    coinsUsed: num((r as { coins_used?: number }).coins_used),
    coinsDiscount: num((r as { coins_discount?: number }).coins_discount),
    sellerDiscount: num((r as { seller_discount?: number }).seller_discount),
  }));
}

/** Customer area: only the orders of this device / phone number. */
export async function fetchMyOrders(phone: string): Promise<Order[]> {
  const { data, error } = await supabase.rpc("orders_for_customer", {
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: (r as { updated_at?: string }).updated_at ?? r.created_at,
    customerName: r.customer_name ?? "",
    customerPhone: phone,
    couponCode: r.coupon_code ?? "",
    items: toItems(r.items),
    subtotal: num(r.subtotal),
    discount: num(r.discount),
    total: num(r.total),
    status: r.status,
    paymentStatus: r.payment_status ?? "pending",
    paymentMethod: (r as { payment_method?: string }).payment_method ?? "",
    paymentProvider: (r as { payment_provider?: string }).payment_provider ?? "",
    paymentDeadlineAt:
      (r as { payment_deadline_at?: string | null }).payment_deadline_at ?? null,
    receiptUrl:
      (r as { payment_receipt_url?: string | null }).payment_receipt_url ?? null,
    refundState: (r as { refund_state?: string }).refund_state ?? "none",
    refundProofUrl: (r as { refund_proof_url?: string | null }).refund_proof_url ?? null,
    origin: (r as { origin?: string }).origin ?? "app",
    paymentTypeLabel:
      (r as { payment_type_label?: string | null }).payment_type_label ?? null,
    coinsUsed: num((r as { coins_used?: number }).coins_used),
    coinsDiscount: num((r as { coins_discount?: number }).coins_discount),
    sellerDiscount: num((r as { seller_discount?: number }).seller_discount),
  }));
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
  const { data, error } = await supabase.rpc("order_history_for_customer", {
    p_order_id: orderId,
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
  if (error) return [];
  return (data ?? []).map((r) => ({
    status: r.status,
    paymentStatus: r.payment_status ?? null,
    note: r.note ?? "",
    createdAt: r.created_at,
  }));
}

/** Admin-only: changes the order status and records it in the history. */
export async function setOrderStatus(
  orderId: string,
  status: string,
  paymentStatus: string,
  note = "",
): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_set_order_status", {
    p_order_id: orderId,
    p_status: status,
    p_payment_status: paymentStatus,
    p_note: note,
  });
  if (error) return false;
  return Boolean(data);
}

/** Admin-only: marca o pedido como "Pagamento na entrega" (segue como pago). */
export async function setPayOnDelivery(orderId: string): Promise<boolean> {
  const call = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    a: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
  const { data, error } = await call("admin_set_pay_on_delivery", { p_order_id: orderId });
  if (error) return false;
  return Boolean(data);
}

/** Admin-only: confirma o reembolso feito no InfinitePay e anexa o comprovante. */
export async function confirmRefund(
  orderId: string,
  proofUrl: string,
  amount?: number,
): Promise<boolean> {
  const call = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    a: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
  const { data, error } = await call("admin_confirm_refund", {
    p_order_id: orderId,
    p_proof_url: proofUrl,
    p_amount: amount ?? null,
  });
  if (error) return false;
  return Boolean(data);
}

/** Cancela pedidos online que passaram dos 60 minutos e libera as reservas. */
export async function cancelExpiredUnpaidOrders(): Promise<number> {
  const call = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    a: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
  const { data, error } = await call("cancel_expired_unpaid_orders", {});
  if (error) return 0;
  return Number(data ?? 0);
}

/**
 * Regras de avanço do pedido:
 * Recebido → Preparando → A caminho → Entregue (sem voltar),
 * exceto Preparando → Recebido, permitido só nos 5 primeiros minutos.
 */
const RANK: Record<string, number> = {
  sent: 1,
  preparing: 2,
  shipping: 3,
  delivered: 4,
  canceled: 9,
};

export function canChangeStatus(
  order: { status: string; createdAt?: string },
  next: string,
  preparingAt?: string | null,
): boolean {
  if (next === order.status) return true;
  if (order.status === "delivered" || order.status === "canceled") return false;
  if (next === "canceled") return true;
  if ((RANK[next] ?? 0) > (RANK[order.status] ?? 0)) return true;
  if (order.status === "preparing" && next === "sent") {
    const t = preparingAt ? Date.parse(preparingAt) : NaN;
    return Number.isFinite(t) && Date.now() - t < 5 * 60 * 1000;
  }
  return false;
}


/* --------------------- Revisão de clientes duplicados ------------------- */

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
  const { data, error } = await supabase
    .from("customer_duplicates")
    .select("id, incoming_name, incoming_phone, created_at, status, existing_customer_id")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((r) => r.existing_customer_id).filter(Boolean) as string[];
  const names = new Map<string, { name: string; phone: string }>();
  if (ids.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, name, phone")
      .in("id", ids);
    (cs ?? []).forEach((c) => names.set(c.id, { name: c.name, phone: c.phone }));
  }
  return rows.map((r) => {
    const existing = r.existing_customer_id ? names.get(r.existing_customer_id) : undefined;
    return {
      id: r.id,
      existingName: existing?.name ?? "—",
      existingPhone: existing?.phone ?? "",
      incomingName: r.incoming_name ?? "",
      incomingPhone: r.incoming_phone ?? "",
      createdAt: r.created_at,
      status: r.status,
    };
  });
}

export async function resolveDuplicate(
  id: string,
  action: "update_phone" | "keep_new" | "later",
): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_resolve_duplicate", {
    p_id: id,
    p_action: action,
  });
  if (error) return false;
  return Boolean(data);
}

export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** Somente administrador: apaga os pedidos de um cliente de teste. */
export async function deleteCustomerOrders(phone: string): Promise<number> {
  const { data, error } = await supabase.rpc("admin_delete_customer_orders", {
    p_phone: phone,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
