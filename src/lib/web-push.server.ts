import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) usando apenas WebCrypto,
 * porque o servidor publicado (Cloudflare Workers) não suporta
 * createECDH/createSign do node:crypto.
 */

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource));
}

/** HKDF-Expand com um único bloco (todos os tamanhos aqui são <= 32 bytes). */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const out = await hmac(prk, concat(info, new Uint8Array([1])));
  return out.subarray(0, length);
}

export function vapidKeys(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = process.env["VAPID_PRIVATE_KEY"] ?? "";
  const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? "";
  if (!privateKey || !publicKey) throw new Error("As chaves de notificação (VAPID) não estão configuradas no servidor.");
  return { privateKey: unb64(privateKey), publicKey: unb64(publicKey) };
}

export function vapidConfigured(): boolean {
  return Boolean(process.env["VAPID_PRIVATE_KEY"] && process.env["VAPID_PUBLIC_KEY"]);
}

function vapidJwk(privateKey: Uint8Array, publicKey: Uint8Array): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    d: b64url(privateKey),
    x: b64url(publicKey.subarray(1, 33)),
    y: b64url(publicKey.subarray(33, 65)),
    ext: true,
  };
}

async function vapidToken(endpoint: string): Promise<string> {
  const { privateKey, publicKey } = vapidKeys();
  const audience = new URL(endpoint).origin;
  const header = b64url(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    text(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: process.env["VAPID_SUBJECT"] ?? "mailto:admin@sperb.com.br",
      }),
    ),
  );
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("jwk", vapidJwk(privateKey, publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text(input));
  return `${input}.${b64url(signature)}`;
}

/** Criptografa o payload no formato aes128gcm (RFC 8291). */
export async function encryptPayload(
  subscription: { p256dh: string; auth: string },
  payload: string,
): Promise<Uint8Array> {
  const clientPublic = unb64(subscription.p256dh);
  const authSecret = unb64(subscription.auth);

  const serverPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverPair.publicKey));
  const clientKey = await crypto.subtle.importKey("raw", clientPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, serverPair.privateKey, 256),
  );

  // PRK = HMAC(auth_secret, shared); IKM = expand(PRK, "WebPush: info" || clientPub || serverPub)
  const authPrk = await hmac(authSecret, shared);
  const keyInfo = concat(text("WebPush: info\0"), clientPublic, serverPublic);
  const ikm = await hkdfExpand(authPrk, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const contentKey = await hkdfExpand(prk, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, text("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const padded = concat(text(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 }, aesKey, padded as BufferSource),
  );

  const rs = 4096;
  const header = concat(
    salt,
    new Uint8Array([(rs >> 24) & 255, (rs >> 16) & 255, (rs >> 8) & 255, rs & 255]),
    new Uint8Array([serverPublic.length]),
    serverPublic,
  );
  return concat(header, ciphertext);
}

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: unknown,
): Promise<Response> {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const token = await vapidToken(subscription.endpoint);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "high",
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      Authorization: `vapid t=${token}, k=${b64url(vapidKeys().publicKey)}`,
    },
    body: body as BodyInit,
  });
}

export async function savePushSubscription(
  phone: string,
  deviceId: string,
  subscription: { endpoint: string; keys?: { p256dh?: string; auth?: string } },
) {
  const p256dh = subscription?.keys?.p256dh ?? "";
  const auth = subscription?.keys?.auth ?? "";
  if (!subscription?.endpoint || !p256dh || !auth) throw new Error("Assinatura Push inválida.");

  // O aparelho só pode ficar vinculado ao cliente que está logado.
  // Primeiro usamos o resolvedor já existente. Se ele não retornar o ID,
  // fazemos uma segunda tentativa pelo telefone do perfil autenticado.
  let customerId: string | null = null;
  try {
    const { data } = await supabaseAdmin.rpc("resolve_customer", {
      p_device_id: deviceId || "",
      p_phone: phone || "",
    });
    customerId = (data as string | null) ?? null;
  } catch {
    customerId = null;
  }

  if (!customerId && phone) {
    const normalizedPhone = phone.replace(/\D/g, "");
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("id,phone")
      .eq("phone", phone)
      .maybeSingle();

    if (customer?.id) {
      customerId = customer.id;
    } else if (normalizedPhone) {
      const { data: customers } = await supabaseAdmin
        .from("customers")
        .select("id,phone")
        .limit(5000);
      const match = (customers ?? []).find((item) =>
        String(item.phone ?? "").replace(/\D/g, "") === normalizedPhone,
      );
      customerId = match?.id ?? null;
    }
  }

  // Sem cliente identificado, não associamos a inscrição a outro cliente.
  // Ela pode continuar existindo para o envio administrativo geral, mas
  // notificações automáticas de pedidos só usam inscrições com customer_id.
  const { error } = await supabaseAdmin.from("push_subscriptions" as never).upsert(
    {
      endpoint: subscription.endpoint,
      customer_id: customerId,
      device_id: deviceId || null,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}

export async function sendNotificationToCustomer(customerId: string, draft: { kind: string; title: string; body: string; targetUrl: string }) {
  if (!vapidConfigured()) throw new Error("As chaves de notificação (VAPID) não estão configuradas no servidor.");
  const kind = draft.kind || "order";
  const title = draft.title.trim();
  const body = draft.body.trim();
  const targetUrl = draft.targetUrl?.startsWith("/") ? draft.targetUrl : "/";
  const { data: subscriptions, error: subscriptionError } = (await supabaseAdmin
    .from("push_subscriptions" as never)
    .select("id,endpoint,p256dh,auth")
    .eq("customer_id", customerId) as never) as {
    data: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> | null;
    error: { message: string } | null;
  };

  if (subscriptionError) {
    throw new Error(`Não foi possível localizar o aparelho do cliente: ${subscriptionError.message}`);
  }

  let sent = 0;
  const stale: string[] = [];
  for (const sub of subscriptions ?? []) {
    try {
      const response = await sendWebPush(sub, { title, body, url: targetUrl, tag: `${kind}-${Date.now()}` });
      if (response.ok) sent++;
      else if (response.status === 404 || response.status === 410) stale.push(sub.id);
    } catch {}
  }
  if (stale.length) await supabaseAdmin.from("push_subscriptions" as never).delete().in("id", stale as never);
  return sent;
}

export async function sendNotificationToAll(draft: { kind: string; title: string; body: string; targetUrl: string }) {
  if (!vapidConfigured()) throw new Error("As chaves de notificação (VAPID) não estão configuradas no servidor.");

  const kind = draft.kind || "info";
  const title = draft.title.trim();
  const body = draft.body.trim();
  const targetUrl = draft.targetUrl?.startsWith("/") ? draft.targetUrl : "/";

  // Histórico dentro do app (aparece na lista de avisos do cliente).
  let created = 0;
  const { data: customers } = await supabaseAdmin.from("customers").select("id").neq("phone", "");
  for (const customer of customers ?? []) {
    const { error: insertError } = await supabaseAdmin
      .from("customer_notifications")
      .insert({ customer_id: customer.id, kind, title, body, target_url: targetUrl });
    if (!insertError) created++;
  }

  const { data: subscriptions, error: subError } = (await supabaseAdmin
    .from("push_subscriptions" as never)
    .select("id,endpoint,p256dh,auth")
    .limit(5000)) as never as {
    data: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> | null;
    error: { message: string } | null;
  };
  if (subError) throw new Error(`Não foi possível ler os aparelhos: ${subError.message}`);

  let sent = 0;
  let failed = 0;
  let lastError = "";
  const stale: string[] = [];

  for (const sub of subscriptions ?? []) {
    try {
      const response = await sendWebPush(sub, {
        title,
        body,
        url: targetUrl,
        tag: `${kind}-${Date.now()}`,
      });
      if (response.ok) sent++;
      else {
        failed++;
        lastError = `${response.status} ${(await response.text().catch(() => "")).slice(0, 160)}`;
        if (response.status === 404 || response.status === 410) stale.push(sub.id);
      }
    } catch (error) {
      failed++;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (stale.length) await supabaseAdmin.from("push_subscriptions" as never).delete().in("id", stale as never);

  // Histórico de envios para o painel Admin.
  try {
    await supabaseAdmin.from("push_history" as never).insert({
      kind,
      title,
      body,
      target_url: targetUrl,
      sent,
      failed,
    } as never);
  } catch {
    /* histórico indisponível não deve impedir o envio */
  }

  return { sent, created, failed, total: (subscriptions ?? []).length, lastError };
}
