/**
 * Conferência obrigatória no Loyverse antes de qualquer venda (só servidor).
 *
 * O Loyverse é a palavra final sobre preço, estoque, disponibilidade e
 * variações. Nada que veio do aparelho (carrinho/cache) é aceito sem passar
 * por aqui, e a leitura é sempre nova — nunca a cópia em memória do servidor.
 */

import { syncCatalogFromLoyverse } from "@/lib/loyverse.functions";

export type CartLine = { id: string; name: string; qty: number; price?: number };

export type CartProblemKind = "missing" | "unavailable" | "price" | "stock";

export type CartProblem = {
  id: string;
  name: string;
  kind: CartProblemKind;
  requested: number;
  /** Valor que o aparelho enviou (preço ou quantidade). */
  expected: number;
  /** Valor atual no Loyverse (preço ou estoque). */
  actual: number;
};

export type CartFresh = {
  id: string;
  name: string;
  price: number;
  stock: number;
  available: boolean;
  qty: number;
};

export type CartValidation = {
  ok: boolean;
  items: CartFresh[];
  problems: CartProblem[];
};

/** Diferenças de centavo (arredondamento) não bloqueiam a venda. */
const PRICE_TOLERANCE = 0.005;

/**
 * Relê o catálogo direto do Loyverse e confere cada linha do carrinho.
 * Não altera reserva, pagamento, recibo, reembolso, moedas ou cupons.
 */
export async function validateCartAgainstLoyverse(
  lines: CartLine[],
): Promise<CartValidation> {
  const items: CartFresh[] = [];
  const problems: CartProblem[] = [];
  if (lines.length === 0) return { ok: true, items, problems };

  const { products } = await syncCatalogFromLoyverse();

  type Fresh = { name: string; price: number; stock: number; available: boolean };
  const index = new Map<string, Fresh>();
  for (const p of products) {
    index.set(p.id, {
      name: p.name,
      price: p.price,
      stock: p.stock,
      available: p.variants.some((v) => v.availableForSale),
    });
    for (const v of p.variants) {
      index.set(v.id, {
        name: `${p.name}${v.label ? ` ${v.label}` : ""}`.trim(),
        price: v.price,
        stock: v.stock,
        available: v.availableForSale,
      });
    }
  }

  for (const line of lines) {
    const qty = Math.max(1, Math.round(Number(line.qty) || 1));
    const fresh = index.get(line.id);

    if (!fresh) {
      problems.push({
        id: line.id,
        name: line.name || "produto",
        kind: "missing",
        requested: qty,
        expected: Number(line.price ?? 0),
        actual: 0,
      });
      continue;
    }

    const stock = Number.isFinite(fresh.stock) ? Math.floor(fresh.stock) : 1_000_000;

    if (!fresh.available) {
      problems.push({
        id: line.id,
        name: fresh.name,
        kind: "unavailable",
        requested: qty,
        expected: Number(line.price ?? fresh.price),
        actual: fresh.price,
      });
    } else if (stock < qty) {
      problems.push({
        id: line.id,
        name: fresh.name,
        kind: "stock",
        requested: qty,
        expected: qty,
        actual: Math.max(0, stock),
      });
    } else if (
      typeof line.price === "number" &&
      Number.isFinite(line.price) &&
      Math.abs(line.price - fresh.price) > PRICE_TOLERANCE
    ) {
      problems.push({
        id: line.id,
        name: fresh.name,
        kind: "price",
        requested: qty,
        expected: line.price,
        actual: fresh.price,
      });
    }

    items.push({
      id: line.id,
      name: fresh.name,
      price: fresh.price,
      stock,
      available: fresh.available,
      qty,
    });
  }

  return { ok: problems.length === 0, items, problems };
}

/** Mensagem clara para o cliente idoso, sem termos técnicos. */
export function problemMessage(problems: CartProblem[]): string {
  const brl = (v: number) => `R$ ${(Number.isFinite(v) ? v : 0).toFixed(2).replace(".", ",")}`;
  const parts = problems.slice(0, 4).map((p) => {
    if (p.kind === "price") {
      return `${p.name}: o preço mudou de ${brl(p.expected)} para ${brl(p.actual)}`;
    }
    if (p.kind === "stock") {
      return p.actual > 0
        ? `${p.name}: restam apenas ${p.actual}`
        : `${p.name}: acabou o estoque`;
    }
    if (p.kind === "unavailable") return `${p.name}: não está mais à venda`;
    return `${p.name}: não está mais no catálogo`;
  });
  return `Seu carrinho foi atualizado. ${parts.join(". ")}. Confira e toque de novo para continuar.`;
}
