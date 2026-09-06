/**
 * Cadastro automático dos avisos (webhooks) do Loyverse — somente servidor.
 *
 * Garante que o Loyverse avise este app na hora em que algo muda
 * (estoque, item, recibo). É idempotente: só cria o que falta e reativa
 * o que estiver desligado. Se o token não tiver permissão, não quebra nada:
 * apenas devolve o motivo e o app segue com a conferência automática.
 */

const API = "https://api.loyverse.com/v1.0/webhooks";

export const WEBHOOK_TYPES = [
  "inventory_levels.update",
  "items.update",
  "receipts.update",
] as const;

type Hook = {
  id: string;
  url: string;
  type: string;
  status: string;
  deleted_at?: string | null;
};

export type EnsureResult = {
  ok: boolean;
  created: string[];
  enabled: string[];
  existing: string[];
  error?: string;
};

export function webhookTargetUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/public/loyverse-webhook`;
}

export async function ensureLoyverseWebhooks(targetUrl: string): Promise<EnsureResult> {
  const token = process.env["LOYVERSE_TOKEN"];
  const result: EnsureResult = { ok: false, created: [], enabled: [], existing: [] };
  if (!token) return { ...result, error: "LOYVERSE_TOKEN ausente" };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const listRes = await fetch(API, { headers });
  if (!listRes.ok) {
    return {
      ...result,
      error: `sem permissão para ler webhooks (HTTP ${listRes.status})`,
    };
  }
  const list = (await listRes.json()) as { webhooks?: Hook[] };
  const hooks = (list.webhooks ?? []).filter((h) => !h.deleted_at);

  for (const type of WEBHOOK_TYPES) {
    const mine = hooks.find((h) => h.type === type && h.url === targetUrl);
    if (mine && mine.status === "ENABLED") {
      result.existing.push(type);
      continue;
    }
    if (mine) {
      const res = await fetch(API, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: mine.id, type, url: targetUrl, status: "ENABLED" }),
      });
      if (res.ok) result.enabled.push(type);
      else result.error = `falha ao reativar ${type} (HTTP ${res.status})`;
      continue;
    }
    const res = await fetch(API, {
      method: "POST",
      headers,
      body: JSON.stringify({ type, url: targetUrl, status: "ENABLED" }),
    });
    if (res.ok) result.created.push(type);
    else result.error = `sem permissão para criar ${type} (HTTP ${res.status})`;
  }

  result.ok = !result.error;
  return result;
}
