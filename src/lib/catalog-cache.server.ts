/**
 * Server-only persistence layer: mirrors the FINAL catalog (already processed
 * and grouped by the app) into Supabase, so the store keeps working when the
 * Loyverse integration is temporarily unavailable.
 *
 * Loyverse -> Catálogo (processamento atual) -> Supabase -> (futuro ERP)
 */

import type { Catalog, CatalogProduct } from "./loyverse.functions";

export const STORE_KEY = "sperb";

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[()\[\]{}<>]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable identity of a processed product (survives Loyverse id changes). */
export function productKey(p: CatalogProduct): string {
  return `${normalizeKey(p.name)}::${p.categoryId ?? "none"}`;
}

const BIG = 1_000_000;

function encodeStock(n: number): number {
  return Number.isFinite(n) ? n : BIG;
}
function decodeStock(n: number): number {
  return n >= BIG ? Number.POSITIVE_INFINITY : n;
}

/** Saves the processed catalog + store logo into Supabase (best effort). */
export async function persistCatalog(catalog: Catalog): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const rows = catalog.products.map((p) => ({
    store_key: STORE_KEY,
    product_key: productKey(p),
    source: "loyverse",
    external_item_id: p.itemId,
    external_variant_id: p.id,
    name: p.name,
    price: p.price,
    image: p.image,
    images: p.images,
    stock: encodeStock(p.stock),
    description: p.description,
    generated_description: p.generatedDescription,
    sku: p.sku,
    category_external_id: p.categoryId,
    category_name: p.categoryName,
    variant_axis: p.variantAxis,
    variants: p.variants.map((v) => ({ ...v, stock: encodeStock(v.stock) })),
    active: true,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabaseAdmin
        .from("catalog_products")
        .upsert(chunk, { onConflict: "store_key,product_key" });
      if (error) throw error;
    }
    // Products no longer returned by Loyverse are hidden, never deleted.
    const keys = rows.map((r) => r.product_key);
    await supabaseAdmin
      .from("catalog_products")
      .update({ active: false })
      .eq("store_key", STORE_KEY)
      .eq("active", true)
      .not("product_key", "in", `(${keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(",")})`);
  }

  if (catalog.categories.length > 0) {
    await supabaseAdmin.from("catalog_categories").upsert(
      catalog.categories.map((c) => ({
        store_key: STORE_KEY,
        external_id: c.id,
        name: c.name,
        source: "loyverse",
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "store_key,external_id" },
    );
  }

  if (catalog.storeLogo) {
    await supabaseAdmin
      .from("store_settings")
      .update({
        logo_url: catalog.storeLogo,
        logo_source: "loyverse",
        logo_synced_at: new Date().toISOString(),
      })
      .eq("store_key", STORE_KEY);
  }
}

/** Momento (ms) da última sincronização gravada no Supabase. */
export async function getCatalogSyncedAt(): Promise<number | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("catalog_products")
    .select("synced_at")
    .eq("store_key", STORE_KEY)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const t = data?.synced_at ? Date.parse(data.synced_at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Reads the last synced catalog from Supabase (offline fallback). */

export async function loadCatalogFromSupabase(): Promise<Catalog | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: prodRows }, { data: catRows }, { data: store }] = await Promise.all([
    supabaseAdmin
      .from("catalog_products")
      .select("*")
      .eq("store_key", STORE_KEY)
      .eq("active", true)
      .order("name"),
    supabaseAdmin
      .from("catalog_categories")
      .select("external_id, name")
      .eq("store_key", STORE_KEY),
    supabaseAdmin
      .from("store_settings")
      .select("logo_url")
      .eq("store_key", STORE_KEY)
      .maybeSingle(),
  ]);

  if (!prodRows || prodRows.length === 0) return null;

  const products: CatalogProduct[] = prodRows.map((r) => ({
    id: r.external_variant_id ?? r.product_key,
    itemId: r.external_item_id ?? "",
    name: r.name,
    price: Number(r.price) || 0,
    image: r.image ?? null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    stock: decodeStock(Number(r.stock) || 0),
    description: r.description ?? "",
    generatedDescription: Boolean(r.generated_description),
    sku: r.sku ?? "",
    categoryId: r.category_external_id ?? null,
    categoryName: r.category_name ?? "Outros",
    variantAxis: r.variant_axis ?? "",
    variants: (Array.isArray(r.variants) ? r.variants : []).map((v) => {
      const raw = v as Record<string, unknown>;
      return {
        id: String(raw.id ?? ""),
        label: String(raw.label ?? ""),
        price: Number(raw.price) || 0,
        stock: decodeStock(Number(raw.stock) || 0),
        sku: String(raw.sku ?? ""),
        image: (raw.image as string | null) ?? null,
      };
    }),
  }));

  const used = new Set(products.map((p) => p.categoryId).filter(Boolean) as string[]);
  const categories = (catRows ?? [])
    .filter((c) => used.has(c.external_id))
    .map((c) => ({ id: c.external_id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (products.some((p) => !p.categoryId)) {
    categories.push({ id: "sem-categoria", name: "Outros" });
  }

  return { products, categories, storeLogo: store?.logo_url ?? null };
}

/** Store logo persisted in Supabase (used when Loyverse is unavailable). */
export async function loadStoreLogoFromSupabase(): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("store_settings")
    .select("logo_url")
    .eq("store_key", STORE_KEY)
    .maybeSingle();
  return data?.logo_url ?? null;
}

export async function persistStoreLogo(url: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("store_settings")
    .update({
      logo_url: url,
      logo_source: "loyverse",
      logo_synced_at: new Date().toISOString(),
    })
    .eq("store_key", STORE_KEY);
}

/** Mirrors Loyverse customers into the central customers table. */
export async function persistLoyverseCustomers(
  customers: Array<{ id: string; name: string; phone: string; email: string }>,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let saved = 0;
  for (const c of customers) {
    const { error } = await supabaseAdmin.rpc("upsert_customer_from_loyverse", {
      p_loyverse_id: c.id,
      p_name: c.name,
      p_phone: c.phone,
      p_email: c.email,
    });
    if (!error) saved += 1;
  }
  return saved;
}
