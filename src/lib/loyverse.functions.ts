import { createServerFn } from "@tanstack/react-start";

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  image: string | null;
};

type LoyverseVariant = {
  variant_id: string;
  default_price?: number | null;
  stores?: Array<{ price?: number | null }>;
};

type LoyverseItem = {
  id: string;
  item_name: string;
  image_url?: string | null;
  variants?: LoyverseVariant[];
};

export const fetchProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogProduct[]> => {
    const token = process.env.LOYVERSE_TOKEN;
    if (!token) throw new Error("LOYVERSE_TOKEN não configurado");

    const products: CatalogProduct[] = [];
    let cursor: string | undefined;

    do {
      const url = new URL("https://api.loyverse.com/v1.0/items");
      url.searchParams.set("limit", "250");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Loyverse ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { items?: LoyverseItem[]; cursor?: string };

      for (const it of data.items ?? []) {
        const variant = it.variants?.[0];
        const rawPrice =
          variant?.stores?.find((s) => typeof s.price === "number")?.price ??
          variant?.default_price ??
          0;
        products.push({
          id: it.id,
          name: it.item_name,
          price: Number(rawPrice) || 0,
          image: it.image_url ?? null,
        });
      }
      cursor = data.cursor;
    } while (cursor);

    return products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  },
);
