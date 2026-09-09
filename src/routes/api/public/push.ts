import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { savePushSubscription, sendNotificationToAll } from "@/lib/web-push.server";

async function body(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
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

        if (action === "send") {
          const authorization = request.headers.get("authorization") ?? "";
          const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (!token) return Response.json({ error: "Não autorizado." }, { status: 401 });
          const { data: userData } = await supabaseAdmin.auth.getUser(token);
          const userId = userData.user?.id;
          if (!userId) return Response.json({ error: "Sessão inválida." }, { status: 401 });
          const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
          if (!role) return Response.json({ error: "Sem permissão de administrador." }, { status: 403 });

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
