import { supabase } from "@/integrations/supabase/client";
import type { CatalogProduct } from "@/lib/loyverse.functions";

/** Seções de destaque da vitrine. */
export const FEATURED_SECTIONS = [
  { value: "bestsellers", label: "🔥 Mais vendidos" },
  { value: "featured", label: "⭐ Destaques SPERB" },
  { value: "offers", label: "🏷️ Ofertas" },
] as const;

export type FeaturedSection = (typeof FEATURED_SECTIONS)[number]["value"];

export type { FeaturedItem } from "@/lib/merch-order";

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

export { applyReservations, merchandiseOrder, badgeFor } from "@/lib/merch-order";
