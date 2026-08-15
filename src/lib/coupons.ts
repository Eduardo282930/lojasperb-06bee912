import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export function useCoupons(): Coupon[] {
  const { data } = useQuery({
    queryKey: COUPONS_KEY,
    queryFn: fetchCoupons,
    staleTime: 15 * 1000,
  });
  return data ?? [];
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
  };
  if (coupon.id) {
    const { error } = await supabase.from("coupons").update(payload).eq("id", coupon.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("coupons").insert(payload);
  if (error) throw error;
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

/** Saves the customer in the database and keeps a local copy for offline use. */
export async function saveProfile(profile: Profile): Promise<void> {
  ensureInit();
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
