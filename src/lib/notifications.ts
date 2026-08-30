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

/** Pede permissão para mostrar avisos na barra de notificações do celular. */
export async function askNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
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
  return "🔔 ";
}

/**
 * Mostra na barra de notificações do celular os avisos novos (moedas e cupons).
 * Usa a Notification API do navegador — sem servidor de push, sem duplicar avisos.
 */
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

/** Estado da permissão para uso na interface. */
export function useNotificationPermission() {
  const [state, setState] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setState(notificationPermission());
  }, []);
  return {
    state,
    async request() {
      const next = await askNotificationPermission();
      setState(next);
      return next;
    },
  };
}
