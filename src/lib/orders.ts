import { supabase } from "@/integrations/supabase/client";
import { deviceId } from "@/lib/coupons";

export type OrderItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
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
};

/** Registers the WhatsApp order so it shows up in the admin panel. */
export async function recordOrder(input: {
  name: string;
  phone: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string;
}): Promise<void> {
  const { error } = await supabase.rpc("create_order", {
    p_device_id: deviceId(),
    p_name: input.name,
    p_phone: input.phone,
    p_items: input.items,
    p_subtotal: input.subtotal,
    p_discount: input.discount,
    p_total: input.total,
    p_coupon_code: input.couponCode,
  });
  if (error) console.warn("[recordOrder] falhou", error);
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
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
    customerName: r.customer_name ?? "",
    customerPhone: r.customer_phone ?? "",
    couponCode: r.coupon_code ?? "",
    items: Array.isArray(r.items) ? (r.items as unknown as OrderItem[]) : [],
    subtotal: num(r.subtotal),
    discount: num(r.discount),
    total: num(r.total),
    status: r.status,
  }));
}

export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}
