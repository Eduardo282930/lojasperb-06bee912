import { createServerFn } from "@tanstack/react-start";

export type CatalogProduct = {
  id: string; // variant_id (unique per sellable unit)
  name: string;
  price: number;
  image: string | null;
  stock: number;
  description: string | null;
  sku: string | null;
  trackStock: boolean;
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
  image_url?: string | null;
  track_stock?: boolean;
  variants?: LoyverseVariant[];
};

type InventoryLevel = {
  variant_id: string;
  in_stock?: number | null;
};

export const fetchProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogProduct[]> => {
    const token = process.env.LOYVERSE_TOKEN;
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");

    const headers = { Authorization: `Bearer ${token}` };

    // 1. Fetch all items (paginated)
    const items: LoyverseItem[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL("https://api.loyverse.com/v1.0/items");
      url.searchParams.set("limit", "250");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) throw new Error(`Loyverse items ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { items?: LoyverseItem[]; cursor?: string };
      items.push(...(data.items ?? []));
      cursor = data.cursor;
    } while (cursor);

    // 2. Fetch inventory levels (paginated). Sum across stores per variant.
    const stockByVariant = new Map<string, number>();
    cursor = undefined;
    do {
      const url = new URL("https://api.loyverse.com/v1.0/inventory");
      url.searchParams.set("limit", "250");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) break; // if inventory endpoint fails, treat as unknown stock
      const data = (await res.json()) as {
        inventory_levels?: InventoryLevel[];
        cursor?: string;
      };
      for (const lvl of data.inventory_levels ?? []) {
        const prev = stockByVariant.get(lvl.variant_id) ?? 0;
        stockByVariant.set(lvl.variant_id, prev + (Number(lvl.in_stock) || 0));
      }
      cursor = data.cursor;
    } while (cursor);

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
      // If item doesn't track stock, treat as always available (Infinity → show as available, no number)
      const stock = tracked
        ? Math.max(0, Math.floor(stockNum ?? 0))
        : Number.POSITIVE_INFINITY;
      products.push({
        id: variant.variant_id,
        name: it.item_name,
        price: Number(rawPrice) || 0,
        image: it.image_url ?? null,
        stock,
        description: it.description?.trim() ? it.description.trim() : null,
        sku: variant.sku ?? null,
        trackStock: tracked,
      });
    }

    return products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  },
);
