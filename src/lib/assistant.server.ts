/**
 * Assistente SPERB (somente servidor).
 *
 * A foto entra, a inteligência artificial lê, o produto é cadastrado no
 * Loyverse e a foto é descartada na mesma chamada: nada de imagem, arquivo
 * ou link guardado no banco.
 */

/** A leitura pode demorar: nada de corte curto que cancela a análise no meio. */
const GEMINI_TIMEOUT_MS = 180_000;
const GEMINI_TRIES = 2;
const LOYVERSE_TIMEOUT_MS = 20_000;

export type AssistantMode = "store" | "order";
/** Nome exato da categoria dos produtos por encomenda no Loyverse. */
export const ORDER_CATEGORY_NAME = "Encomenda";

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
  categoryId?: string;
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
  return "gemini-2.5-flash-lite";
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
          categoryId: { type: "string" },
        },
        required: ["name", "qty", "cost"],
      },
    },
  },
  required: ["products"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1_000, date - Date.now());
  }
  const exponential = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
  return exponential + Math.floor(Math.random() * 750);
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

/**
 * Uma chamada ao Gemini com JSON estruturado, tempo limite generoso e
 * repetição automática quando a falha é passageira (ocupado, instabilidade,
 * demora). Erros definitivos não são repetidos.
 */
export async function geminiJson(
  parts: GeminiPart[],
  schema: unknown,
): Promise<string> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("A chave da inteligência artificial não está configurada.");

  let lastError = new Error("Não consegui falar com a inteligência artificial.");

  const model = geminiModel();
  for (let attempt = 1; attempt <= GEMINI_TRIES; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: schema,
              // Raciocínio curto: a leitura sai em segundos em vez de minutos.
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );
    } catch (err) {
      lastError = controller.signal.aborted
        ? new Error("A leitura demorou demais e foi interrompida.")
        : new Error("A conexão com a inteligência artificial falhou.");
      void err;
      clearTimeout(timer);

      throw lastError;
    } finally {
      clearTimeout(timer);
      console.info("[assistant timing] gemini", { ms: Date.now() - started, attempt, model });
    }

    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return (
        json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
      );
    }

    const body = await res.text();
    const busy = res.status === 429 || res.status === 503 || res.status >= 500;
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error(
        "A inteligência artificial recusou a leitura (chave ou imagem inválida).",
      );
    }
    lastError = new Error(
      busy
        ? "A inteligência artificial está ocupada. Tente de novo em instantes."
        : `Leitura falhou (${res.status}): ${body.slice(0, 160)}`,
    );
    if (!busy || attempt === GEMINI_TRIES) throw lastError;

    await sleep(retryDelay(res, attempt));
  }

  throw lastError;
}

/** Lê UMA imagem. A imagem só existe na memória desta chamada. */
export async function readPurchaseImage(
  image: AssistantImage,
  categories: LoyCategory[] = [],
): Promise<PurchaseDraft[]> {
  const text = await geminiJson(
    [
      { text: PROMPT + "\nEscolha categoryId somente entre estas categorias existentes; vazio se nenhuma servir. " + JSON.stringify(categories.map(c => ({id:c.id,name:c.name}))) },
      { inline_data: { mime_type: image.mime, data: image.data } },
    ],
    SCHEMA,
  );
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
      categoryId: categories.some(c => c.id === p["categoryId"]) ? String(p["categoryId"]) : "",
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
  default_pricing_type?: "FIXED";
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

export async function loyverse<T>(
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

export async function storeId(): Promise<string> {
  if (storeIdCache && Date.now() - storeIdCache.at < 10 * 60_000) return storeIdCache.id;
  const stores = await loyverseList<{ id: string }>("stores");
  const id = stores[0]?.id;
  if (!id) throw new Error("Nenhuma loja encontrada no Loyverse.");
  storeIdCache = { at: Date.now(), id };
  return id;
}

/* ------------------------------ Categorias ------------------------------- */

export type LoyCategory = { id: string; name: string; deleted_at?: string | null };

export async function loadCategories(): Promise<LoyCategory[]> {
  const all = await loyverseList<LoyCategory>("categories");
  return all.filter((c) => !c.deleted_at && c.id && c.name);
}

/** Devolve o id da categoria "Encomenda", criando-a só se ainda não existir. */
export async function ensureOrderCategory(
  categories: LoyCategory[],
): Promise<{ id: string; categories: LoyCategory[] }> {
  const wanted = normalizeName(ORDER_CATEGORY_NAME);
  const found = categories.find((c) => normalizeName(c.name) === wanted);
  if (found) return { id: found.id, categories };

  const created = await loyverse<LoyCategory>("categories", {
    method: "POST",
    body: { name: ORDER_CATEGORY_NAME },
  });
  if (!created?.id) throw new Error("Não consegui criar a categoria Encomenda no Loyverse.");
  return { id: created.id, categories: [...categories, created] };
}

const CATEGORY_SCHEMA = {
  type: "object",
  properties: { categoryId: { type: "string" } },
  required: ["categoryId"],
};

/**
 * A IA escolhe a categoria EXISTENTE mais adequada para o produto.
 * Nunca cria categoria nova: quando nada combina, devolve vazio.
 */
export async function pickCategory(
  productName: string,
  categories: LoyCategory[],
): Promise<string | null> {
  categories = categories.filter(c => normalizeName(c.name) !== "encomenda");
  if (categories.length === 0 || !productName.trim()) return null;
  const list = categories.map((c) => `${c.id} = ${c.name}`).join("\n");
  try {
    const text = await geminiJson(
      [
        {
          text: `Escolha a categoria mais adequada para o produto abaixo.

Produto: ${productName}

Categorias existentes (id = nome):
${list}

Responda com o id exato da melhor categoria. Se nenhuma servir, responda com categoryId vazio. Nunca invente um id.`,
        },
      ],
      CATEGORY_SCHEMA,
    );
    const id = String(
      (JSON.parse(text || "{}") as { categoryId?: unknown }).categoryId ?? "",
    ).trim();
    return categories.some((c) => c.id === id) ? id : null;
  } catch {
    return null; // sem categoria é melhor do que travar o cadastro
  }
}

export async function inventoryFor(variantId: string, store: string): Promise<number> {
  const data = await loyverse<{ inventory_levels?: Array<{ in_stock?: number }> }>(
    `inventory?variant_ids=${variantId}&store_ids=${store}`,
  );
  return Math.max(0, Math.floor(Number(data.inventory_levels?.[0]?.in_stock ?? 0)));
}

export async function setInventory(variantId: string, store: string, stockAfter: number) {
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
  categoryId?: string | null,
  forceCategory = false,
): Promise<{ result: AssistantResult; items: LoyItem[] }> {
  const store = await storeId();
  const fullName = [draft.name, draft.variant].filter(Boolean).join(" ");
  const wantedName = normalizeName(fullName);
  const wantedVariant = "";

  let matchItem: LoyItem | undefined;
  let matchVariant: LoyVariant | undefined;

  for (const it of items) {
    const sameName = normalizeName(it.item_name) === wantedName;
    for (const v of it.variants ?? []) {
      const label = normalizeName(variantLabel(v));
      if (sameName && label === wantedVariant && it.variants?.length === 1 && !it.option1_name) {
        matchItem = it;
        matchVariant = v;
        break;
      }
    }
    if (sameName && !matchVariant) throw new Error("Produto antigo com variações: precisa de conferência antes de alterar.");
    if (matchVariant) break;
  }

  if (matchItem?.id && matchVariant?.variant_id) {
    const full = await loyverse<LoyItem>(`items/${matchItem.id}`);
    await loyverse("items", {
      method: "POST",
      body: {
        ...full,
        ...(categoryId ? { category_id: categoryId } : {}),
        variants: (full.variants ?? []).map(v => ({
          ...v, cost: draft.cost, default_pricing_type: "FIXED",
          stores: (v.stores ?? []).map(s => ({ ...s, pricing_type: "FIXED" })),
        })),
      },
    });
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
    item_name: fullName,
    track_stock: true,
    sold_by_weight: false,
    is_composite: false,
    use_production: false,
    ...(categoryId ? { category_id: categoryId } : {}),
    variants: [
      {
        default_pricing_type: "FIXED",
        cost: draft.cost,
        default_price: 0,
        stores: [
          { store_id: store, pricing_type: "FIXED", price: 0, available_for_sale: false },
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
    return { ...v, default_pricing_type: "FIXED", default_price: price, stores };
  });
  await loyverse("items", { method: "POST", body: { ...item, variants } });
}
