/**
 * Cópia oficial do catálogo no banco (somente servidor).
 *
 * O servidor lê o Loyverse, guarda o catálogo no banco e anuncia SÓ os
 * produtos que mudaram. Assim todos os aparelhos abertos recebem o mesmo
 * dado, na hora, sem cada um consultar o Loyverse.
 */

import type { Catalog, CatalogProduct, Category } from "@/lib/loyverse.functions";

const META_ID = "__meta__";

type SnapshotRow = { id: string; fingerprint: string; payload: unknown };

/** Infinity não existe em JSON: estoque sem controle vira null e volta como Infinity. */
function encodeProduct(p: CatalogProduct): unknown {
  return {
    ...p,
    stock: Number.isFinite(p.stock) ? p.stock : null,
    variants: p.variants.map((v) => ({
      ...v,
      stock: Number.isFinite(v.stock) ? v.stock : null,
    })),
  };
}

function decodeProduct(raw: unknown): CatalogProduct {
  const p = raw as CatalogProduct & { stock: number | null };
  return {
    ...p,
    stock: p.stock === null ? Number.POSITIVE_INFINITY : p.stock,
    variants: (p.variants ?? []).map((v) => ({
      ...v,
      stock:
        (v as { stock: number | null }).stock === null
          ? Number.POSITIVE_INFINITY
          : v.stock,
    })),
  };
}

/** Resume o que a vitrine mostra e o que a venda usa. */
export function productFingerprint(p: CatalogProduct): string {
  const parts = [
    p.id,
    p.name,
    p.price,
    Number.isFinite(p.stock) ? p.stock : "inf",
    p.image ?? "",
    p.images.join("|"),
    p.categoryId ?? "",
    p.categoryName,
    p.variantAxis,
    p.description.length,
  ];
  for (const v of p.variants) {
    parts.push(
      `${v.id}~${v.label}~${v.price}~${Number.isFinite(v.stock) ? v.stock : "inf"}~${
        v.availableForSale ? 1 : 0
      }~${v.image ?? ""}`,
    );
  }
  return parts.join("§");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function toRows(products: CatalogProduct[]): SnapshotRow[] {
  return products.map((p) => ({
    id: p.id,
    fingerprint: productFingerprint(p),
    payload: encodeProduct(p),
  }));
}

/**
 * Grava a cópia oficial e devolve os ids dos produtos que mudaram.
 * `full = true` também remove produtos que sumiram do Loyverse.
 */
export async function writeCatalogSnapshot(
  catalog: Catalog,
  full = true,
): Promise<string[]> {
  try {
    const supabase = await admin();
    const rows: SnapshotRow[] = toRows(catalog.products);
    const meta = {
      categories: catalog.categories,
      storeLogo: catalog.storeLogo,
    };
    rows.push({
      id: META_ID,
      fingerprint: JSON.stringify(meta),
      payload: meta,
    });

    const rpc = supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
    const { data, error } = await rpc("apply_catalog_snapshot", {
      p_rows: rows,
      p_full: full,
    });
    if (error) {
      console.error("[catalog-snapshot] gravação", error);
      return [];
    }
    return Array.isArray(data) ? (data as string[]) : [];
  } catch (err) {
    console.error("[catalog-snapshot] gravação", err);
    return [];
  }
}

/** Lê a cópia oficial do banco. Devolve null quando ainda não existe. */
export async function readCatalogSnapshot(): Promise<
  { catalog: Catalog; updatedAt: number } | null
> {
  try {
    const supabase = await admin();
    const { data, error } = await supabase
      .from("catalog_snapshot")
      .select("id, payload, updated_at")
      .limit(5000);
    if (error || !data || data.length === 0) return null;

    const products: CatalogProduct[] = [];
    let categories: Category[] = [];
    let storeLogo: string | null = null;
    let updatedAt = 0;

    for (const row of data as Array<{
      id: string;
      payload: unknown;
      updated_at: string;
    }>) {
      const at = Date.parse(row.updated_at);
      if (Number.isFinite(at) && at > updatedAt) updatedAt = at;
      if (row.id === META_ID) {
        const meta = row.payload as {
          categories?: Category[];
          storeLogo?: string | null;
        };
        categories = meta.categories ?? [];
        storeLogo = meta.storeLogo ?? null;
        continue;
      }
      products.push(decodeProduct(row.payload));
    }

    if (products.length === 0) return null;
    products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return { catalog: { products, categories, storeLogo }, updatedAt };
  } catch (err) {
    console.error("[catalog-snapshot] leitura", err);
    return null;
  }
}

/**
 * Conferência leve: relê SÓ os níveis de estoque no Loyverse e corrige a cópia
 * oficial. É a chamada que roda de 5 em 5 segundos no servidor.
 */
export async function syncStockFromLoyverse(): Promise<{
  changed: string[];
  checked: number;
}> {
  const token = process.env["LOYVERSE_TOKEN"];
  if (!token) throw new Error("LOYVERSE_TOKEN ausente");

  const snapshot = await readCatalogSnapshot();
  if (!snapshot) {
    // Ainda não há cópia oficial: monta uma completa desta vez.
    const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
    const catalog = await syncCatalogFromLoyverse();
    return { changed: await writeCatalogSnapshot(catalog, true), checked: catalog.products.length };
  }

  const { fetchInventoryLevels } = await import("@/lib/loyverse.functions");
  const stockByVariant = await fetchInventoryLevels(token);

  const touched: CatalogProduct[] = [];
  for (const product of snapshot.catalog.products) {
    let changed = false;
    const variants = product.variants.map((v) => {
      if (!Number.isFinite(v.stock)) return v; // sem controle de estoque
      const next = stockByVariant.get(v.id);
      if (next === undefined || next === v.stock) return v;
      changed = true;
      return { ...v, stock: next };
    });
    if (!changed) continue;

    const inStock = variants.filter((v) => v.stock > 0);
    const priceSource = inStock.length > 0 ? inStock : variants;
    const price = priceSource.length
      ? Math.min(...priceSource.map((v) => v.price))
      : product.price;
    const stock = variants.reduce(
      (s, v) => s + (Number.isFinite(v.stock) ? v.stock : Number.POSITIVE_INFINITY),
      0,
    );
    touched.push({ ...product, variants, price, stock });
  }

  if (touched.length === 0) {
    return { changed: [], checked: snapshot.catalog.products.length };
  }

  const changed = await writeCatalogSnapshot(
    { products: touched, categories: [], storeLogo: null },
    false,
  );
  return { changed, checked: snapshot.catalog.products.length };
}
