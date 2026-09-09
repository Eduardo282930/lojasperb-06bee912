import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { deviceId } from "@/lib/coupons";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type PushNotificationDraft = {
  kind: string;
  title: string;
  body: string;
  targetUrl: string;
};

const SEEN_KEY = "sperb:notifications:pushed";

export async function fetchNotifications(phone: string): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc("notifications_for_customer", {
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind ?? "",
    title: r.title ?? "",
    body: r.body ?? "",
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  }));
}

export async function markNotificationsRead(phone: string): Promise<void> {
  await supabase.rpc("mark_notifications_read", {
    p_device_id: deviceId(),
    p_phone: phone || "",
  });
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribeToPush(phone: string): Promise<boolean> {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 8 || typeof window === "undefined" || !("PushManager" in window)) return false;

  try {
    const keyResponse = await fetch("/api/public/push");
    const keyData = (await keyResponse.json()) as { publicKey?: string };
    if (!keyResponse.ok || !keyData.publicKey) return false;

    const registration = await registerPushServiceWorker();
    if (!registration) return false;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });
    }

    const response = await fetch("/api/public/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "subscribe",
        phone,
        deviceId: deviceId(),
        subscription: subscription.toJSON(),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Pede permissão e registra este aparelho para Push real. */
export async function askNotificationPermission(phone = ""): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await subscribeToPush(phone);
    }
    return permission;
  } catch {
    return Notification.permission;
  }
}

function seenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function storeSeen(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    /* armazenamento indisponível — apenas ignora */
  }
}

function emoji(kind: string): string {
  if (kind === "coins") return "🪙 ";
  if (kind === "coupon") return "🎟️ ";
  if (kind === "offer") return "🔥 ";
  if (kind === "product") return "🛍️ ";
  return "🔔 ";
}

/** Fallback para avisos antigos/automáticos enquanto o Push estiver indisponível. */
export function useNotificationWatcher(phone: string) {
  const digits = (phone || "").replace(/\D/g, "");
  const query = useQuery({
    queryKey: ["notifications", digits],
    queryFn: () => fetchNotifications(phone),
    enabled: digits.length >= 8,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const list = query.data;
    if (!list || list.length === 0) return;
    if (!notificationsSupported() || Notification.permission !== "granted") return;

    const seen = seenIds();
    const fresh = list.filter((n) => !n.readAt && !seen.has(n.id)).slice(0, 3);
    for (const n of fresh) {
      try {
        new Notification(`${emoji(n.kind)}${n.title}`, {
          body: n.body,
          icon: "/favicon.svg",
          tag: n.id,
        });
      } catch {
        /* navegador bloqueou — ignora */
      }
      seen.add(n.id);
    }
    if (fresh.length > 0) storeSeen(seen);
  }, [query.data]);

  return query;
}

export async function sendAdminPushNotification(draft: PushNotificationDraft): Promise<{ count: number; error?: string }> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { count: 0, error: "Sessão de administrador não encontrada." };

    const response = await fetch("/api/public/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "send", ...draft }),
    });
    const payload = (await response.json().catch(() => ({}))) as { count?: number; error?: string };
    if (!response.ok) return { count: 0, error: payload.error || "Não foi possível enviar." };
    return { count: Number(payload.count ?? 0) };
  } catch {
    return { count: 0, error: "Não foi possível conectar ao servidor." };
  }
}

/** Estado da permissão para uso na interface. */

export function useNotificationPermission(phone = "") {
  const [state, setState] = useState<NotificationPermission | "unsupported">("default");
  const [justEnabled, setJustEnabled] = useState(false);
  useEffect(() => {
    const current = notificationPermission();
    setState(current);
    if (current === "granted") void subscribeToPush(phone);
  }, [phone]);
  return {
    state,
    justEnabled,
    async request() {
      const next = await askNotificationPermission(phone);
      setState(next);
      if (next === "granted") {
        setJustEnabled(true);
        try {
          new Notification("🔔 Notificações ativadas!", {
            body: "Muito obrigado por ativar os avisos da SPERB. Você receberá novidades, cupons, ofertas e benefícios por aqui.",
            icon: "/favicon.svg",
            tag: "sperb-welcome",
          });
        } catch {
          /* navegador bloqueou — a confirmação na tela já aparece */
        }
      }
      return next;
    },
  };
}

/** Admin: cria um aviso para todos os clientes cadastrados (sem repetir). */
export async function broadcastNotification(
  kind: string,
  title: string,
  body: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("admin_broadcast_notification", {
    p_kind: kind,
    p_title: title,
    p_body: body,
  });
  if (error) return 0;
  return Number(data ?? 0);
}
