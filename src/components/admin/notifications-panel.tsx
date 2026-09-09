import { useState } from "react";
import { Bell, ExternalLink, Send } from "lucide-react";
import { sendAdminPushNotification } from "@/lib/notifications";

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
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage(result.count > 0
      ? `Notificação enviada para ${result.count} aparelho(s).`
      : "Nenhum cliente com notificações Push ativadas foi encontrado.");
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
    </div>
  );
}
