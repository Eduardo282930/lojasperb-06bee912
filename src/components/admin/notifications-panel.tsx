import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ExternalLink, History, Send, Trash2 } from "lucide-react";
import {
  deletePushHistoryEntry,
  fetchPushHistory,
  sendAdminPushNotification,
  type PushHistoryEntry,
} from "@/lib/notifications";

const KIND_LABELS: Record<string, string> = {
  coupon: "🎟️ Cupons",
  main: "⭐ Principal",
  offer: "🔥 Ofertas",
  product: "🛍️ Produtos",
  order: "📦 Pedidos",
  coins: "🪙 Moedas",
  info: "🔔 Outro",
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function PushHistory() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-push-history"],
    queryFn: fetchPushHistory,
    staleTime: 15 * 1000,
  });
  const entries = data?.history ?? [];

  async function remove(entry: PushHistoryEntry) {
    const first = window.confirm(`Excluir a notificação "${entry.title}" do histórico?`);
    if (!first) return;
    const second = window.confirm("Tem certeza? Essa exclusão não pode ser desfeita.");
    if (!second) return;
    setDeletingId(entry.id);
    setMessage("");
    const result = await deletePushHistoryEntry(entry.id);
    setDeletingId(null);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage("Notificação excluída do histórico.");
    await queryClient.invalidateQueries({ queryKey: ["admin-push-history"] });
  }

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <History className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-xl font-black text-foreground">Histórico de envios</h2>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Notificações enviadas, com data, tipo e destino.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-sm font-semibold text-muted-foreground">Carregando…</p>}
        {!isLoading && entries.length === 0 && (
          <p className="text-sm font-semibold text-muted-foreground">
            Nenhuma notificação enviada até agora.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-2xl border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-muted-foreground">
                  {formatDateTime(entry.createdAt)} · {KIND_LABELS[entry.kind] ?? entry.kind}
                </p>
                <p className="mt-0.5 truncate text-sm font-black text-foreground">{entry.title}</p>
                <p className="mt-0.5 text-sm font-semibold text-muted-foreground">{entry.body}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  Abre em {entry.targetUrl} · enviada para {entry.sent} aparelho(s)
                  {entry.failed > 0 ? ` · ${entry.failed} falha(s)` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={deletingId === entry.id}
                onClick={() => void remove(entry)}
                aria-label={`Excluir notificação ${entry.title}`}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 border-border text-destructive disabled:opacity-50">
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        ))}
        {message && <p className="text-sm font-bold text-muted-foreground">{message}</p>}
      </div>
    </section>
  );
}

const TYPES = [
  ["coupon", "🎟️ Cupons"],
  ["main", "⭐ Principal"],
  ["offer", "🔥 Ofertas"],
  ["product", "🛍️ Produtos"],
  ["order", "📦 Pedidos"],
  ["coins", "🪙 Moedas"],
  ["info", "🔔 Outro"],
] as const;

const DESTINATIONS = [
  ["/", "Página principal"],
  ["/cupons", "Cupons"],
  ["/pedidos?status=topay", "Meus pedidos"],
  ["/moedas", "Minhas moedas"],
] as const;

export function NotificationsPanel() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState("offer");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetUrl, setTargetUrl] = useState("/");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send() {
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody) {
      setMessage("Preencha o título e a descrição.");
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await sendAdminPushNotification({
      kind,
      title: cleanTitle,
      body: cleanBody,
      targetUrl: targetUrl.trim() || "/",
    });
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["admin-push-history"] });
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.count > 0) {
      setMessage(`Notificação enviada para ${result.count} aparelho(s).`);
    } else if ((result.total ?? 0) === 0) {
      setMessage("Nenhum cliente com notificações ativadas foi encontrado ainda.");
    } else {
      setMessage(`Nenhum envio concluído (${result.failed ?? 0} falha(s)). ${result.detail ?? ""}`.trim());
      return;
    }
    setTitle("");
    setBody("");
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border-2 border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Bell className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-foreground">Notificações</h2>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              Envie um aviso imediatamente para a barra de notificações do celular.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block text-sm font-black text-foreground">Tipo</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TYPES.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setKind(id)}
                className="rounded-2xl border-2 px-3 py-3 text-sm font-black"
                style={{ borderColor: kind === id ? "oklch(0.55 0.22 255)" : "var(--border)", background: kind === id ? "color-mix(in oklab, oklch(0.55 0.22 255) 10%, transparent)" : "var(--card)" }}>
                {label}
              </button>
            ))}
          </div>

          <label className="block pt-2 text-sm font-black text-foreground">Título da notificação</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
            placeholder="Ex.: 🔥 Oferta especial hoje"
            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-semibold text-foreground outline-none" />

          <label className="block pt-2 text-sm font-black text-foreground">Descrição</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={240} rows={4}
            placeholder="Escreva aqui a mensagem que o cliente verá na notificação."
            className="w-full resize-none rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-semibold text-foreground outline-none" />

          <label className="block pt-2 text-sm font-black text-foreground">Ao tocar, abrir</label>
          <select value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-bold text-foreground outline-none">
            {DESTINATIONS.map(([url, label]) => <option key={url} value={url}>{label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Ou informe uma rota interna, ex.: /produto/123"
              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none" />
          </div>

          <button type="button" disabled={busy} onClick={() => void send()}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-lg font-black text-primary-foreground disabled:opacity-50">
            <Send className="h-5 w-5" />
            {busy ? "Enviando…" : "Enviar agora"}
          </button>
          {message && <p className="text-sm font-bold text-muted-foreground">{message}</p>}
        </div>
      </section>

      <p className="px-1 text-xs font-semibold leading-5 text-muted-foreground">
        O cliente precisa ter permitido as notificações no celular. O envio usa Push real e não depende do aplicativo estar aberto.
      </p>

      <PushHistory />
    </div>
  );
}
