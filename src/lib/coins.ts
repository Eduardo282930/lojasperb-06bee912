/**
 * Moedas SPERB — guardadas no próprio cliente do Medusa (metadata),
 * sem banco de dados paralelo.
 */

import {
  adminToken,
  currentCustomer,
  ensureCustomerSession,
  isMedusaConfigured,
  medusaFetch,
  onlyDigits,
} from "@/lib/medusa";

/** Cada moeda vale R$ 0,01. */
export const COIN_VALUE = 0.01;

/** Teto de uso: 30% do valor elegível do pedido. */
export const COIN_MAX_RATIO = 0.3;

export type CoinEntry = {
  id: string;
  delta: number;
  reason: string;
  orderId: string | null;
  createdAt: string;
};

type CoinMeta = { coins?: number; coin_history?: CoinEntry[] };

export function coinsToBRL(coins: number): number {
  return Math.round(Math.max(0, coins) * COIN_VALUE * 100) / 100;
}

export function maxCoinsFor(eligible: number, balance: number): number {
  const cap = Math.floor(Math.max(0, eligible) * COIN_MAX_RATIO * 100);
  return Math.max(0, Math.min(cap, Math.max(0, Math.floor(balance))));
}

export async function fetchCoinBalance(phone: string): Promise<number> {
  if (!isMedusaConfigured() || onlyDigits(phone).length < 8) return 0;
  await ensureCustomerSession(phone, "");
  const customer = await currentCustomer();
  const meta = (customer?.metadata ?? {}) as CoinMeta;
  return Number(meta.coins ?? 0) || 0;
}

export async function fetchCoinHistory(phone: string): Promise<CoinEntry[]> {
  if (!isMedusaConfigured() || onlyDigits(phone).length < 8) return [];
  await ensureCustomerSession(phone, "");
  const customer = await currentCustomer();
  const meta = (customer?.metadata ?? {}) as CoinMeta;
  return Array.isArray(meta.coin_history) ? meta.coin_history : [];
}

/* ------------------------------- Admin ---------------------------------- */

type AdminCustomer = {
  id: string;
  email: string;
  phone?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Encontra o cliente no Medusa pelo telefone. */
export async function findCustomerId(phone: string): Promise<string | null> {
  const digits = onlyDigits(phone);
  const token = adminToken.get();
  if (digits.length < 8 || !token) return null;
  try {
    const res = await medusaFetch<{ customers: AdminCustomer[] }>("/admin/customers", {
      admin: true,
      token,
      query: { q: digits, limit: 10 },
    });
    const match = (res.customers ?? []).find(
      (c) => onlyDigits(c.phone ?? "") === digits || c.email.startsWith(`${digits}@`),
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

async function adminCustomer(customerId: string): Promise<AdminCustomer | null> {
  const token = adminToken.get();
  if (!token) return null;
  try {
    const res = await medusaFetch<{ customer: AdminCustomer }>(
      `/admin/customers/${customerId}`,
      { admin: true, token },
    );
    return res.customer;
  } catch {
    return null;
  }
}

export async function adminCoinBalance(customerId: string): Promise<number> {
  const customer = await adminCustomer(customerId);
  const meta = (customer?.metadata ?? {}) as CoinMeta;
  return Number(meta.coins ?? 0) || 0;
}

export async function adminAdjustCoins(
  customerId: string,
  delta: number,
  reason: string,
): Promise<number | null> {
  const token = adminToken.get();
  if (!token) return null;
  const customer = await adminCustomer(customerId);
  if (!customer) return null;

  const meta = (customer.metadata ?? {}) as CoinMeta;
  const current = Number(meta.coins ?? 0) || 0;
  const change = Math.max(Math.trunc(delta), -current);
  const next = current + change;
  const history: CoinEntry[] = [
    {
      id: `${Date.now()}`,
      delta: change,
      reason: reason.trim() || "ajuste manual",
      orderId: null,
      createdAt: new Date().toISOString(),
    },
    ...(Array.isArray(meta.coin_history) ? meta.coin_history : []),
  ].slice(0, 100);

  try {
    await medusaFetch(`/admin/customers/${customerId}`, {
      method: "POST",
      admin: true,
      token,
      body: { metadata: { ...(customer.metadata ?? {}), coins: next, coin_history: history } },
    });
    return next;
  } catch {
    return null;
  }
}
