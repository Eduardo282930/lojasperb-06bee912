/**
 * Assistente SPERB (somente servidor).
 *
 * A foto entra, a inteligência artificial lê, o produto é cadastrado no
 * Loyverse e a foto é descartada na mesma chamada: nada de imagem, arquivo
 * ou link guardado no banco.
 */

const GEMINI_TIMEOUT_MS = 60_000;
const LOYVERSE_TIMEOUT_MS = 15_000;

export type AssistantImage = { name: string; mime: string; data: string };

export type PurchaseDraft = {
  name: string;
  variant: string;
  qty: number;
  seller: string;
  listedPrice: number;
  cost: number;
  trackingCode: string;
  purchasedAt: string;
  notes: string;
};

export type AssistantResult = {
  variantId: string;
  itemId: string;
  name: string;
  variant: string;
  qty: number;
  cost: number;
  listedPrice: number;
  savings: number;
  salePrice: number;
  created: boolean;
  image: string;
};

export type AssistantReview = { image: string; reason: string };

function geminiModel(): string {
  return process.env["GEMINI_MODEL"] || "gemini-3.5-flash";
}

const PROMPT = `Você analisa capturas de tela de compras da Shopee para cadastrar produtos numa loja.

Extraia TODOS os produtos visíveis na imagem. Para cada produto:
- name: nome completo do produto, reconstruído por extenso. Nunca use "..." nem corte o nome.
- variant: a variação escolhida (cor, tamanho, modelo). Vazio se não houver.
- qty: quantidade comprada (número inteiro, mínimo 1).
- seller: nome da loja/vendedor, se aparecer.
- listedPrice: preço anunciado ATUAL de UMA unidade, só o número (ex.: 39.90). IGNORE completamente qualquer preço riscado/antigo.
- cost: valor pago por UMA unidade, só o número. Nunca repita aqui o total do pedido.
- totalPaid: total realmente pago pelo item (todas as unidades), só o número.
- trackingCode: código de rastreio/pedido, se aparecer.
- purchasedAt: data da compra no formato AAAA-MM-DD, se aparecer.
- notes: informação adicional útil (frete, cupom aplicado, observações).

Nunca invente preço de venda. Se a imagem não for uma compra ou não der para ler, devolva a lista vazia.
Responda apenas com JSON.`;

/** Aceita 39.90, "39,90", "R$ 1.299,00" e devolve número. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").replace(/[^\d.,-]/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Aceita 2026-08-12 e 12/08/2026. */
function toIsoDate(value: unknown): string {
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
}

const SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          variant: { type: "string" },
          qty: { type: "integer" },
          seller: { type: "string" },
          listedPrice: { type: "number" },
          totalPaid: { type: "number" },
          cost: { type: "number" },
          trackingCode: { type: "string" },
          purchasedAt: { type: "string" },
          notes: { type: "string" },
        },
        required: ["name", "qty", "cost"],
      },
    },
  },
  required: ["products"],
};

/** Lê UMA imagem. A imagem só existe na memória desta chamada. */
export async function readPurchaseImage(
  image: AssistantImage,
): Promise<PurchaseDraft[]> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY ausente");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: image.mime, data: image.data } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
          },
        }),
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("A inteligência artificial está ocupada. Tente de novo em instantes.");
    throw new Error(`Leitura falhou (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return [];

  let parsed: { products?: unknown };
  try {
    parsed = JSON.parse(text) as { products?: unknown };
  } catch {
    return [];
  }
  const list = Array.isArray(parsed.products) ? parsed.products : [];
  return list.map((raw) => {
    const p = raw as Record<string, unknown>;
    const qty = Math.max(1, Math.floor(toNumber(p["qty"]) || 1));
    const total = Math.max(0, toNumber(p["totalPaid"]));
    let cost = Math.max(0, toNumber(p["cost"]));
    // Quando a IA repete o total no custo, o custo por unidade é o total ÷ quantidade.
    if (qty > 1 && total > 0 && Math.abs(cost - total) < 0.01) cost = total / qty;
    if (cost === 0 && total > 0) cost = total / qty;
    return {
      name: String(p["name"] ?? "").trim(),
      variant: String(p["variant"] ?? "").trim(),
      qty,
      seller: String(p["seller"] ?? "").trim(),
      listedPrice: Math.max(0, toNumber(p["listedPrice"])),
      cost: Math.round(cost * 100) / 100,
      trackingCode: String(p["trackingCode"] ?? "").trim(),
      purchasedAt: toIsoDate(p["purchasedAt"]),
      notes: String(p["notes"] ?? "").trim(),
    } satisfies PurchaseDraft;
  });
}

/* ------------------------------- Loyverse -------------------------------- */

type LoyVariant = {
  variant_id?: string;
  item_id?: string;
  sku?: string | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  cost?: number | null;
  default_price?: number | null;
  purchase_cost?: number | null;
  stores?: Array<Record<string, unknown>>;
};

type LoyItem = {
  id?: string;
  item_name: string;
  track_stock?: boolean;
  sold_by_weight?: boolean;
  is_composite?: boolean;
  use_production?: boolean;
  category_id?: string | null;
  option1_name?: string | null;
  variants?: LoyVariant[];
};

function token(): string {
  const t = process.env["LOYVERSE_TOKEN"];
  if (!t) throw new Error("LOYVERSE_TOKEN ausente");
  return t;
}

async function loyverse<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOYVERSE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.loyverse.com/v1.0/${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "O token do Loyverse não tem permissão para criar produtos ou alterar estoque.",
        );
      }
      throw new Error(`Loyverse ${path} ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function loyverseList<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: "250" });
    if (cursor) qs.set("cursor", cursor);
    const data = await loyverse<Record<string, unknown>>(`${path}?${qs.toString()}`);
    const key = Object.keys(data).find((k) => Array.isArray(data[k]));
    if (key) out.push(...((data[key] as T[]) ?? []));
    cursor = (data["cursor"] as string | undefined) || undefined;
  } while (cursor);
  return out;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let storeIdCache: { at: number; id: string } | null = null;

async function storeId(): Promise<string> {
  if (storeIdCache && Date.now() - storeIdCache.at < 10 * 60_000) return storeIdCache.id;
  const stores = await loyverseList<{ id: string }>("stores");
  const id = stores[0]?.id;
  if (!id) throw new Error("Nenhuma loja encontrada no Loyverse.");
  storeIdCache = { at: Date.now(), id };
  return id;
}

async function inventoryFor(variantId: string, store: string): Promise<number> {
  const data = await loyverse<{ inventory_levels?: Array<{ in_stock?: number }> }>(
    `inventory?variant_ids=${variantId}&store_ids=${store}`,
  );
  return Math.max(0, Math.floor(Number(data.inventory_levels?.[0]?.in_stock ?? 0)));
}

async function setInventory(variantId: string, store: string, stockAfter: number) {
  await loyverse("inventory", {
    method: "POST",
    body: {
      inventory_levels: [
        { variant_id: variantId, store_id: store, stock_after: stockAfter },
      ],
    },
  });
}

function variantLabel(v: LoyVariant): string {
  return [v.option1_value, v.option2_value, v.option3_value]
    .filter(Boolean)
    .join(" / ")
    .trim();
}

/**
 * Cria o produto no Loyverse ou, se já existir, só soma a quantidade comprada.
 * O Loyverse é a fonte permanente: nome, variação, custo, estoque e preço.
 */
export async function upsertPurchase(
  draft: PurchaseDraft,
  items: LoyItem[],
): Promise<{ result: AssistantResult; items: LoyItem[] }> {
  const store = await storeId();
  const wantedName = normalizeName(draft.name);
  const wantedVariant = normalizeName(draft.variant);

  let matchItem: LoyItem | undefined;
  let matchVariant: LoyVariant | undefined;

  for (const it of items) {
    const sameName = normalizeName(it.item_name) === wantedName;
    for (const v of it.variants ?? []) {
      const label = normalizeName(variantLabel(v));
      if (sameName && label === wantedVariant) {
        matchItem = it;
        matchVariant = v;
        break;
      }
    }
    if (matchVariant) break;
  }

  if (matchItem?.id && matchVariant?.variant_id) {
    const current = await inventoryFor(matchVariant.variant_id, store);
    await setInventory(matchVariant.variant_id, store, current + draft.qty);
    return {
      items,
      result: {
        variantId: matchVariant.variant_id,
        itemId: matchItem.id,
        name: matchItem.item_name,
        variant: variantLabel(matchVariant),
        qty: draft.qty,
        cost: draft.cost,
        listedPrice: draft.listedPrice,
        savings: Math.max(0, draft.listedPrice - draft.cost),
        salePrice: Number(matchVariant.default_price ?? 0) || 0,
        created: false,
        image: "",
      },
    };
  }

  const body: LoyItem = {
    item_name: draft.name,
    track_stock: true,
    sold_by_weight: false,
    is_composite: false,
    use_production: false,
    ...(draft.variant ? { option1_name: "Variação" } : {}),
    variants: [
      {
        ...(draft.variant ? { option1_value: draft.variant } : {}),
        cost: draft.cost,
        default_price: 0,
        stores: [
          { store_id: store, pricing_type: "FIXED", price: 0, available_for_sale: true },
        ],
      },
    ],
  };

  const created = await loyverse<LoyItem>("items", { method: "POST", body });
  const variant = created.variants?.[0];
  if (!created.id || !variant?.variant_id) {
    throw new Error("O Loyverse não devolveu o produto criado.");
  }
  await setInventory(variant.variant_id, store, draft.qty);

  return {
    items: [...items, created],
    result: {
      variantId: variant.variant_id,
      itemId: created.id,
      name: created.item_name,
      variant: variantLabel(variant),
      qty: draft.qty,
      cost: draft.cost,
      listedPrice: draft.listedPrice,
      savings: Math.max(0, draft.listedPrice - draft.cost),
      salePrice: 0,
      created: true,
      image: "",
    },
  };
}

export async function loadItems(): Promise<LoyItem[]> {
  return loyverseList<LoyItem>("items");
}

/** Grava o preço de venda digitado pelo administrador direto no Loyverse. */
export async function saveSalePrice(
  itemId: string,
  variantId: string,
  price: number,
): Promise<void> {
  const store = await storeId();
  const item = await loyverse<LoyItem>(`items/${itemId}`);
  const variants = (item.variants ?? []).map((v) => {
    if (v.variant_id !== variantId) return v;
    const stores = (v.stores ?? []).map((s) =>
      s["store_id"] === store
        ? { ...s, pricing_type: "FIXED", price, available_for_sale: true }
        : s,
    );
    if (!stores.some((s) => s["store_id"] === store)) {
      stores.push({
        store_id: store,
        pricing_type: "FIXED",
        price,
        available_for_sale: true,
      });
    }
    return { ...v, default_price: price, stores };
  });
  await loyverse("items", { method: "POST", body: { ...item, variants } });
}
