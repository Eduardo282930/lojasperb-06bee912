import { createServerFn } from "@tanstack/react-start";

/**
 * Reserva de estoque com estoque REAL do Loyverse.
 *
 * O Supabase não guarda mais o catálogo: antes de reservar, o servidor lê o
 * estoque no Loyverse, grava só o retrato mínimo (product_stock) e faz a
 * reserva atômica na mesma sequência. Assim dois clientes nunca conseguem a
 * mesma unidade e o Supabase não acumula produtos.
 */

export type HoldInput = { id: string; name: string; qty: number; price?: number };

export type HoldServerResult = {
  ok: boolean;
  holdId: string;
  problems: Array<{ id: string; name: string; requested: number; available: number }>;
  /** Divergências encontradas no Loyverse (preço, disponibilidade, variação). */
  changes: Array<{
    id: string;
    name: string;
    kind: "missing" | "unavailable" | "price" | "stock";
    requested: number;
    expected: number;
    actual: number;
  }>;
  /** Dados atuais do Loyverse para o aparelho corrigir o carrinho. */
  fresh: Array<{ id: string; name: string; price: number; stock: number; available: boolean }>;
  message: string;
};

function sanitize(items: unknown): HoldInput[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      return {
        id: String(i["id"] ?? ""),
        name: String(i["name"] ?? ""),
        qty: Math.max(1, Math.round(Number(i["qty"]) || 0)),
      };
    })
    .filter((i) => i.id !== "");
}

export const createHoldOnServer = createServerFn({ method: "POST" })
  .inputValidator((data: { deviceId: string; items: HoldInput[] }) => ({
    deviceId: String(data?.deviceId ?? ""),
    items: sanitize(data?.items),
  }))
  .handler(async ({ data }): Promise<HoldServerResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message: string } | null }>;

    // 1. Estoque real, direto do Loyverse.
    try {
      const { fetchLiveStock } = await import("./loyverse.functions");
      const live = await fetchLiveStock(data.items.map((i) => i.id));
      if (live.length > 0) {
        await rpc("sync_product_stock", { p_items: live });
      }
    } catch (err) {
      console.error("[stock] falha ao ler estoque no Loyverse", err);
    }

    // 2. Reserva atômica.
    const { data: res, error } = await rpc("create_stock_hold", {
      p_device_id: data.deviceId,
      p_items: data.items,
      p_minutes: 20,
    });
    if (error) {
      console.error("[stock] create_stock_hold", error);
      return { ok: false, holdId: "", problems: [] };
    }
    const raw = (res ?? {}) as Record<string, unknown>;
    if (raw["ok"] === true) {
      return { ok: true, holdId: String(raw["hold_id"] ?? ""), problems: [] };
    }
    const problems = Array.isArray(raw["problems"])
      ? (raw["problems"] as Array<Record<string, unknown>>).map((p) => ({
          id: String(p["id"] ?? ""),
          name: String(p["name"] ?? ""),
          requested: Number(p["requested"] ?? 0),
          available: Number(p["available"] ?? 0),
        }))
      : [];
    return { ok: false, holdId: "", problems };
  });

export const releaseHoldOnServer = createServerFn({ method: "POST" })
  .inputValidator((data: { holdId: string }) => ({ holdId: String(data?.holdId ?? "") }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!data.holdId) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ error?: { message: string } | null }>;
    await rpc("release_stock_hold", { p_hold_id: data.holdId });
    return { ok: true };
  });
