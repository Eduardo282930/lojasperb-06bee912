/**
 * Cupons e perfil do cliente — 100% Medusa.js.
 *
 * Os cupons são as "promotions" do Medusa. O cliente valida o código no
 * próprio Medusa e o app apenas guarda no aparelho quais códigos ele já
 * resgatou (não existe banco de dados local).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  adminToken,
  customerToken,
  ensureCustomerSession,
  isMedusaConfigured,
  medusaFetch,
  onlyDigits,
  phoneEmail,
} from "@/lib/medusa";

export type Coupon = {
  id: string;
  code: string;
  description: string;
  type: "percent" | "fixed";
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  maxUses: number | null;
  uses: number;
  active: boolean;
  customerPhone: string | null;
};

export type Profile = { name: string; phone: string };

/* --------------------------- Promotions (Medusa) ------------------------ */

type MedusaPromotion = {
  id: string;
  code: string;
  is_automatic?: boolean | null;
  status?: string | null;
  application_method?: {
    type?: string | null;
    value?: number | string | null;
    max_quantity?: number | null;
    currency_code?: string | null;
  } | null;
};

function toCoupon(p: MedusaPromotion): Coupon {
  const method = p.application_method ?? {};
  const value = Number(method.value ?? 0) || 0;
  return {
    id: p.id,
    code: p.code,
    description: method.type === "percentage" ? `${value}% de desconto` : "Desconto",
    type: method.type === "percentage" ? "percent" : "fixed",
    value,
    maxDiscount: null,
    minOrder: 0,
    maxUses: null,
    uses: 0,
    active: (p.status ?? "active") === "active",
    customerPhone: null,
  };
}

export const COUPONS_KEY = ["coupons"] as const;
export const CLAIMED_KEY = ["coupons", "claimed"] as const;

/** Lista de promoções do Medusa (somente com sessão de administrador). */
export async function fetchCoupons(): Promise<Coupon[]> {
  const token = adminToken.get();
  if (!token || !isMedusaConfigured()) return readClaimed();
  const res = await medusaFetch<{ promotions: MedusaPromotion[] }>("/admin/promotions", {
    admin: true,
    token,
    query: { limit: 100 },
  });
  return (res.promotions ?? []).filter((p) => p.code).map(toCoupon);
}

/** Cupons exclusivos por telefone não existem no Medusa: lista vazia. */
export async function fetchCouponsForPhone(_phone: string): Promise<Coupon[]> {
  return [];
}

export async function fetchClaimedCoupons(_phone: string): Promise<Coupon[]> {
  return readClaimed();
}

export function useClaimedCoupons(phone: string) {
  return useQuery({
    queryKey: [...CLAIMED_KEY, onlyDigits(phone)],
    queryFn: () => fetchClaimedCoupons(phone),
    staleTime: 30 * 1000,
  });
}

export function useCoupons(): Coupon[] {
  const { data } = useQuery({
    queryKey: COUPONS_KEY,
    queryFn: fetchCoupons,
    staleTime: 60 * 1000,
  });
  return data ?? [];
}

export function useCouponsRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: COUPONS_KEY });
    void qc.invalidateQueries({ queryKey: CLAIMED_KEY });
  };
}

/** Cria/atualiza a promoção no Medusa (administrador). */
export async function saveCoupon(coupon: Coupon): Promise<void> {
  const token = adminToken.get();
  if (!token) throw new Error("Entre como administrador no Medusa.");
  const body = {
    code: coupon.code.trim().toUpperCase(),
    type: "standard",
    status: coupon.active ? "active" : "draft",
    application_method: {
      type: coupon.type === "percent" ? "percentage" : "fixed",
      target_type: "order",
      allocation: "across",
      value: coupon.value,
      ...(coupon.type === "fixed" ? { currency_code: "brl" } : {}),
    },
  };
  if (coupon.id) {
    await medusaFetch(`/admin/promotions/${coupon.id}`, {
      method: "POST",
      admin: true,
      token,
      body: { status: body.status, application_method: body.application_method },
    });
    return;
  }
  await medusaFetch("/admin/promotions", { method: "POST", admin: true, token, body });
}

export async function deleteCoupon(id: string): Promise<void> {
  const token = adminToken.get();
  if (!token) throw new Error("Entre como administrador no Medusa.");
  await medusaFetch(`/admin/promotions/${id}`, { method: "DELETE", admin: true, token });
}

export function isExhausted(c: Coupon): boolean {
  return c.maxUses !== null && c.uses >= c.maxUses;
}

export function isAvailable(c: Coupon): boolean {
  return c.active && !isExhausted(c);
}

/** O Medusa controla o uso das promoções; nada a fazer aqui. */
export async function consumeCoupon(_id: string): Promise<boolean> {
  return true;
}

export function discountFor(coupon: Coupon, subtotal: number): number {
  if (subtotal < coupon.minOrder) return 0;
  let raw = coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.type === "percent" && coupon.maxDiscount !== null && coupon.maxDiscount > 0) {
    raw = Math.min(raw, coupon.maxDiscount);
  }
  return Math.min(subtotal, Math.max(0, Math.round(raw * 100) / 100));
}

export function activeCouponFor(
  coupons: Coupon[],
  redeemed: string[],
  subtotal: number,
): { coupon: Coupon; discount: number } | null {
  let best: { coupon: Coupon; discount: number } | null = null;
  for (const c of coupons) {
    if (!redeemed.includes(c.id) || !isAvailable(c)) continue;
    const discount = discountFor(c, subtotal);
    if (discount > 0 && (!best || discount > best.discount)) best = { coupon: c, discount };
  }
  return best;
}

/* ------------------- Estado do aparelho (sem banco) --------------------- */

const PROFILE_KEY = "sperb-profile-v1";
const REDEEMED_KEY = "sperb-redeemed-v1";
const CLAIMED_LIST_KEY = "sperb-claimed-coupons-v1";
const DEVICE_KEY = "sperb-device-v1";

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

let profileCache: Profile = { name: "", phone: "" };
let redeemedCache: string[] = [];
let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  profileCache = readJSON<Profile>(PROFILE_KEY, { name: "", phone: "" });
  redeemedCache = readJSON<string[]>(REDEEMED_KEY, []);
  initialized = true;
}

const EMPTY_REDEEMED: string[] = [];
const EMPTY_PROFILE: Profile = { name: "", phone: "" };

function readClaimed(): Coupon[] {
  return readJSON<Coupon[]>(CLAIMED_LIST_KEY, []);
}

function writeClaimed(list: Coupon[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CLAIMED_LIST_KEY, JSON.stringify(list));
  }
}

export function deviceId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function useRedeemed(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      ensureInit();
      return redeemedCache;
    },
    () => EMPTY_REDEEMED,
  );
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    subscribe,
    () => {
      ensureInit();
      return profileCache;
    },
    () => EMPTY_PROFILE,
  );
}

/** Nome já cadastrado no Medusa para este telefone. */
export async function lookupCustomerName(phone: string): Promise<string> {
  const digits = onlyDigits(phone);
  if (digits.length < 8 || !isMedusaConfigured()) return "";
  try {
    const login = await medusaFetch<{ token: string }>("/auth/customer/emailpass", {
      method: "POST",
      body: { email: phoneEmail(digits), password: `sperb-${digits}` },
    });
    customerToken.set(login.token);
    const me = await medusaFetch<{ customer: { first_name?: string | null } }>(
      "/store/customers/me",
      { token: login.token },
    );
    return me.customer.first_name?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Salva o cliente no Medusa (conta criada a partir do telefone). */
export async function saveProfile(profile: Profile): Promise<void> {
  ensureInit();
  const registered = await lookupCustomerName(profile.phone);
  const finalProfile: Profile = registered ? { ...profile, name: registered } : profile;
  profileCache = finalProfile;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(finalProfile));
  }
  emit();
  const customer = await ensureCustomerSession(finalProfile.phone, finalProfile.name);
  if (!customer && isMedusaConfigured()) {
    throw new Error("Não foi possível salvar seu cadastro no Medusa.");
  }
}

/** Valida o código no Medusa e guarda o cupom neste aparelho. */
export async function redeemCouponCode(code: string): Promise<Coupon | null> {
  const clean = code.trim().toUpperCase();
  if (!clean || !isMedusaConfigured()) return null;
  try {
    const res = await medusaFetch<{ promotions: MedusaPromotion[] }>("/store/promotions", {
      query: { code: clean },
    });
    const found = (res.promotions ?? []).find(
      (p) => p.code?.toUpperCase() === clean,
    );
    if (!found) return null;
    const coupon = toCoupon(found);
    const list = readClaimed().filter((c) => c.code !== coupon.code);
    writeClaimed([coupon, ...list]);
    redeemCoupon(coupon.id);
    return coupon;
  } catch {
    return null;
  }
}

/** Vincula o cupom a este cliente/aparelho. */
export async function claimCoupon(couponId: string, _phone: string): Promise<boolean> {
  const all = await fetchCoupons();
  const coupon = all.find((c) => c.id === couponId);
  if (!coupon) return false;
  const list = readClaimed().filter((c) => c.id !== coupon.id);
  writeClaimed([coupon, ...list]);
  redeemCoupon(coupon.id);
  return true;
}

export function redeemCoupon(id: string) {
  ensureInit();
  if (redeemedCache.includes(id)) return;
  redeemedCache = [...redeemedCache, id];
  if (typeof window !== "undefined") {
    window.localStorage.setItem(REDEEMED_KEY, JSON.stringify(redeemedCache));
  }
  emit();
}

export function unredeemCoupon(id: string) {
  ensureInit();
  redeemedCache = redeemedCache.filter((r) => r !== id);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(REDEEMED_KEY, JSON.stringify(redeemedCache));
  }
  emit();
}
