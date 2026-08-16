import { useSyncExternalStore } from "react";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  stock?: number;
  image?: string | null;
};

const KEY = "sperb-cart-v1";
const listeners = new Set<() => void>();

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let cache: CartItem[] = [];
let initialized = false;

function ensureInit() {
  if (!initialized && typeof window !== "undefined") {
    cache = read();
    initialized = true;
  }
}

function write(next: CartItem[]) {
  cache = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  }
  listeners.forEach((l) => l());
}

function limitOf(item: Pick<CartItem, "stock">): number {
  const s = item.stock;
  if (typeof s !== "number" || !Number.isFinite(s)) return 999;
  return Math.max(0, Math.floor(s));
}

/** Adds `amount` units, never exceeding available stock. Returns true if added. */
export function addToCart(
  item: Omit<CartItem, "qty">,
  amount = 1,
): boolean {
  ensureInit();
  const max = limitOf(item);
  if (max <= 0) return false;
  const existing = cache.find((c) => c.id === item.id);
  const current = existing?.qty ?? 0;
  const next = Math.min(max, current + amount);
  if (next === current) return false;
  if (existing) {
    write(
      cache.map((c) =>
        c.id === item.id ? { ...c, ...item, qty: next } : c,
      ),
    );
  } else {
    write([...cache, { ...item, qty: next }]);
  }
  return true;
}

export function updateQty(id: string, qty: number) {
  ensureInit();
  const existing = cache.find((c) => c.id === id);
  if (!existing) return;
  const max = limitOf(existing);
  if (qty <= 0) {
    write(cache.filter((c) => c.id !== id));
  } else {
    write(cache.map((c) => (c.id === id ? { ...c, qty: Math.min(max, qty) } : c)));
  }
}

export function cartQtyOf(id: string): number {
  ensureInit();
  return cache.find((c) => c.id === id)?.qty ?? 0;
}

export function clearCart() {
  write([]);
}

const EMPTY: CartItem[] = [];

export function useCart(): CartItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      ensureInit();
      return cache;
    },
    () => EMPTY,
  );
}

export function formatPrice(price: number): string {
  const value = Number.isFinite(price) ? price : 0;
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

export function priceValue(price: number): number {
  return Number.isFinite(price) ? price : 0;
}
