/**
 * Cache do catálogo no próprio aparelho.
 *
 * Os produtos vêm do Loyverse e ficam guardados aqui (localStorage), não no
 * Supabase. Ao abrir o app, a vitrine aparece na hora com a cópia local e o
 * catálogo é atualizado em segundo plano.
 */

import type { Catalog } from "@/lib/loyverse.functions";

const KEY = "sperb-catalog-v1";
/** Depois disso a cópia local é considerada velha demais para ser usada. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Cached = { at: number; catalog: Catalog };

export function loadCachedCatalog(): Cached | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.catalog?.products?.length) return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedCatalog(catalog: Catalog): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), catalog }));
  } catch {
    // Sem espaço: o cache é opcional, o catálogo continua vindo do Loyverse.
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
