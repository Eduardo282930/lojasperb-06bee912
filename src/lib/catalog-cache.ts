/**
 * Cache do catálogo no próprio aparelho.
 *
 * Os produtos vêm do Loyverse e ficam guardados aqui (localStorage), não no
 * Supabase. Ao abrir o app, a vitrine aparece na hora com a cópia local e o
 * catálogo é atualizado em segundo plano.
 */

import type { Catalog } from "@/lib/loyverse.functions";

/**
 * Versão do formato guardado. Ao mudar o formato do catálogo, basta subir este
 * número: cópias antigas são descartadas em vez de quebrarem o aparelho.
 */
const VERSION = 2;
const KEY = `sperb-catalog-v${VERSION}`;
/** Chaves de versões anteriores, removidas na primeira leitura. */
const LEGACY_KEYS = ["sperb-catalog-v1"];
/** Depois disso a cópia local é considerada velha demais para ser usada. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Cached = { v: number; at: number; catalog: Catalog };

function isValidCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Catalog>;
  if (!Array.isArray(c.products) || !Array.isArray(c.categories)) return false;
  if (c.products.length === 0) return false;
  // Amostra: o primeiro produto precisa ter o formato atual.
  const p = c.products[0] as Partial<Catalog["products"][number]> | undefined;
  return (
    !!p &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.price === "number" &&
    Array.isArray(p.variants)
  );
}

function dropLegacy(): void {
  for (const key of LEGACY_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function loadCachedCatalog(): { at: number; catalog: Catalog } | null {
  if (typeof window === "undefined") return null;
  dropLegacy();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cached>;
    if (parsed?.v !== VERSION) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > MAX_AGE_MS) return null;
    if (!isValidCatalog(parsed.catalog)) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return { at: parsed.at, catalog: parsed.catalog };
  } catch {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function saveCachedCatalog(catalog: Catalog): void {
  if (typeof window === "undefined") return;
  if (!isValidCatalog(catalog)) return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: VERSION, at: Date.now(), catalog } satisfies Cached),
    );
  } catch {
    // Sem espaço: o cache é opcional, o catálogo continua vindo do Loyverse.
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
