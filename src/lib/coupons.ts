import { useSyncExternalStore } from "react";

export type Coupon = {
  id: string;
  code: string;
  description: string;
  type: "percent" | "fixed";
  value: number;
  minOrder: number;
  maxUses: number | null;
  uses: number;
  active: boolean;
};

export type Profile = {
  name: string;
  phone: string;
};

const COUPONS_KEY = "sperb-coupons-v1";
const PROFILE_KEY = "sperb-profile-v1";
const REDEEMED_KEY = "sperb-redeemed-v1";

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
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

function writeJSON(key: string, value: unknown) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
  emit();
}

let couponsCache: Coupon[] = [];
let profileCache: Profile = { name: "", phone: "" };
let redeemedCache: string[] = [];
let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  couponsCache = readJSON<Coupon[]>(COUPONS_KEY, []);
  profileCache = readJSON<Profile>(PROFILE_KEY, { name: "", phone: "" });
  redeemedCache = readJSON<string[]>(REDEEMED_KEY, []);
  initialized = true;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY_COUPONS: Coupon[] = [];
const EMPTY_REDEEMED: string[] = [];
const EMPTY_PROFILE: Profile = { name: "", phone: "" };

export function useCoupons(): Coupon[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      ensureInit();
      return couponsCache;
    },
    () => EMPTY_COUPONS,
  );
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

export function saveProfile(profile: Profile) {
  ensureInit();
  profileCache = profile;
  writeJSON(PROFILE_KEY, profile);
}

export function saveCoupon(coupon: Coupon) {
  ensureInit();
  const exists = couponsCache.some((c) => c.id === coupon.id);
  couponsCache = exists
    ? couponsCache.map((c) => (c.id === coupon.id ? coupon : c))
    : [...couponsCache, coupon];
  writeJSON(COUPONS_KEY, couponsCache);
}

export function deleteCoupon(id: string) {
  ensureInit();
  couponsCache = couponsCache.filter((c) => c.id !== id);
  writeJSON(COUPONS_KEY, couponsCache);
}

export function isExhausted(c: Coupon): boolean {
  return c.maxUses !== null && c.uses >= c.maxUses;
}

export function isAvailable(c: Coupon): boolean {
  return c.active && !isExhausted(c);
}

export function redeemCoupon(id: string) {
  ensureInit();
  if (redeemedCache.includes(id)) return;
  redeemedCache = [...redeemedCache, id];
  writeJSON(REDEEMED_KEY, redeemedCache);
}

export function unredeemCoupon(id: string) {
  ensureInit();
  redeemedCache = redeemedCache.filter((r) => r !== id);
  writeJSON(REDEEMED_KEY, redeemedCache);
}

/** Marks one use of the coupon (called when the order is sent). */
export function consumeCoupon(id: string) {
  ensureInit();
  couponsCache = couponsCache.map((c) =>
    c.id === id ? { ...c, uses: c.uses + 1 } : c,
  );
  writeJSON(COUPONS_KEY, couponsCache);
}

export function discountFor(coupon: Coupon, subtotal: number): number {
  if (subtotal < coupon.minOrder) return 0;
  const raw =
    coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
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

export const OWNER_PASSWORD = "2829";
