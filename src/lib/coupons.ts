import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncLoyverseCustomer } from "@/lib/loyverse-customers.functions";

export type Coupon = {
  id: string;
  code: string;
  description: string;
  type: "percent" | "fixed";
  value: number;
  /** Only for percent coupons: caps the discount in R$. null = no cap. */
  maxDiscount: number | null;
  minOrder: number;
  maxUses: number | null;
  uses: number;
  active: boolean;
  /** When set, the coupon is exclusive to this customer's phone. */
  customerPhone: string | null;
};

export type Profile = {
  name: string;
  phone: string;
};

type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  type: string;
  value: number | string | null;
  max_discount: number | string | null;
  min_order: number | string | null;
  max_uses: number | null;
  uses: number | null;
  active: boolean;
  customer_phone?: string | null;
};

function num(v: number | string | null | undefined, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function toCoupon(r: CouponRow): Coupon {
  return {
    id: r.id,
    code: r.code,
    description: r.description ?? "",
    type: r.type === "fixed" ? "fixed" : "percent",
    value: num(r.value),
    maxDiscount: r.max_discount === null ? null : num(r.max_discount),
    minOrder: num(r.min_order),
    maxUses: r.max_uses ?? null,
    uses: r.uses ?? 0,
    active: r.active,
    customerPhone: r.customer_phone ?? null,
  };
}

export const COUPONS_KEY = ["coupons"] as const;

async function fetchCoupons(): Promise<Coupon[]> {
  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CouponRow[]).map(toCoupon);
}

/** Coupons that belong exclusively to one phone number. */
export async function fetchCouponsForPhone(phone: string): Promise<Coupon[]> {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 8) return [];
  const { data, error } = await supabase.rpc("coupons_for_phone", { p_phone: digits });
  if (error) return [];
  return ((data ?? []) as CouponRow[]).map(toCoupon);
}

/** Cupons já resgatados por este cliente (vínculo permanente no banco). */
export const CLAIMED_KEY = ["coupons", "claimed"] as const;

export async function fetchClaimedCoupons(phone: string): Promise<Coupon[]> {
  const { data, error } = await supabase.rpc("coupons_claimed_for_customer", {
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
  if (error) return [];
  return ((data ?? []) as CouponRow[]).map(toCoupon);
}

/** Vincula o cupom permanentemente ao cliente. */
export async function claimCoupon(couponId: string, phone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_coupon", {
    p_device_id: deviceId(),
    p_phone: phone || "",
    p_coupon_id: couponId,
  });
  if (error) return false;
  return Boolean(data);
}

export function useClaimedCoupons(phone: string) {
  return useQuery({
    queryKey: [...CLAIMED_KEY, (phone || "").replace(/\D/g, "")],
    queryFn: () => fetchClaimedCoupons(phone),
    staleTime: 30 * 1000,
  });
}

export function useCoupons(): Coupon[] {
  const phone = useProfile().phone;
  const { data } = useQuery({
    queryKey: COUPONS_KEY,
    queryFn: fetchCoupons,
    staleTime: 60 * 1000,
  });
  const { data: mine } = useQuery({
    queryKey: [...COUPONS_KEY, "phone", (phone || "").replace(/\D/g, "")],
    queryFn: () => fetchCouponsForPhone(phone),
    staleTime: 60 * 1000,
    enabled: (phone || "").replace(/\D/g, "").length >= 8,
  });
  const all = [...(data ?? []), ...(mine ?? [])];
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export function useCouponsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: COUPONS_KEY });
}

export async function saveCoupon(coupon: Coupon): Promise<void> {
  const payload = {
    code: coupon.code,
    description: coupon.description,
    type: coupon.type,
    value: coupon.value,
    max_discount: coupon.type === "percent" ? coupon.maxDiscount : null,
    min_order: coupon.minOrder,
    max_uses: coupon.maxUses,
    active: coupon.active,
    customer_phone: coupon.customerPhone
      ? coupon.customerPhone.replace(/\D/g, "")
      : null,
  };

  if (coupon.id) {
    const { error } = await supabase.from("coupons").update(payload).eq("id", coupon.id);
    if (error) {
      console.error("[Supabase] saveCoupon update failed", error);
      throw error;
    }
    return;
  }

  const { error } = await supabase.from("coupons").insert(payload);
  if (error) {
    console.error("[Supabase] saveCoupon insert failed", error);
    throw error;
  }
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await supabase.from("coupons").delete().eq("id", id);
  if (error) throw error;
}

export function isExhausted(c: Coupon): boolean {
  return c.maxUses !== null && c.uses >= c.maxUses;
}

export function isAvailable(c: Coupon): boolean {
  return c.active && !isExhausted(c);
}

/** Marks one use of the coupon (called when the order is sent). Global. */
export async function consumeCoupon(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_coupon", { p_coupon_id: id });
  if (error) return false;
  return Boolean(data);
}

export function discountFor(coupon: Coupon, subtotal: number): number {
  if (subtotal < coupon.minOrder) return 0;
  let raw = coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.type === "percent" && coupon.maxDiscount !== null && coupon.maxDiscount > 0) {
    raw = Math.min(raw, coupon.maxDiscount);
  }
  return Math.min(subtotal, Math.max(0, Math.round(raw * 100) / 100));
}

/** Best redeemed + usable coupon for the given subtotal. */
export function activeCouponFor(
  coupons: Coupon[],
  redeemed: string[],
  subtotal: number,
): { coupon: Coupon; discount: number } | null {
  let best: { coupon: Coupon; discount: number } | null = null;
  for (const c of coupons) {
    if (!redeemed.includes(c.id) || !isAvailable(c)) continue;
    const discount = discountFor(c, subtotal);
    if (discount > 0 && (!best || discount > best.discount)) {
      best = { coupon: c, discount };
    }
  }
  return best;
}

/* ---------------------------------------------------------------------- */
/* Local-only state: which coupons this device redeemed + cached profile.  */
/* The profile itself is persisted in the database via save_customer().    */
/* ---------------------------------------------------------------------- */

const PROFILE_KEY = "sperb-profile-v1";
const REDEEMED_KEY = "sperb-redeemed-v1";
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
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
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
  const [state, setState] = useState<string[]>(EMPTY_REDEEMED);
  useEffect(() => {
    ensureInit();
    setState(redeemedCache);
    return subscribe(() => setState(redeemedCache));
  }, []);
  return state;
}

export function useProfile(): Profile {
  const [state, setState] = useState<Profile>(EMPTY_PROFILE);
  useEffect(() => {
    ensureInit();
    setState(profileCache);
    return subscribe(() => setState(profileCache));
  }, []);
  return state;
}


/** Saves the customer in the database, Loyverse, and keeps a local copy. */
/** Name already registered for a phone number (locked by the store). */
export async function lookupCustomerName(phone: string): Promise<string> {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  const { data, error } = await supabase.rpc("lookup_customer_name", { p_phone: digits });
  if (error) return "";
  return (data as string | null) ?? "";
}

export async function saveProfile(profile: Profile): Promise<void> {
  ensureInit();
  const locked = await lookupCustomerName(profile.phone);
  if (locked) profile = { ...profile, name: locked };
  profileCache = profile;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }
  emit();
  const { error } = await supabase.rpc("save_customer", {
    p_device_id: deviceId(),
    p_name: profile.name,
    p_phone: profile.phone,
  });
  if (error) throw error;
  // Mirror the customer into the Loyverse "Clientes" tab (never blocks saving).
  try {
    await syncLoyverseCustomer({ data: { name: profile.name, phone: profile.phone } });
  } catch (err) {
    console.warn("[saveProfile] Loyverse sync falhou", err);
  }
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
