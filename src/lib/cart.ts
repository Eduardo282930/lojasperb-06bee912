import { useSyncExternalStore } from "react";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
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

export function addToCart(item: Omit<CartItem, "qty">) {
  ensureInit();
  const existing = cache.find((c) => c.id === item.id);
  if (existing) {
    write(cache.map((c) => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c)));
  } else {
    write([...cache, { ...item, qty: 1 }]);
  }
}

export function updateQty(id: string, qty: number) {
  ensureInit();
  if (qty <= 0) {
    write(cache.filter((c) => c.id !== id));
  } else {
    write(cache.map((c) => (c.id === id ? { ...c, qty } : c)));
  }
}

export function clearCart() {
  write([]);
}

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
    () => [],
  );
}

export function formatPrice(price: number): string {
  const value = Number.isFinite(price) ? price : 0;
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

export function priceValue(price: number): number {
  return Number.isFinite(price) ? price : 0;
}
