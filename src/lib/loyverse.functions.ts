import { createServerFn } from "@tanstack/react-start";

export type CatalogProduct = {
  id: string; // variant_id (unique per sellable unit)
  itemId: string;
  name: string;
  price: number;
  image: string | null;
  stock: number;
  description: string;
  sku: string;
  categoryId: string | null;
  categoryName: string;
};

export type Category = {
  id: string;
  name: string;
};

export type Catalog = {
  products: CatalogProduct[];
  categories: Category[];
};

type LoyverseVariant = {
  variant_id: string;
  sku?: string | null;
  default_price?: number | null;
  stores?: Array<{ price?: number | null }>;
};

type LoyverseItem = {
  id: string;
  item_name: string;
  description?: string | null;
  category_id?: string | null;
  image_url?: string | null;
  track_stock?: boolean;
  variants?: LoyverseVariant[];
};

type InventoryLevel = {
  variant_id: string;
  in_stock?: number | null;
};

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

async function loyverseGet<T>(
  path: string,
  token: string,
  extra?: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`https://api.loyverse.com/v1.0/${path}`);
    url.searchParams.set("limit", "250");
    for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Loyverse ${path} ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as Record<string, unknown>;
    const key = Object.keys(data).find((k) => Array.isArray(data[k]));
    if (key) out.push(...((data[key] as T[]) ?? []));
    cursor = (data.cursor as string | undefined) || undefined;
  } while (cursor);
  return out;
}

async function buildCatalog(token: string): Promise<Catalog> {
  const [items, rawCategories] = await Promise.all([
    loyverseGet<LoyverseItem>("items", token),
    loyverseGet<{ id: string; name: string; deleted_at?: string | null }>(
      "categories",
      token,
    ).catch(() => []),
  ]);

  let inventory: InventoryLevel[] = [];
  try {
    inventory = await loyverseGet<InventoryLevel>("inventory", token);
  } catch {
    inventory = [];
  }

  const stockByVariant = new Map<string, number>();
  for (const lvl of inventory) {
    const prev = stockByVariant.get(lvl.variant_id) ?? 0;
    stockByVariant.set(lvl.variant_id, prev + (Number(lvl.in_stock) || 0));
  }

  const categoryNames = new Map<string, string>();
  for (const c of rawCategories) {
    if (c.deleted_at) continue;
    categoryNames.set(c.id, c.name);
  }

  const products: CatalogProduct[] = [];
  for (const it of items) {
    const variant = it.variants?.[0];
    if (!variant) continue;
    const rawPrice =
      variant.stores?.find((s) => typeof s.price === "number")?.price ??
      variant.default_price ??
      0;
    const tracked = it.track_stock !== false;
    const stockNum = stockByVariant.get(variant.variant_id);
    const stock = tracked
      ? Math.max(0, Math.floor(stockNum ?? 0))
      : Number.POSITIVE_INFINITY;
    products.push({
      id: variant.variant_id,
      itemId: it.id,
      name: it.item_name,
      price: Number(rawPrice) || 0,
      image: it.image_url ?? null,
      stock,
      description: it.description ? stripHtml(it.description) : "",
      sku: variant.sku ?? "",
      categoryId: it.category_id ?? null,
      categoryName: (it.category_id && categoryNames.get(it.category_id)) || "Outros",
    });
  }

  products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const usedIds = new Set(products.map((p) => p.categoryId).filter(Boolean) as string[]);
  const categories: Category[] = [...usedIds]
    .map((id) => ({ id, name: categoryNames.get(id) ?? "Outros" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (products.some((p) => !p.categoryId)) {
    categories.push({ id: "sem-categoria", name: "Outros" });
  }

  return { products, categories };
}

export const fetchCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<Catalog> => {
    const token = process.env.LOYVERSE_TOKEN;
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");
    return buildCatalog(token);
  },
);

export const fetchProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogProduct[]> => {
    const token = process.env.LOYVERSE_TOKEN;
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");
    return (await buildCatalog(token)).products;
  },
);

export const fetchProduct = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => {
    if (!data || typeof data.id !== "string" || !data.id) {
      throw new Error("Produto inválido");
    }
    return { id: data.id };
  })
  .handler(async ({ data }): Promise<CatalogProduct | null> => {
    const token = process.env.LOYVERSE_TOKEN;
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");
    const { products } = await buildCatalog(token);
    return products.find((p) => p.id === data.id) ?? null;
  });
