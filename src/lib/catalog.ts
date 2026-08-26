/**
 * Catálogo — lido exclusivamente da Store API do Medusa.js.
 * Sem banco local, sem cache em servidor: cada consulta vai direto ao Medusa.
 */

import { getMedusaConfig, isMedusaConfigured, medusaFetch } from "@/lib/medusa";

export type ProductVariant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku: string;
  image?: string | null;
};

export type CatalogProduct = {
  id: string;
  itemId: string;
  name: string;
  price: number;
  image: string | null;
  images: string[];
  stock: number;
  description: string;
  generatedDescription: boolean;
  sku: string;
  categoryId: string | null;
  categoryName: string;
  variantAxis: string;
  variants: ProductVariant[];
};

export type Category = { id: string; name: string };

export type Catalog = {
  products: CatalogProduct[];
  categories: Category[];
  storeLogo: string | null;
};

const EMPTY: Catalog = { products: [], categories: [], storeLogo: null };

type MedusaPrice = { calculated_amount?: number | null; amount?: number | null };

type MedusaVariant = {
  id: string;
  title?: string | null;
  sku?: string | null;
  inventory_quantity?: number | null;
  manage_inventory?: boolean | null;
  allow_backorder?: boolean | null;
  calculated_price?: MedusaPrice | null;
  options?: Array<{ value?: string | null; option?: { title?: string | null } | null }> | null;
};

type MedusaProduct = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  images?: Array<{ url: string }> | null;
  categories?: Array<{ id: string; name: string }> | null;
  variants?: MedusaVariant[] | null;
};

function priceOf(v: MedusaVariant): number {
  const p = v.calculated_price;
  const raw = p?.calculated_amount ?? p?.amount ?? 0;
  return Number.isFinite(raw) ? Number(raw) : 0;
}

function stockOf(v: MedusaVariant): number {
  if (v.manage_inventory === false || v.allow_backorder) return Number.POSITIVE_INFINITY;
  const q = Number(v.inventory_quantity);
  return Number.isFinite(q) ? q : Number.POSITIVE_INFINITY;
}

function autoDescription(name: string, categoryName: string): string {
  return `${name} disponível na SPERB. Produto da categoria ${categoryName}. Fale com a loja pelo WhatsApp para tirar dúvidas antes de comprar.`;
}

function toProduct(p: MedusaProduct): CatalogProduct {
  const variants = p.variants ?? [];
  const category = p.categories?.[0] ?? null;
  const categoryName = category?.name ?? "Outros";
  const images = [
    ...(p.thumbnail ? [p.thumbnail] : []),
    ...((p.images ?? []).map((i) => i.url).filter(Boolean) as string[]),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const mapped: ProductVariant[] = variants.map((v) => ({
    id: v.id,
    label: v.title?.trim() || "Padrão",
    price: priceOf(v),
    stock: stockOf(v),
    sku: v.sku ?? "",
    image: p.thumbnail ?? null,
  }));

  const axis =
    variants[0]?.options?.[0]?.option?.title?.trim() ??
    (mapped.length > 1 ? "Opção" : "");

  const inStock = mapped.find((v) => v.stock > 0) ?? mapped[0];
  const description = (p.description ?? "").trim();

  return {
    id: inStock?.id ?? p.id,
    itemId: p.id,
    name: p.title,
    price: inStock?.price ?? 0,
    image: images[0] ?? null,
    images,
    stock: inStock?.stock ?? 0,
    description: description || autoDescription(p.title, categoryName),
    generatedDescription: description.length === 0,
    sku: inStock?.sku ?? "",
    categoryId: category?.id ?? null,
    categoryName,
    variantAxis: mapped.length > 1 ? axis || "Opção" : "",
    variants: mapped.length > 1 ? mapped : [],
  };
}

/** Todo o catálogo, direto do Medusa. */
export async function fetchCatalog(): Promise<Catalog> {
  if (!isMedusaConfigured()) return EMPTY;
  const cfg = getMedusaConfig();

  const res = await medusaFetch<{ products: MedusaProduct[] }>("/store/products", {
    query: {
      limit: 200,
      region_id: cfg.regionId || undefined,
      fields:
        "id,title,description,thumbnail,*images,*categories,*variants,*variants.calculated_price,*variants.options,+variants.inventory_quantity",
    },
  });

  const products = (res.products ?? []).map(toProduct);
  const seen = new Map<string, string>();
  for (const p of products) {
    if (p.categoryId) seen.set(p.categoryId, p.categoryName);
  }
  const categories: Category[] = [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (products.some((p) => !p.categoryId)) {
    categories.push({ id: "sem-categoria", name: "Outros" });
  }

  return { products, categories, storeLogo: cfg.logoUrl || null };
}

export async function fetchProducts(): Promise<CatalogProduct[]> {
  return (await fetchCatalog()).products;
}

/** Um produto pelo id da variante ou do produto. */
export async function fetchProduct(args: {
  data: { id: string };
}): Promise<CatalogProduct | null> {
  const id = args.data.id;
  const catalog = await fetchCatalog();
  return (
    catalog.products.find((p) => p.id === id || p.itemId === id) ??
    catalog.products.find((p) => p.variants.some((v) => v.id === id)) ??
    null
  );
}
