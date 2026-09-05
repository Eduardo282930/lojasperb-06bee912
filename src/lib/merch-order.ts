/**
 * Ordem comercial da vitrine (funções puras, usadas no servidor e no app).
 *
 * A vitrine é montada JÁ na ordem final: destaques do admin, mais vendidos,
 * depois produtos com estoque e foto. Nada de lista alfabética que depois se
 * reorganiza no aparelho do cliente.
 */

import type { CatalogProduct } from "@/lib/loyverse.functions";

export type FeaturedItem = {
  id: string;
  productKey: string;
  section: string;
  position: number;
};

/** Estoque disponível = estoque do Loyverse − reservas ativas. */
export function applyReservations(
  products: CatalogProduct[],
  reserved: Map<string, number>,
): CatalogProduct[] {
  if (reserved.size === 0) return products;
  return products.map((p) => {
    const variants = p.variants ?? [];
    let taken = reserved.get(p.id) ?? 0;
    for (const v of variants) {
      if (v.id !== p.id) taken += reserved.get(v.id) ?? 0;
    }
    if (taken <= 0) return p;
    return { ...p, stock: Math.max(0, p.stock - taken) };
  });
}

/** Valor estável de rotação (0..1) para um produto numa dada semente. */
export function rotationValue(id: string, seed: number): number {
  const source = `${id}:${seed}`;
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Ordem comercial:
 * 1) escolhas manuais do administrador (na ordem definida);
 * 2) mais vendidos dos últimos 90 dias;
 * 3) produtos com estoque e com foto primeiro;
 * 4) rotação estável (a vitrine varia ao longo do dia, sem "pular" na rolagem).
 */
export function merchandiseOrder(
  products: CatalogProduct[],
  featured: FeaturedItem[],
  topSelling: Map<string, number>,
  seed = 0,
): CatalogProduct[] {
  const manual = new Map<string, number>();
  featured.forEach((f, i) => {
    if (!manual.has(f.productKey)) manual.set(f.productKey, i);
  });

  const score = (p: CatalogProduct) => {
    let s = 0;
    if (p.stock > 0) s += 2;
    if (p.image) s += 1;
    return s;
  };

  return [...products].sort((a, b) => {
    const ma = manual.get(a.id);
    const mb = manual.get(b.id);
    if (ma !== undefined || mb !== undefined) {
      if (ma === undefined) return 1;
      if (mb === undefined) return -1;
      return ma - mb;
    }
    const sa = topSelling.get(a.id) ?? 0;
    const sb = topSelling.get(b.id) ?? 0;
    if (sa !== sb) return sb - sa;
    const ca = score(a);
    const cb = score(b);
    if (ca !== cb) return cb - ca;
    return rotationValue(a.id, seed) - rotationValue(b.id, seed);
  });
}

/** Selo comercial do produto na vitrine. */
export function badgeFor(
  productId: string,
  featured: FeaturedItem[],
  topSelling: Map<string, number>,
): { label: string; tone: "featured" | "top" | "offer" } | null {
  const manual = featured.find((f) => f.productKey === productId);
  if (manual) {
    if (manual.section === "offers") return { label: "Oferta", tone: "offer" };
    if (manual.section === "bestsellers") return { label: "Mais vendido", tone: "top" };
    return { label: "Destaque", tone: "featured" };
  }
  if ((topSelling.get(productId) ?? 0) > 0) return { label: "Mais vendido", tone: "top" };
  return null;
}
