import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyOrderEvent, savePushSubscription, sendNotificationToAll, sendNotificationToCustomer } from "@/lib/web-push.server";
import type { OrderPushEvent } from "@/lib/web-push.server";

async function body(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

/** Confere o token e garante que é um administrador. Retorna o motivo da recusa ou null. */
async function requireAdmin(request: Request): Promise<Response | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  const userId = userData.user?.id;
  if (!userId) return Response.json({ error: "Sessão inválida." }, { status: 401 });
  const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!role) return Response.json({ error: "Sem permissão de administrador." }, { status: 403 });
  return null;
}

export const Route = createFileRoute("/api/public/push")({
  server: {
    handlers: {
      GET: async () => {
        const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? "";
        return Response.json({ publicKey }, { headers: { "cache-control": "public, max-age=3600" } });
      },
      POST: async ({ request }) => {
        const data = await body(request);
        const action = String(data.action ?? "");

        if (action === "subscribe") {
          try {
            await savePushSubscription(
              String(data.phone ?? ""),
              String(data.deviceId ?? ""),
              data.subscription as { endpoint: string; keys?: { p256dh?: string; auth?: string } },
            );
            return Response.json({ ok: true });
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Não foi possível registrar o aparelho." }, { status: 400 });
          }
        }

        if (action === "history") {
          const denied = await requireAdmin(request);
          if (denied) return denied;
          const { data: rows, error } = (await supabaseAdmin
            .from("push_history" as never)
            .select("id,kind,title,body,target_url,sent,failed,created_at")
            .order("created_at", { ascending: false })
            .limit(100)) as never as { data: unknown[] | null; error: { message: string } | null };
          if (error) return Response.json({ error: `Não foi possível ler o histórico: ${error.message}` }, { status: 500 });
          return Response.json({ history: rows ?? [] });
        }

        if (action === "delete") {
          const denied = await requireAdmin(request);
          if (denied) return denied;
          const id = String(data.id ?? "");
          if (!id) return Response.json({ error: "Registro não informado." }, { status: 400 });
          const { error } = await supabaseAdmin.from("push_history" as never).delete().eq("id", id as never);
          if (error) return Response.json({ error: `Não foi possível excluir: ${error.message}` }, { status: 500 });
          return Response.json({ ok: true });
        }

        // Aviso automático de pedido: um caminho único, sem duplicar envios.
        if (action === "order-event") {
          const denied = await requireAdmin(request);
          if (denied) return denied;
          const orderId = String(data.orderId ?? "").trim();
          const event = String(data.event ?? "") as OrderPushEvent;
          const allowed: OrderPushEvent[] = ["paid", "shipping", "delivered", "canceled_unpaid", "canceled_seller"];
          if (!orderId || !allowed.includes(event)) {
            return Response.json({ error: "Evento de pedido inválido." }, { status: 400 });
          }
          try {
            const result = await notifyOrderEvent(orderId, event, { reason: String(data.reason ?? "") });
            return Response.json(result);
          } catch (error) {
            console.error("[push] order-event", error);
            return Response.json({ error: error instanceof Error ? error.message : "Falha ao avisar o cliente." }, { status: 500 });
          }
        }

        if (action === "send-order") {
          const denied = await requireAdmin(request);
          if (denied) return denied;
          const customerId = String(data.customerId ?? "").trim();
          const title = String(data.title ?? "").trim();
          const message = String(data.body ?? "").trim();
          if (!customerId || !title || !message) return Response.json({ error: "Dados da notificação incompletos." }, { status: 400 });
          try {
            const count = await sendNotificationToCustomer(customerId, { kind: String(data.kind ?? "order"), title, body: message, targetUrl: String(data.targetUrl ?? "/") });
            return Response.json({ count });
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Falha ao enviar a notificação." }, { status: 500 });
          }
        }

        if (action === "send") {
          const denied = await requireAdmin(request);
          if (denied) return denied;

          const title = String(data.title ?? "").trim();
          const message = String(data.body ?? "").trim();
          if (!title || !message) return Response.json({ error: "Título e descrição são obrigatórios." }, { status: 400 });
          try {
            const result = await sendNotificationToAll({
              kind: String(data.kind ?? "info"),
              title,
              body: message,
              targetUrl: String(data.targetUrl ?? "/"),
            });
            return Response.json({
              count: result.sent,
              created: result.created,
              total: result.total,
              failed: result.failed,
              detail: result.lastError || undefined,
            });
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : "Falha ao enviar as notificações." },
              { status: 500 },
            );
          }
        }

        return Response.json({ error: "Ação inválida." }, { status: 400 });
      },
    },
  },
});
