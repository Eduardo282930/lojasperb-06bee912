import { supabase } from "@/integrations/supabase/client";
import { deviceId } from "@/lib/coupons";

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

export function coinsToBRL(coins: number): number {
  return Math.round(Math.max(0, coins) * COIN_VALUE * 100) / 100;
}

/** Quantas moedas podem ser usadas num pedido, dado o saldo e o valor elegível. */
export function maxCoinsFor(eligible: number, balance: number): number {
  const cap = Math.floor(Math.max(0, eligible) * COIN_MAX_RATIO * 100);
  return Math.max(0, Math.min(cap, Math.max(0, Math.floor(balance))));
}

export async function fetchCoinBalance(phone: string): Promise<number> {
  const { data, error } = await supabase.rpc("coin_balance_for_customer", {
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
  if (error) return 0;
  return Number(data ?? 0);
}

export async function fetchCoinHistory(phone: string): Promise<CoinEntry[]> {
  const { data, error } = await supabase.rpc("coin_history_for_customer", {
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    delta: Number(r.delta ?? 0),
    reason: r.reason ?? "",
    orderId: r.order_id ?? null,
    createdAt: r.created_at,
  }));
}

/* ------------------------------ Admin -------------------------------- */

/** Encontra o cliente central pelo telefone (usado no painel administrativo). */
export async function findCustomerId(phone: string): Promise<string | null> {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const { data, error } = await supabase.rpc("resolve_customer", {
    p_device_id: "",
    p_phone: digits,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

export async function adminCoinBalance(customerId: string): Promise<number> {
  const { data, error } = await supabase.rpc("admin_coin_balance", {
    p_customer_id: customerId,
  });
  if (error) return 0;
  return Number(data ?? 0);
}

export async function adminAdjustCoins(
  customerId: string,
  delta: number,
  reason: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("admin_adjust_coins", {
    p_customer_id: customerId,
    p_delta: Math.trunc(delta),
    p_reason: reason,
  });
  if (error) return null;
  return data === null ? null : Number(data);
}
