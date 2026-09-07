/**
 * Interesses do cliente (só no aparelho dele).
 *
 * Guardamos o que ele pesquisa, as categorias que abre e o que coloca na
 * sacola. Isso alimenta a vitrine "Mais recomendados" — nada disso sai do
 * aparelho e nada muda nas regras de pedido/estoque.
 */

import type { CatalogProduct } from "@/lib/loyverse.functions";
import { fuzzyScore } from "@/lib/search";

const KEY = "sperb.interests.v1";
const MAX_TERMS = 12;

export type Interests = {
  terms: Array<{ value: string; weight: number }>;
  categories: Array<{ id: string; weight: number }>;
};

const EMPTY: Interests = { terms: [], categories: [] };

function read(): Interests {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Interests>;
    return {
      terms: Array.isArray(parsed.terms) ? parsed.terms.slice(0, MAX_TERMS) : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories.slice(0, MAX_TERMS) : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(value: Interests) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* armazenamento cheio ou bloqueado: seguimos sem histórico */
  }
}

function bump<T extends { weight: number }>(
  list: T[],
  match: (item: T) => boolean,
  create: () => T,
  amount: number,
): T[] {
  const next = list.map((item) => ({ ...item }));
  const found = next.find(match);
  if (found) found.weight += amount;
  else next.push(create());
  return next
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_TERMS);
}

export function loadInterests(): Interests {
  return read();
}

export function recordSearch(term: string) {
  const value = term.trim().toLowerCase();
  if (value.length < 3) return;
  const current = read();
  write({
    ...current,
    terms: bump(
      current.terms,
      (t) => t.value === value,
      () => ({ value, weight: 1 }),
      1,
    ),
  });
}

export function recordCategory(id: string) {
  if (!id || id === "todos") return;
  const current = read();
  write({
    ...current,
    categories: bump(
      current.categories,
      (c) => c.id === id,
      () => ({ id, weight: 1 }),
      1,
    ),
  });
}

export function recordProductInterest(product: {
  name: string;
  categoryId: string | null;
}) {
  const current = read();
  const terms = bump(
    current.terms,
    (t) => t.value === product.name.trim().toLowerCase(),
    () => ({ value: product.name.trim().toLowerCase(), weight: 2 }),
    2,
  );
  const categories = product.categoryId
    ? bump(
        current.categories,
        (c) => c.id === product.categoryId,
        () => ({ id: product.categoryId as string, weight: 2 }),
        2,
      )
    : current.categories;
  write({ terms, categories });
}

/** Quanto este produto combina com o que o cliente costuma procurar. */
export function interestScore(product: CatalogProduct, interests: Interests): number {
  let score = 0;
  for (const t of interests.terms) {
    const match = Math.max(
      fuzzyScore(product.name, t.value),
      fuzzyScore(product.categoryName, t.value) * 0.6,
    );
    if (match > 0) score += match * Math.min(t.weight, 5);
  }
  for (const c of interests.categories) {
    if (product.categoryId && product.categoryId === c.id) {
      score += 40 * Math.min(c.weight, 5);
    }
  }
  return score;
}

export function hasInterests(interests: Interests): boolean {
  return interests.terms.length > 0 || interests.categories.length > 0;
}
