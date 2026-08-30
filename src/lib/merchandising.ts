import { supabase } from "@/integrations/supabase/client";
import type { CatalogProduct } from "@/lib/loyverse.functions";

/** Seções de destaque da vitrine. */
export const FEATURED_SECTIONS = [
  { value: "bestsellers", label: "🔥 Mais vendidos" },
  { value: "featured", label: "⭐ Destaques SPERB" },
  { value: "offers", label: "🏷️ Ofertas" },
] as const;

export type FeaturedSection = (typeof FEATURED_SECTIONS)[number]["value"];

export type FeaturedItem = {
  id: string;
  productKey: string;
  section: string;
  position: number;
};

export function sectionLabel(value: string): string {
  return FEATURED_SECTIONS.find((s) => s.value === value)?.label ?? "⭐ Destaques SPERB";
}

/** Produtos escolhidos manualmente pelo administrador. */
export async function fetchFeatured(): Promise<FeaturedItem[]> {
  const { data, error } = await supabase
    .from("featured_products")
    .select("id, product_key, section, position")
    .order("position", { ascending: true });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    productKey: r.product_key,
    section: r.section,
    position: r.position ?? 0,
  }));
}

export async function addFeatured(
  productKey: string,
  section: FeaturedSection,
  position = 0,
): Promise<boolean> {
  const { error } = await supabase
    .from("featured_products")
    .upsert(
      { product_key: productKey, section, position },
      { onConflict: "store_key,section,product_key" },
    );
  return !error;
}

export async function removeFeatured(id: string): Promise<boolean> {
  const { error } = await supabase.from("featured_products").delete().eq("id", id);
  return !error;
}

/** Mais vendidos nos últimos 90 dias (identificador da variação). */
export async function fetchTopSelling(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("top_selling_products");
  const map = new Map<string, number>();
  if (error) return map;
  for (const r of data ?? []) {
    const key = r.variant_id ?? "";
    if (key) map.set(key, Number(r.qty ?? 0));
  }
  return map;
}

/** Unidades já reservadas por pedidos em aberto. */
export async function fetchReservedStock(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("reserved_stock");
  const map = new Map<string, number>();
  if (error) return map;
  for (const r of data ?? []) {
    const key = r.external_variant_id ?? "";
    if (key) map.set(key, Number(r.qty ?? 0));
  }
  return map;
}

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

/**
 * Ordem comercial da vitrine:
 * 1) escolhas manuais do administrador (na ordem definida);
 * 2) mais vendidos dos últimos 90 dias;
 * 3) produtos com estoque e com foto primeiro.
 */
export function merchandiseOrder(
  products: CatalogProduct[],
  featured: FeaturedItem[],
  topSelling: Map<string, number>,
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
    // Sem ordem alfabética: a vitrine varia ao longo do dia.
    return rotationValue(a.id) - rotationValue(b.id);
  });
}

/** Chave de rotação que muda a cada 6 horas (mesma ordem para todos no período). */
function rotationBucket(): number {
  return Math.floor(Date.now() / (6 * 60 * 60 * 1000));
}

function rotationValue(id: string): number {
  const seed = `${id}:${rotationBucket()}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
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
