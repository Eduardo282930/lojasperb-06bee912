import { createServerFn } from "@tanstack/react-start";

/** Customer registration + receipts sync with Loyverse. */

export type ReceiptLine = {
  name: string;
  quantity: number;
  total: number;
};

export type SimpleReceipt = {
  id: string;
  number: string;
  date: string;
  total: number;
  customerName: string;
  customerPhone: string;
  lines: ReceiptLine[];
};

function digits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

async function loyverse<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`https://api.loyverse.com/v1.0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Loyverse ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

type LoyverseCustomer = {
  id: string;
  name?: string | null;
  phone_number?: string | null;
  customer_code?: string | null;
};

/**
 * Creates or updates the customer in the Loyverse "Clientes" tab.
 * Matching is done by phone number so the same person is never duplicated.
 */
export const syncLoyverseCustomer = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; phone: string }) => ({
    name: String(data?.name ?? "").trim().slice(0, 80),
    phone: String(data?.phone ?? "").trim().slice(0, 30),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; id?: string }> => {
    const token = process.env["LOYVERSE_TOKEN"];
    if (!token) return { ok: false };
    if (!data.name && !data.phone) return { ok: false };

    const phone = digits(data.phone);
    let existing: LoyverseCustomer | undefined;
    try {
      const list = await loyverse<{ customers?: LoyverseCustomer[] }>(
        "customers?limit=250",
        token,
      );
      existing = (list.customers ?? []).find(
        (c) => phone && digits(c.phone_number ?? "") === phone,
      );
    } catch {
      existing = undefined;
    }

    const body: Record<string, unknown> = {
      name: data.name || `Cliente ${phone.slice(-4)}`,
      phone_number: data.phone || undefined,
    };
    if (existing) body.id = existing.id;

    try {
      const saved = await loyverse<LoyverseCustomer>("customers", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { ok: true, id: saved.id };
    } catch {
      return { ok: false };
    }
  });

type LoyverseReceipt = {
  receipt_number: string;
  receipt_date: string;
  total_money?: number | null;
  customer_id?: string | null;
  cancelled_at?: string | null;
  line_items?: Array<{
    item_name?: string | null;
    quantity?: number | null;
    total_money?: number | null;
  }>;
};

/** Last sales made in Loyverse, already matched to the customer name/phone. */
export const fetchReceipts = createServerFn({ method: "GET" }).handler(
  async (): Promise<SimpleReceipt[]> => {
    const token = process.env["LOYVERSE_TOKEN"];
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");

    const [receiptsRes, customersRes] = await Promise.all([
      loyverse<{ receipts?: LoyverseReceipt[] }>("receipts?limit=100", token),
      loyverse<{ customers?: LoyverseCustomer[] }>("customers?limit=250", token).catch(
        () => ({ customers: [] as LoyverseCustomer[] }),
      ),
    ]);

    const byId = new Map<string, LoyverseCustomer>();
    for (const c of customersRes.customers ?? []) byId.set(c.id, c);

    return (receiptsRes.receipts ?? [])
      .filter((r) => !r.cancelled_at)
      .map((r) => {
        const c = r.customer_id ? byId.get(r.customer_id) : undefined;
        return {
          id: r.receipt_number,
          number: r.receipt_number,
          date: r.receipt_date,
          total: Number(r.total_money) || 0,
          customerName: c?.name?.trim() || "Cliente não identificado",
          customerPhone: c?.phone_number ?? "",
          lines: (r.line_items ?? []).map((l) => ({
            name: l.item_name?.trim() || "Item",
            quantity: Number(l.quantity) || 0,
            total: Number(l.total_money) || 0,
          })),
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  },
);

export type SimpleCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalSpent: number;
  totalVisits: number;
};

/** Every customer registered in the Loyverse "Clientes" tab. */
export const fetchLoyverseCustomers = createServerFn({ method: "GET" }).handler(
  async (): Promise<SimpleCustomer[]> => {
    const token = process.env["LOYVERSE_TOKEN"];
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");

    const list = await loyverse<{
      customers?: Array<
        LoyverseCustomer & {
          email?: string | null;
          total_spent?: number | null;
          total_visits?: number | null;
        }
      >;
    }>("customers?limit=250", token);

    const customers = (list.customers ?? [])
      .map((c) => ({
        id: c.id,
        name: c.name?.trim() || "Cliente sem nome",
        phone: c.phone_number ?? "",
        email: c.email ?? "",
        totalSpent: Number(c.total_spent) || 0,
        totalVisits: Number(c.total_visits) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    // Espelha os clientes no Supabase (fonte central para o ERP), sem duplicar.
    try {
      const { persistLoyverseCustomers } = await import("./catalog-cache.server");
      await persistLoyverseCustomers(customers);
    } catch (err) {
      console.error("[Clientes] falha ao sincronizar com Supabase:", err);
    }

    return customers;
  },
);

/** Importa todos os clientes do Loyverse para o Supabase (sem duplicar). */
export const syncCustomersToSupabase = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; saved: number }> => {
    const token = process.env["LOYVERSE_TOKEN"];
    if (!token) return { ok: false, saved: 0 };
    try {
      const list = await loyverse<{
        customers?: Array<LoyverseCustomer & { email?: string | null }>;
      }>("customers?limit=250", token);
      const { persistLoyverseCustomers } = await import("./catalog-cache.server");
      const saved = await persistLoyverseCustomers(
        (list.customers ?? []).map((c) => ({
          id: c.id,
          name: c.name?.trim() ?? "",
          phone: c.phone_number ?? "",
          email: c.email ?? "",
        })),
      );
      return { ok: true, saved };
    } catch (err) {
      console.error("[Clientes] sync falhou:", err);
      return { ok: false, saved: 0 };
    }
  },
);

