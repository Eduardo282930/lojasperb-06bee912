import { supabase } from "@/integrations/supabase/client";
import { deviceId } from "@/lib/coupons";

/**
 * Reserva temporária de estoque (hold).
 *
 * "Fazer pedido" NÃO cria pedido: cria só esta reserva atômica no banco.
 * Enquanto ela existe, nenhum outro cliente consegue a mesma unidade.
 * Se o cliente desistir, a reserva é liberada na hora (ou vence sozinha).
 */

const HOLD_KEY = "sperb-stock-hold-v1";

export type HoldProblem = {
  id: string;
  name: string;
  requested: number;
  available: number;
};

export type HoldResult = {
  ok: boolean;
  holdId: string;
  problems: HoldProblem[];
};

export type HoldItem = { id: string; name: string; qty: number };

type AnyRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data?: unknown; error?: { message: string } | null }>;

function rpc(): AnyRpc {
  return supabase.rpc.bind(supabase) as unknown as AnyRpc;
}

export function getHoldId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(HOLD_KEY) ?? "";
}

function saveHoldId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(HOLD_KEY, id);
  else window.localStorage.removeItem(HOLD_KEY);
}

/** Valida o estoque em tempo real (Loyverse) e reserva tudo de uma vez só. */
export async function createStockHold(items: HoldItem[]): Promise<HoldResult> {
  const payload = items.map((i) => ({
    id: i.id,
    name: i.name,
    qty: Math.max(1, Math.round(i.qty)),
  }));
  try {
    const res = await createHoldOnServer({
      data: { deviceId: deviceId(), items: payload },
    });
    saveHoldId(res.ok ? res.holdId : null);
    return { ok: res.ok, holdId: res.holdId, problems: res.problems };
  } catch {
    saveHoldId(null);
    return { ok: false, holdId: "", problems: [] };
  }
}

/** Devolve o estoque reservado ao catálogo. */
export async function releaseStockHold(): Promise<void> {
  const id = getHoldId();
  saveHoldId(null);
  if (!id) return;
  try {
    await releaseHoldOnServer({ data: { holdId: id } });
  } catch {
    /* a reserva vence sozinha em 20 minutos */
  }
}

/** Após criar o pedido definitivo a reserva já foi consumida no banco. */
export function forgetStockHold(): void {
  saveHoldId(null);
}
