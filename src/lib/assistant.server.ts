/**
 * Assistente SPERB (somente servidor).
 *
 * Cada foto é enviada UMA vez ao Gemini. Na mesma resposta a IA identifica
 * os produtos, decide a quantidade física, calcula o custo unitário e devolve
 * a área visual do produto para o recorte. O recorte só é enviado ao Loyverse
 * quando o administrador salvar aquele produto. A foto original não é salva.
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
  /** Quantas unidades físicas vendáveis existem no pacote/kit comprado. */
  unitsPerPackage?: number;
  /** true quando o pacote deve ser vendido como uma única unidade. */
  sellAsPackage?: boolean;
  /** Caixa normalizada do produto dentro da imagem original. Valores 0..1. */
  crop?: { x: number; y: number; width: number; height: number };
  categoryId?: string;
  manualPrice?: number;
  /** URL de uma foto de produto encontrada na pesquisa de imagens. */
  imageUrl?: string;
  /** Consulta visual específica gerada pela primeira análise do Gemini. */
  imageSearchQuery?: string;
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
  const configured = process.env["GEMINI_MODEL"]?.trim();
  const model = configured || "gemini-3.5-flash-lite";
  if (/1\.5|pro/i.test(model) || !/flash-lite/i.test(model)) {
    throw new Error("GEMINI_MODEL deve usar um modelo Gemini Flash Lite atual.");
  }
  return model.replace(/^models\//, "");
}

const PROMPT = `Você analisa capturas de tela de compras da Shopee para cadastrar produtos numa loja.

Você é responsável por entender a compra, não apenas copiar textos da tela.
Extraia TODOS os produtos diferentes visíveis na compra. Para cada produto:
- name: nome CURTO, limpo e profissional, pronto para a loja. Reconstrua títulos cortados por "...". Não copie marketing, emojis, vendedor, códigos ou texto da interface.
- variant: modelo, cor, tamanho ou medida importante que diferencia a unidade. Não repita a variação no name. Se forem variações realmente diferentes, devolva produtos separados.
- qty: quantidade de PACOTES/ANÚNCIOS comprados.
- unitsPerPackage: quantas UNIDADES FÍSICAS INDEPENDENTES existem em cada pacote/kit.
- sellAsPackage: decida PRINCIPALMENTE olhando a IMAGEM do produto, não pela palavra "kit" no nome. true somente quando todas as peças mostradas formam um único produto funcional/vendável e precisam permanecer juntas (ex.: uma luminária completa formada por 3 lâmpadas + controle). false quando são peças independentes que normalmente entram separadas no estoque (ex.: tomadas, disjuntores, pregos, parafusos).
- Se a imagem mostrar várias unidades idênticas separadas e elas serão vendidas separadamente, unitsPerPackage deve refletir todas as unidades. Se mostrar um conjunto integrado que deve ser vendido completo, sellAsPackage=true e unitsPerPackage=1.
- seller: vendedor, se aparecer.
- listedPrice: preço anunciado ATUAL da compra. Ignore preço riscado/antigo. Use somente para informação.
- totalPaid: VALOR TOTAL REALMENTE PAGO por este produto/conjunto, depois de descontos/cupons aplicados, quando essa informação estiver disponível. NÃO use frete separado como custo do produto.
- cost: custo de UMA unidade física. Calcule totalPaid ÷ quantidade física. Se totalPaid estiver visível, ele é a fonte principal para o custo. Nunca coloque o total da compra em cost.
- trackingCode: rastreio/pedido, se aparecer.
- purchasedAt: data da compra no formato AAAA-MM-DD, se aparecer.
- notes: explique de forma curta qualquer decisão importante sobre kit, quantidade ou custo.

REGRA DE QUANTIDADE:
1. Primeiro descubra quantos pacotes/anúncios foram comprados.
2. Depois descubra quantas unidades físicas vendáveis há em cada pacote.
3. Se o conjunto for vendido por peça, quantidade física = qty × unitsPerPackage.
4. Se o conjunto inteiro for uma única unidade vendável, quantidade física = qty.
5. Não confunda "kit" com uma única unidade: kit pode conter várias peças.

REGRA DE CUSTO:
- custo unitário = valor realmente pago pelo conjunto ÷ quantidade física.
- Se o anúncio diz 2 unidades e o total realmente pago foi R$ 7,84, cost deve ser 3,92.
- Se são 10 unidades por R$ 50, cost deve ser 5,00.
- Se são 2 kits de 3 unidades por R$ 30, cost deve ser 5,00.
- Se houver somente um valor unitário claramente identificado como "preço pago por unidade", use-o; caso contrário, priorize o total realmente pago e divida.
- Nunca use o preço anunciado/riscado como custo quando houver valor realmente pago.

IMAGEM DO PRODUTO NA INTERNET — OBRIGATÓRIO:
- imageSearchQuery deve ser uma consulta curta e MUITO específica para procurar na internet uma foto real deste produto.
- Inclua fabricante/marca, modelo, amperagem, tamanho, cor ou outra variação somente quando identificáveis na imagem/compra.
- Priorize uma busca que encontre a FOTO DO PRODUTO, não a página da compra e não uma foto genérica de produto parecido.
- Se houver um modelo exato, inclua-o. Se não houver, use o nome + marca + variação disponível.

RECORTE DA IMAGEM — OBRIGATÓRIO NA MESMA RESPOSTA:
- crop.x, crop.y, crop.width e crop.height devem localizar VISUALMENTE o produto físico na própria imagem recebida.
- Use coordenadas normalizadas de 0 a 1000 para x, y, width e height.
- A caixa deve ser JUSTA ao redor do objeto físico, seguindo as bordas visíveis do produto, com somente uma pequena margem de segurança (aprox. 3% a 8%). NÃO faça uma caixa grande para "garantir" o produto.
- EXCLUA explicitamente o máximo possível de título, preço, botões, menus, avaliações, banners, ícones, barras e letras da interface que estejam fora do produto.
- Se houver texto IMPRESSO NO PRÓPRIO PRODUTO ou na embalagem que faz parte da aparência física, esse texto deve permanecer no recorte.
- Para um kit que é um único produto, inclua todas as partes físicas que precisam permanecer juntas, mas sem puxar elementos da interface ao redor.
- Para várias unidades independentes do mesmo produto, delimite a área que contém somente essas unidades.
- NÃO escolha a área pelo texto do anúncio; olhe a imagem e identifique visualmente as bordas do objeto.
- O objetivo é uma foto final centralizada, limpa e enquadrada, com o produto ocupando a maior parte do quadro e sem letras da tela nas laterais.
- Sempre devolva um crop válido e apertado para cada produto.

Não invente preço de venda. A IA NÃO define preço de venda.
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

/**
 * Rede de segurança do nome: mesmo que a leitura devolva o título gigante da
 * Shopee, o produto entra na loja com nome curto, limpo e legível.
 */
const NOISE =
  /\b(oferta|ofertas|promo(?:ç|c)(?:ã|a)o|promocional|imperd(?:í|i)vel|frete\s+gr(?:á|a)tis|envio\s+r(?:á|a)pido|pronta\s+entrega|super|mega|top|novo|original|barato|qualidade|loja\s+oficial|atacado)\b/gi;

export function cleanProductName(raw: string): string {
  let s = String(raw ?? "")
    .replace(/[\p{Extended_Pictographic}\u2600-\u27bf]/gu, " ")
    .replace(/#[\wÀ-ÿ]+/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(NOISE, " ")
    .replace(/(\d+)\s*[/x×]\s*(\d+)\s*[/x×]\s*(\d+)/gi, "$1x$2x$3")
    .replace(/(\d+)\s*[/×]\s*(\d+)/g, "$1x$2")
    .replace(/[|•*_"']+/g, " ")
    .replace(/\s*[,;\-–]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Caixa alta vira Capitalização Normal, preservando siglas curtas e medidas.
  s = s
    .split(" ")
    .map((w) =>
      w.length > 3 && w === w.toUpperCase() && /[a-zà-ÿ]/i.test(w)
        ? w.charAt(0) + w.slice(1).toLowerCase()
        : w,
    )
    .join(" ");

  // Palavras repetidas ("azul azul") saem, mantendo a ordem original.
  const seen = new Set<string>();
  s = s
    .split(" ")
    .filter((w) => {
      const k = normalizeName(w);
      if (!k) return false;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(" ");

  if (s.length > 64) s = s.slice(0, 64).replace(/\s+\S*$/, "").trim();
  return s;
}

export function productName(name: string, variant = ''): string {
 const suffix = cleanProductName(variant);
 const base = cleanProductName(name);
 if (!suffix) return base;
 const combined = `${base} ${suffix}`;
 if (combined.length <= 64) return combined;
 const room = 64 - suffix.length - 1;
 if (room < 1) throw new Error('Variação muito longa. Informe uma descrição menor para preservar tamanho e cor.');
 const short = base.slice(0, room).replace(/\s+\S*$/, '').trim();
 return `${short || base.slice(0, room)} ${suffix}`;
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
          unitsPerPackage: { type: "integer" },
          sellAsPackage: { type: "boolean" },
          crop: { type: "object", properties: { x: {type:"number", description:"0..1000, posição horizontal esquerda"}, y: {type:"number", description:"0..1000, posição vertical superior"}, width: {type:"number", description:"0..1000, largura da caixa"}, height: {type:"number", description:"0..1000, altura da caixa"} }, required: ["x","y","width","height"] },
          seller: { type: "string" },
          listedPrice: { type: "number" },
          totalPaid: { type: "number" },
          cost: { type: "number" },
          trackingCode: { type: "string" },
          purchasedAt: { type: "string" },
          notes: { type: "string" },
          categoryId: { type: "string" },
          imageSearchQuery: { type: "string", description: "Consulta precisa para encontrar na internet uma foto limpa e real deste produto, incluindo marca/modelo/variação quando identificáveis." },
        },
        required: ["name", "qty", "cost", "crop", "unitsPerPackage", "sellAsPackage", "imageSearchQuery"],
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
              // O Flash Lite atual já é otimizado para baixa latência. Não envie
              // thinkingConfig: essa geração rejeita esse campo com HTTP 400.
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
    if (res.status === 404) {
      throw new Error(`O Google não disponibiliza ${model} para esta chave. Nenhum outro modelo foi utilizado.`);
    }
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


export type GeminiToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

/**
 * Loop mínimo de function calling sobre a mesma conexão/modelo já usado pelo
 * Assistente. Não troca token, modelo ou endpoint; apenas permite que o Gemini
 * escolha funções administrativas reais e receba o resultado antes de responder.
 */
export async function geminiAgent(
  prompt: string,
  tools: GeminiToolDeclaration[],
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<{ reply: string; calls: string[] }> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("A chave da inteligência artificial não está configurada.");
  const model = geminiModel();
  const contents: Array<Record<string, unknown>> = [{ role: "user", parts: [{ text: prompt }] }];
  const declarations = tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const calls: string[] = [];
  for (let round = 0; round < 6; round++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        signal: controller.signal,
        body: JSON.stringify({
          contents,
          tools: [{ functionDeclarations: declarations }],
          generationConfig: { temperature: 0 },
        }),
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 404) throw new Error(`O Google não disponibiliza ${model} para esta chave.`);
      if (res.status === 429 || res.status === 503 || res.status >= 500) throw new Error("A inteligência artificial está ocupada. Tente de novo em instantes.");
      throw new Error(`A inteligência artificial recusou a solicitação (${res.status}): ${body.slice(0,160)}`);
    }
    const json = await res.json() as { candidates?: Array<{ content?: { role?: string; parts?: Array<Record<string, unknown>> } }> };
    const content = json.candidates?.[0]?.content;
    const parts = content?.parts ?? [];
    const functionCalls = parts.map(p => p.functionCall as {name?: string; args?: Record<string, unknown>; id?: string} | undefined).filter(Boolean);
    contents.push({ role: "model", parts });
    if (!functionCalls.length) {
      const reply = parts.map(p => typeof p.text === "string" ? p.text : "").join("").trim();
      return { reply: reply || "Concluído.", calls };
    }
    const responses: Record<string, unknown>[] = [];
    for (const call of functionCalls) {
      const name = String(call?.name ?? "");
      const args = call?.args ?? {};
      calls.push(name);
      try {
        const result = await execute(name, args);
        responses.push({ functionResponse: { name, id: call?.id, response: { ok: true, result } } });
      } catch (error) {
        responses.push({ functionResponse: { name, id: call?.id, response: { ok: false, error: error instanceof Error ? error.message : "Falha na função." } } });
      }
    }
    contents.push({ role: "user", parts: responses });
  }
  throw new Error("O Assistente atingiu o limite de etapas desta solicitação. Nenhuma etapa adicional foi executada.");
}

/**
 * A primeira leitura da compra devolve identificação, quantidade, custo e a
 * caixa visual. Depois da busca na internet, uma segunda análise visual do
 * Gemini valida as candidatas; nenhuma imagem é aceita só pelo texto.
 */
function normalizeCrop(raw: unknown): NormalizedCrop | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  let x = Number(c.x), y = Number(c.y), width = Number(c.width), height = Number(c.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  // Aceita tanto 0..1 quanto 0..1000. O Gemini costuma retornar coordenadas
  // de visão normalizadas para 0..1000.
  if (Math.max(x, y, width, height) > 1.01 && Math.max(x, y, width, height) <= 1000) {
    x /= 1000; y /= 1000; width /= 1000; height /= 1000;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return undefined;
  if (width < 0.015 || height < 0.015) return undefined;
  return { x, y, width, height };
}

type NormalizedCrop = { x: number; y: number; width: number; height: number };

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

type WebImageCandidate = { url: string; title?: string; source?: string };

function parseBingImageCandidates(html: string): WebImageCandidate[] {
  const out: WebImageCandidate[] = [];
  const patterns = [
    /class=["']iusc["'][^>]*\bm=["']([^"']+)["']/gi,
    /\bm=["']([^"']+)["'][^>]*class=["']iusc["']/gi,
  ];
  for (const re of patterns) {
    for (const match of html.matchAll(re)) {
      try {
        const meta = JSON.parse(decodeHtmlEntities(match[1] ?? '')) as Record<string, unknown>;
        const url = String(meta.murl ?? '').trim();
        if (!/^https?:\/\//i.test(url)) continue;
        if (!out.some((x) => x.url === url)) out.push({
          url,
          title: String(meta.t ?? '').trim(),
          source: String(meta.purl ?? '').trim(),
        });
      } catch {
        // Resultado de imagem inválido: tenta o próximo.
      }
      if (out.length >= 8) return out;
    }
  }
  return out;
}

function parseGenericImageUrls(html: string): WebImageCandidate[] {
  const out: WebImageCandidate[] = [];
  const re = /https?:\/\/[^"'<>\s]+/gi;
  for (const raw of html.matchAll(re)) {
    let url = decodeHtmlEntities(raw[0]).replace(/\\u0026/g, '&');
    try { url = decodeURIComponent(url); } catch { /* mantém */ }
    if (!/^https?:\/\//i.test(url)) continue;
    if (!/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) continue;
    if (!out.some((x) => x.url === url)) out.push({ url });
    if (out.length >= 8) break;
  }
  return out;
}

async function searchInternetProductImages(query: string): Promise<WebImageCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
  };
  const url = `https://www.bing.com/images/search?form=HDRSC2&first=1&q=${encodeURIComponent(q)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.ok) {
      const html = await res.text();
      const candidates = parseBingImageCandidates(html);
      if (candidates.length) return candidates;
    }
  } catch {
    // Fallback abaixo.
  } finally {
    clearTimeout(timer);
  }

  const googleUrl = `https://www.google.com/search?tbm=isch&hl=pt-BR&q=${encodeURIComponent(q)}`;
  const googleController = new AbortController();
  const googleTimer = setTimeout(() => googleController.abort(), 12_000);
  try {
    const res = await fetch(googleUrl, { headers, signal: googleController.signal });
    if (!res.ok) return [];
    return parseGenericImageUrls(await res.text());
  } catch {
    return [];
  } finally {
    clearTimeout(googleTimer);
  }
}

async function downloadWebImage(url: string): Promise<{ mime: string; data: string; bytes: number } | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      redirect: 'follow',
    });
    if (!res.ok) return undefined;
    const contentType = String(res.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    if (!contentType.startsWith('image/') || contentType === 'image/svg+xml' || contentType === 'image/gif') return undefined;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > 8_000_000) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 12 || bytes.length > 8_000_000) return undefined;
    return { mime: contentType === 'image/jpg' ? 'image/jpeg' : contentType, data: Buffer.from(bytes).toString('base64'), bytes: bytes.length };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

type ImageCandidateWithData = {
  candidate: WebImageCandidate;
  image: { mime: string; data: string; bytes: number };
};

type VerifiedProductImage = {
  productIndex: number;
  acceptedCandidateIndex: number;
  confidence: number;
  reason: string;
};

const IMAGE_VERIFY_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productIndex: { type: "integer" },
          acceptedCandidateIndex: { type: "integer", description: "Índice 0..2 da imagem candidata ou -1 se nenhuma for comprovadamente o mesmo produto." },
          confidence: { type: "number", description: "Confiança de 0 a 1 na correspondência visual." },
          reason: { type: "string" },
        },
        required: ["productIndex", "acceptedCandidateIndex", "confidence", "reason"],
      },
    },
  },
  required: ["products"],
};

/**
 * A busca textual só encontra candidatos. A imagem nunca é aceita pelo texto
 * do resultado. O Gemini recebe a foto original da compra e as fotos
 * candidatas e precisa comparar visualmente o produto localizado no crop com
 * cada candidata. Se não houver correspondência forte, nenhuma imagem é usada.
 */
async function findVerifiedInternetProductImages(
  purchaseImage: AssistantImage,
  drafts: PurchaseDraft[],
): Promise<Array<string | undefined>> {
  const candidatesByProduct = await Promise.all(drafts.map(async (draft) => {
    const query = (draft.imageSearchQuery || `${draft.name} ${draft.variant} ${draft.seller}`).trim();
    const candidates = await searchInternetProductImages(query || draft.name);
    const checked = await Promise.all(candidates.slice(0, 3).map(async (candidate) => {
      const image = await downloadWebImage(candidate.url);
      if (!image || image.bytes > 2_000_000) return undefined;
      return { candidate, image } satisfies ImageCandidateWithData;
    }));
    return checked.filter(Boolean) as ImageCandidateWithData[];
  }));

  const parts: GeminiPart[] = [
    {
      text: [
        "Você é o verificador visual de fotos de produtos do Assistente SPERB.",
        "A foto a seguir é a FOTO ORIGINAL DA COMPRA. Para cada produto, use a caixa crop informada para olhar especificamente o produto real que aparece na compra, mesmo que esteja pequeno, parcialmente embaçado ou em uma captura de tela.",
        "Depois compare esse produto visualmente com as imagens candidatas anexadas para o mesmo produto.",
        "NÃO aceite uma imagem apenas porque o nome ou o texto da página combina.",
        "NÃO aceite pessoa, rosto, banner, meme, anúncio sem o produto visível, embalagem de outro produto ou item apenas parecido.",
        "Procure correspondência de formato, desenho, cor, embalagem, quantidade de posições, conectores, detalhes físicos, modelo e demais características visuais disponíveis.",
        "Só aceite uma candidata quando for claramente o mesmo produto ou uma foto de catálogo inequívoca do mesmo modelo/variação.",
        "Se houver dúvida real, retorne acceptedCandidateIndex=-1. É MUITO melhor ficar sem imagem e pedir conferência do que cadastrar uma imagem errada.",
        "A primeira imagem anexada depois deste texto é sempre a foto original da compra. As demais são candidatas numeradas por produto.",
        JSON.stringify(drafts.map((d, i) => ({
          productIndex: i,
          name: d.name,
          variant: d.variant,
          crop: d.crop ?? null,
          candidates: candidatesByProduct[i].map((c, j) => ({
            candidateIndex: j,
            title: c.candidate.title ?? "",
            source: c.candidate.source ?? "",
          })),
        }))),
      ].join("\n"),
    },
    { inline_data: { mime_type: purchaseImage.mime, data: purchaseImage.data } },
  ];

  for (let i = 0; i < candidatesByProduct.length; i++) {
    const candidates = candidatesByProduct[i];
    for (let j = 0; j < candidates.length; j++) {
      parts.push({ text: `Produto ${i + 1}, candidata ${j}:` });
      parts.push({ inline_data: { mime_type: candidates[j].image.mime, data: candidates[j].image.data } });
    }
  }

  const text = await geminiJson(parts, IMAGE_VERIFY_SCHEMA);
  if (!text.trim()) return drafts.map(() => undefined);

  let parsed: { products?: unknown };
  try {
    parsed = JSON.parse(text) as { products?: unknown };
  } catch {
    return drafts.map(() => undefined);
  }

  const verified = new Map<number, VerifiedProductImage>();
  for (const raw of Array.isArray(parsed.products) ? parsed.products : []) {
    const p = raw as Record<string, unknown>;
    const productIndex = Math.floor(Number(p["productIndex"]));
    const acceptedCandidateIndex = Math.floor(Number(p["acceptedCandidateIndex"]));
    const confidence = Number(p["confidence"]);
    if (!Number.isInteger(productIndex) || productIndex < 0 || productIndex >= drafts.length) continue;
    if (!Number.isFinite(confidence) || confidence < 0.82) continue;
    if (!Number.isInteger(acceptedCandidateIndex) || acceptedCandidateIndex < 0 || acceptedCandidateIndex >= candidatesByProduct[productIndex].length) continue;
    verified.set(productIndex, {
      productIndex,
      acceptedCandidateIndex,
      confidence,
      reason: String(p["reason"] ?? "").trim(),
    });
  }

  return drafts.map((_, productIndex) => {
    const match = verified.get(productIndex);
    if (!match) return undefined;
    return candidatesByProduct[productIndex][match.acceptedCandidateIndex]?.candidate.url;
  });
}

/** Lê UMA imagem. A imagem só existe na memória desta chamada. */
export async function readPurchaseImage(
  image: AssistantImage,
  categories: LoyCategory[] = [],
  instructions = "",
): Promise<PurchaseDraft[]> {
  // PRIMEIRA chamada de visão por imagem: identificação, quantidade, custo,
  // localização visual e consulta de busca saem da mesma análise.
  const text = await geminiJson(
    [
      { text: PROMPT + "\nPreferências do administrador (não substituem as regras acima): " + instructions + "\nEscolha categoryId somente entre estas categorias existentes; vazio se nenhuma servir. " + JSON.stringify(categories.map(c => ({id:c.id,name:c.name}))) },
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
  const drafts = list.map((raw) => {
    const p = raw as Record<string, unknown>;
    const qtyPackages = Math.max(1, Math.floor(toNumber(p["qty"]) || 1));
    const unitsPerPackage = Math.max(1, Math.floor(toNumber(p["unitsPerPackage"]) || 1));
    const sellAsPackage = Boolean(p["sellAsPackage"]);
    const physicalQty = sellAsPackage ? qtyPackages : qtyPackages * unitsPerPackage;

    const totalPaid = Math.max(0, toNumber(p["totalPaid"]));
    const reportedCost = Math.max(0, toNumber(p["cost"]));
    // O campo mostrado no card e enviado ao Loyverse é SEMPRE o custo de uma
    // unidade física. Mesmo que o Gemini tenha devolvido cost como total,
    // dividimos pela quantidade física antes de persistir.
    const totalCost = totalPaid > 0 ? totalPaid : reportedCost;
    const cost = physicalQty > 0 ? totalCost / physicalQty : totalCost;

    return {
      name: cleanProductName(String(p["name"] ?? "")),
      variant: cleanProductName(String(p["variant"] ?? "")),
      qty: physicalQty,
      seller: String(p["seller"] ?? "").trim(),
      listedPrice: Math.max(0, toNumber(p["listedPrice"])),
      cost: Math.round(cost * 100) / 100,
      trackingCode: String(p["trackingCode"] ?? "").trim(),
      purchasedAt: toIsoDate(p["purchasedAt"]),
      notes: String(p["notes"] ?? "").trim(),
      unitsPerPackage,
      sellAsPackage,
      crop: normalizeCrop(p["crop"]),
      categoryId: categories.some(c => c.id === p["categoryId"]) ? String(p["categoryId"]) : "",
      // A URL is filled only after a separate visual verification pass below.
      imageUrl: undefined,
      // Keep the precise query generated by the first Gemini pass in notes so
      // the internet search can use the model's identification rather than a
      // generic name-only query.
      notes: String(p["notes"] ?? "").trim(),
      imageSearchQuery: String(p["imageSearchQuery"] ?? "").trim(),
    } satisfies PurchaseDraft;
  });

  const filteredDrafts = drafts.filter(d => d.name.trim());
  const verifiedUrls = await findVerifiedInternetProductImages(image, filteredDrafts);
  return filteredDrafts.map((draft, index) => ({ ...draft, imageUrl: verifiedUrls[index] }));
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
  const fullName = productName(draft.name, draft.variant);
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


export async function downloadProductImage(url: string): Promise<{ mime: string; data: string }> {
  const image = await downloadWebImage(url);
  if (!image) throw new Error('Não consegui baixar a imagem encontrada na internet.');
  return { mime: image.mime, data: image.data };
}

/** Envia a imagem original recortada para a foto do item no Loyverse. */
export async function uploadItemImage(itemId: string, mime: string, base64: string): Promise<string> {
  const token = process.env["LOYVERSE_TOKEN"];
  if (!token) throw new Error("LOYVERSE_TOKEN ausente");
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  const res = await fetch(`https://api.loyverse.com/v1.0/items/${itemId}/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mime },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Não consegui enviar a foto ao Loyverse (${res.status}).`);
  const item = await loyverse<LoyItem>(`items/${itemId}`);
  const image = String((item as unknown as Record<string, unknown>).image_url ?? "");
  if (!image) throw new Error("A foto foi enviada, mas o Loyverse não confirmou a imagem do item.");
  return image;
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
