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
      const price = Number(i["price"]);
      return {
        id: String(i["id"] ?? ""),
        name: String(i["name"] ?? ""),
        qty: Math.max(1, Math.round(Number(i["qty"]) || 0)),
        ...(Number.isFinite(price) ? { price } : {}),
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

    const empty = { changes: [], fresh: [], message: "" };

    /*
     * 1. Conferência obrigatória no Loyverse: preço, estoque, disponibilidade
     *    e variação. Nada do carrinho do aparelho é aceito sem passar aqui.
     */
    const { validateCartAgainstLoyverse, problemMessage } = await import(
      "./checkout-validate.server"
    );
    let validation;
    try {
      validation = await validateCartAgainstLoyverse(data.items);
    } catch (err) {
      console.error("[stock] falha ao conferir no Loyverse", err);
      return {
        ok: false,
        holdId: "",
        problems: [],
        changes: [],
        fresh: [],
        message:
          "Não foi possível confirmar os preços e o estoque agora. Tente novamente em instantes.",
      };
    }

    const fresh = validation.items.map((i) => ({
      id: i.id,
      name: i.name,
      price: i.price,
      stock: i.stock,
      available: i.available,
    }));

    if (!validation.ok) {
      return {
        ok: false,
        holdId: "",
        problems: [],
        changes: validation.problems,
        fresh,
        message: problemMessage(validation.problems),
      };
    }

    // 2. Retrato mínimo de estoque (usado pela reserva atômica).
    try {
      const { fetchLiveStock } = await import("./loyverse.functions");
      const live = await fetchLiveStock(data.items.map((i) => i.id));
      if (live.length > 0) {
        await rpc("sync_product_stock", { p_items: live });
      }
    } catch (err) {
      console.error("[stock] falha ao ler estoque no Loyverse", err);
    }

    // 3. Reserva atômica.
    const { data: res, error } = await rpc("create_stock_hold", {
      p_device_id: data.deviceId,
      p_items: data.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty })),
      p_minutes: 20,
    });
    if (error) {
      console.error("[stock] create_stock_hold", error);
      return { ok: false, holdId: "", problems: [], ...empty, fresh };
    }
    const raw = (res ?? {}) as Record<string, unknown>;
    if (raw["ok"] === true) {
      return {
        ok: true,
        holdId: String(raw["hold_id"] ?? ""),
        problems: [],
        changes: [],
        fresh,
        message: "",
      };
    }
    const problems = Array.isArray(raw["problems"])
      ? (raw["problems"] as Array<Record<string, unknown>>).map((p) => ({
          id: String(p["id"] ?? ""),
          name: String(p["name"] ?? ""),
          requested: Number(p["requested"] ?? 0),
          available: Number(p["available"] ?? 0),
        }))
      : [];
    return { ok: false, holdId: "", problems, changes: [], fresh, message: "" };
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
