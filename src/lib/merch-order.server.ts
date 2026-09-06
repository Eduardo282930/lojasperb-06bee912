/**
 * Ordenação comercial feita no servidor.
 *
 * O catálogo sai do servidor já na ordem da vitrine (destaques e mais
 * vendidos primeiro), então a primeira tela e as primeiras fotos já são as
 * certas — sem reorganizar depois no aparelho do cliente.
 */

import type { Catalog } from "@/lib/loyverse.functions";
import { merchandiseOrder, type FeaturedItem } from "@/lib/merch-order";

type Merch = { featured: FeaturedItem[]; top: Map<string, number> };

const MERCH_TTL_MS = 60_000;
let cache: { at: number; merch: Merch } | null = null;

async function loadMerch(): Promise<Merch> {
  if (cache && Date.now() - cache.at < MERCH_TTL_MS) return cache.merch;
  const empty: Merch = { featured: [], top: new Map() };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [featuredRes, topRes] = await Promise.all([
      supabaseAdmin
        .from("featured_products")
        .select("id, product_key, section, position")
        .order("position", { ascending: true }),
      supabaseAdmin.rpc("top_selling_products"),
    ]);

    const featured: FeaturedItem[] = (featuredRes.data ?? []).map((r) => ({
      id: r.id,
      productKey: r.product_key,
      section: r.section,
      position: r.position ?? 0,
    }));

    const top = new Map<string, number>();
    for (const r of topRes.data ?? []) {
      const key = r.variant_id ?? "";
      if (key) top.set(key, Number(r.qty ?? 0));
    }

    const merch: Merch = { featured, top };
    cache = { at: Date.now(), merch };
    return merch;
  } catch {
    return cache?.merch ?? empty;
  }
}

/** Devolve o catálogo já na ordem final da vitrine (sorteio novo a cada resposta). */
export async function orderCatalog(catalog: Catalog): Promise<Catalog> {
  const { featured, top } = await loadMerch();
  return {
    ...catalog,
    products: merchandiseOrder(catalog.products, featured, top, Math.random()),
  };
}
