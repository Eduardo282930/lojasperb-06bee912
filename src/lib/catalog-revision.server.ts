/**
 * Impressão digital do catálogo (somente servidor).
 *
 * Serve para avisar todos os aparelhos abertos quando preço, estoque,
 * disponibilidade ou variações mudam no Loyverse — sem recarregar a página.
 */

import type { Catalog } from "@/lib/loyverse.functions";

/** Resume o catálogo no que importa para a vitrine e para a venda. */
export function catalogFingerprint(catalog: Catalog): string {
  const parts: string[] = [];
  for (const p of [...catalog.products].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`${p.id}:${p.price}:${p.stock}`);
    for (const v of [...p.variants].sort((a, b) => a.id.localeCompare(b.id))) {
      parts.push(
        `${v.id}|${v.label}|${v.price}|${Number.isFinite(v.stock) ? v.stock : "x"}|${
          v.availableForSale ? 1 : 0
        }`,
      );
    }
  }
  const raw = parts.join(";");
  // Hash simples e estável (não precisa ser criptográfico).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${raw.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

/** Sobe a revisão só quando o catálogo realmente mudou. Devolve true se mudou. */
export async function publishCatalogRevision(catalog: Catalog): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message: string } | null }>;
    const { data, error } = await rpc("bump_catalog_revision", {
      p_fingerprint: catalogFingerprint(catalog),
    });
    if (error) {
      console.error("[catalog-revision]", error);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[catalog-revision]", err);
    return false;
  }
}
