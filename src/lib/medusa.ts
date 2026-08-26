/**
 * Única fonte de dados do app: API do Medusa.js.
 *
 * Não há banco de dados local nem sincronização com outros serviços — tudo
 * (catálogo, clientes, pedidos, cupons e moedas) é lido e gravado direto no
 * Medusa através da URL + chaves configuradas na tela de Administração.
 */

import { useSyncExternalStore } from "react";

export type MedusaConfig = {
  /** Ex.: https://minha-loja.medusajs.app */
  backendUrl: string;
  /** Publishable API key (pk_...) da Store API. */
  publishableKey: string;
  /** Região usada para preços (reg_...). Opcional. */
  regionId: string;
  /** Canal de vendas (sc_...). Opcional. */
  salesChannelId: string;
  /** Logo da loja exibido no app. */
  logoUrl: string;
};

const CONFIG_KEY = "sperb.medusa.config.v1";
const ADMIN_TOKEN_KEY = "sperb.medusa.admin-token.v1";
const CUSTOMER_TOKEN_KEY = "sperb.medusa.customer-token.v1";

const env = import.meta.env as Record<string, string | undefined>;

const DEFAULTS: MedusaConfig = {
  backendUrl: env["VITE_MEDUSA_BACKEND_URL"] ?? "",
  publishableKey: env["VITE_MEDUSA_PUBLISHABLE_KEY"] ?? "",
  regionId: env["VITE_MEDUSA_REGION_ID"] ?? "",
  salesChannelId: env["VITE_MEDUSA_SALES_CHANNEL_ID"] ?? "",
  logoUrl: env["VITE_MEDUSA_LOGO_URL"] ?? "",
};

const listeners = new Set<() => void>();
let cache: MedusaConfig = DEFAULTS;
let loaded = false;

function load(): MedusaConfig {
  if (loaded || typeof window === "undefined") return cache;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    cache = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MedusaConfig>) } : DEFAULTS;
  } catch {
    cache = DEFAULTS;
  }
  loaded = true;
  return cache;
}

export function getMedusaConfig(): MedusaConfig {
  return load();
}

export function saveMedusaConfig(patch: Partial<MedusaConfig>): MedusaConfig {
  const next: MedusaConfig = { ...load(), ...patch };
  next.backendUrl = next.backendUrl.trim().replace(/\/+$/, "");
  cache = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  }
  listeners.forEach((l) => l());
  return next;
}

export function useMedusaConfig(): MedusaConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => load(),
    () => DEFAULTS,
  );
}

export function isMedusaConfigured(): boolean {
  const c = load();
  return Boolean(c.backendUrl && c.publishableKey);
}

/* --------------------------------- HTTP -------------------------------- */

export class MedusaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type FetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** Rotas /admin não enviam a publishable key. */
  admin?: boolean;
  query?: Record<string, string | number | undefined>;
};

export async function medusaFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const cfg = load();
  if (!cfg.backendUrl) throw new MedusaError("Medusa não configurado", 0);

  const url = new URL(`${cfg.backendUrl}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.admin && cfg.publishableKey) {
    headers["x-publishable-api-key"] = cfg.publishableKey;
  }
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : ({} as unknown);
  if (!res.ok) {
    const msg =
      (data as { message?: string })?.message || `Medusa ${path} respondeu ${res.status}`;
    throw new MedusaError(msg, res.status);
  }
  return data as T;
}

/* --------------------------- Sessões (tokens) --------------------------- */

function readToken(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}
function writeToken(key: string, token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(key, token);
  else window.localStorage.removeItem(key);
}

export const adminToken = {
  get: () => readToken(ADMIN_TOKEN_KEY),
  set: (t: string | null) => writeToken(ADMIN_TOKEN_KEY, t),
};

export const customerToken = {
  get: () => readToken(CUSTOMER_TOKEN_KEY),
  set: (t: string | null) => writeToken(CUSTOMER_TOKEN_KEY, t),
};

/* ------------------------------- Clientes ------------------------------- */

export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** E-mail técnico derivado do telefone (o cliente nunca precisa digitar). */
export function phoneEmail(phone: string): string {
  return `${onlyDigits(phone)}@clientes.sperb.app`;
}

function phonePassword(phone: string): string {
  return `sperb-${onlyDigits(phone)}`;
}

export type MedusaCustomer = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Entra (ou cria) a conta do cliente no Medusa usando apenas o telefone. */
export async function ensureCustomerSession(
  phone: string,
  name: string,
): Promise<MedusaCustomer | null> {
  const digits = onlyDigits(phone);
  if (digits.length < 8 || !isMedusaConfigured()) return null;
  const email = phoneEmail(digits);
  const password = phonePassword(digits);

  let token: string | null = null;
  try {
    const login = await medusaFetch<{ token: string }>("/auth/customer/emailpass", {
      method: "POST",
      body: { email, password },
    });
    token = login.token;
  } catch {
    try {
      const reg = await medusaFetch<{ token: string }>("/auth/customer/emailpass/register", {
        method: "POST",
        body: { email, password },
      });
      token = reg.token;
      await medusaFetch("/store/customers", {
        method: "POST",
        token,
        body: { email, first_name: name || "Cliente", phone: digits },
      });
    } catch {
      return null;
    }
  }

  customerToken.set(token);
  try {
    const me = await medusaFetch<{ customer: MedusaCustomer }>("/store/customers/me", {
      token,
    });
    if (name && !me.customer.first_name) {
      await medusaFetch("/store/customers/me", {
        method: "POST",
        token,
        body: { first_name: name, phone: digits },
      });
    }
    return me.customer;
  } catch {
    return null;
  }
}

export async function currentCustomer(): Promise<MedusaCustomer | null> {
  const token = customerToken.get();
  if (!token || !isMedusaConfigured()) return null;
  try {
    const me = await medusaFetch<{ customer: MedusaCustomer }>("/store/customers/me", {
      token,
    });
    return me.customer;
  } catch {
    return null;
  }
}
