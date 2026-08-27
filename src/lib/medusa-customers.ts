/**
 * Clientes e recibos (pedidos) da Admin API do Medusa.js.
 */

import { adminToken, medusaFetch, onlyDigits } from "@/lib/medusa";

export type ReceiptLine = { name: string; quantity: number; total: number };

export type SimpleReceipt = {
  id: string;
  number: string;
  date: string;
  total: number;
  customerName: string;
  customerPhone: string;
  lines: ReceiptLine[];
};

export type SimpleCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalSpent: number;
  totalVisits: number;
};

type AdminOrder = {
  id: string;
  display_id?: number;
  created_at: string;
  total?: number | null;
  customer?: { first_name?: string | null; last_name?: string | null; phone?: string | null; email?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  items?: Array<{
    title?: string | null;
    product_title?: string | null;
    quantity?: number | null;
    total?: number | null;
    unit_price?: number | null;
  }> | null;
};

/** Últimas vendas registradas no Medusa. */
export async function fetchReceipts(): Promise<SimpleReceipt[]> {
  const token = adminToken.get();
  if (!token) return [];
  const res = await medusaFetch<{ orders: AdminOrder[] }>("/admin/orders", {
    admin: true,
    token,
    query: { limit: 100, order: "-created_at", fields: "*items,*customer" },
  });
  return (res.orders ?? []).map((o) => {
    const meta = (o.metadata ?? {}) as { customer_name?: string; customer_phone?: string };
    return {
      id: o.id,
      number: String(o.display_id ?? o.id.slice(-6)),
      date: o.created_at,
      total: Number(o.total) || 0,
      customerName:
        [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim() ||
        meta.customer_name ||
        "Cliente não identificado",
      customerPhone: o.customer?.phone ?? meta.customer_phone ?? "",
      lines: (o.items ?? []).map((i) => ({
        name: (i.product_title ?? i.title ?? "Item").trim(),
        quantity: Number(i.quantity) || 0,
        total: Number(i.total ?? (Number(i.unit_price) || 0) * (Number(i.quantity) || 0)) || 0,
      })),
    };
  });
}

type AdminCustomer = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Todos os clientes cadastrados no Medusa. */
export async function fetchCustomers(): Promise<SimpleCustomer[]> {
  const token = adminToken.get();
  if (!token) return [];
  const [customersRes, receipts] = await Promise.all([
    medusaFetch<{ customers: AdminCustomer[] }>("/admin/customers", {
      admin: true,
      token,
      query: { limit: 200 },
    }),
    fetchReceipts().catch(() => [] as SimpleReceipt[]),
  ]);

  const byPhone = new Map<string, { spent: number; visits: number }>();
  for (const r of receipts) {
    const key = onlyDigits(r.customerPhone);
    if (!key) continue;
    const cur = byPhone.get(key) ?? { spent: 0, visits: 0 };
    byPhone.set(key, { spent: cur.spent + r.total, visits: cur.visits + 1 });
  }

  return (customersRes.customers ?? [])
    .map((c) => {
      const phone = c.phone ?? c.email.split("@")[0] ?? "";
      const stats = byPhone.get(onlyDigits(phone)) ?? { spent: 0, visits: 0 };
      return {
        id: c.id,
        name:
          [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Cliente sem nome",
        phone,
        email: c.email,
        totalSpent: stats.spent,
        totalVisits: stats.visits,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
