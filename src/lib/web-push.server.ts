import { createHash, createHmac, createPrivateKey, createSign, randomBytes, createCipheriv, createECDH } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function b64url(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}
function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(out).length < length; i++) {
    const h = createHash("sha256");
    h.update(prev); h.update(info); h.update(Buffer.from([i]));
    prev = h.digest(); out.push(prev);
  }
  return Buffer.concat(out).subarray(0, length);
}
function concat(...parts: Buffer[]): Buffer { return Buffer.concat(parts); }

function vapidKeys() {
  const privateKey = process.env["VAPID_PRIVATE_KEY"] ?? "";
  const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? "";
  if (!privateKey || !publicKey) throw new Error("VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY são obrigatórias.");
  return { privateKey: unb64(privateKey), publicKey: unb64(publicKey) };
}

function vapidToken(endpoint: string): string {
  const { privateKey, publicKey } = vapidKeys();
  const url = new URL(endpoint);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ aud: url.origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: process.env["VAPID_SUBJECT"] ?? "mailto:admin@sperb.com.br" })));
  const input = `${header}.${payload}`;
  const jwk = { kty: "EC", crv: "P-256", d: b64url(privateKey), x: b64url(publicKey.subarray(1, 33)), y: b64url(publicKey.subarray(33, 65)) };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const signer = createSign("SHA256"); signer.update(input); signer.end();
  const der = signer.sign(key);
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  if (der[offset] !== 0x02) throw new Error("Assinatura VAPID inválida.");
  const rLen = der[offset + 1];
  const r = der.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("Assinatura VAPID inválida.");
  const sLen = der[offset + 1];
  const s = der.subarray(offset + 2, offset + 2 + sLen);
  const raw = Buffer.alloc(64);
  const rTrimmed = r.length > 32 ? r.subarray(r.length - 32) : r;
  const sTrimmed = s.length > 32 ? s.subarray(s.length - 32) : s;
  rTrimmed.copy(raw, 32 - rTrimmed.length);
  sTrimmed.copy(raw, 64 - sTrimmed.length);
  return `${input}.${b64url(raw)}`;
}

export function encryptPayload(subscription: { p256dh: string; auth: string }, payload: string) {
  const clientPublic = unb64(subscription.p256dh);
  const authSecret = unb64(subscription.auth);
  const ecdh = createECDH("prime256v"); ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey(undefined, "uncompressed");
  const shared = ecdh.computeSecret(clientPublic);
  const salt = randomBytes(16);
  const prk = hkdfExtract(authSecret, shared);
  const ikm = hkdfExpand(prk, Buffer.from("Content-Encoding: auth\0"), 32);
  const context = Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]);
  const contentPrk = hkdfExtract(salt, hkdfExpand(ikm, context, 32));
  const keyInfo = Buffer.from("Content-Encoding: aes128gcm\0");
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0");
  const key = hkdfExpand(contentPrk, keyInfo, 16);
  const nonce = hkdfExpand(contentPrk, nonceInfo, 12);
  const padded = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const rs = 4096;
  const body = Buffer.concat([salt, Buffer.from([0, 0, rs >> 8, rs & 255]), serverPublic, ciphertext]);
  return { body, salt, serverPublic };
}

export async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: unknown) {
  const encrypted = encryptPayload(subscription, JSON.stringify(payload));
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      Authorization: `vapid t=${vapidToken(subscription.endpoint)}, k=${b64url(vapidKeys().publicKey)}`,
    },
    body: encrypted.body,
  });
  return response;
}

export async function savePushSubscription(phone: string, deviceId: string, subscription: { endpoint: string; keys?: { p256dh?: string; auth?: string } }) {
  const p256dh = subscription.keys?.p256dh ?? "";
  const auth = subscription.keys?.auth ?? "";
  if (!subscription.endpoint || !p256dh || !auth) throw new Error("Assinatura Push inválida.");
  const { data: customerId, error: customerError } = await supabaseAdmin.rpc("resolve_customer", { p_device_id: deviceId || "", p_phone: phone || "" });
  if (customerError || !customerId) throw new Error("Cliente não encontrado.");
  const { error } = await supabaseAdmin.from("push_subscriptions" as never).upsert({
    endpoint: subscription.endpoint, customer_id: customerId, device_id: deviceId || null, p256dh, auth, updated_at: new Date().toISOString(),
  } as never, { onConflict: "endpoint" });
  if (error) throw error;
}

export async function sendNotificationToAll(draft: { kind: string; title: string; body: string; targetUrl: string }) {
  const kind = draft.kind || "info";
  const title = draft.title.trim();
  const body = draft.body.trim();
  const targetUrl = draft.targetUrl?.startsWith("/") ? draft.targetUrl : "/";
  const { data: customers, error } = await supabaseAdmin.from("customers").select("id").neq("phone", "");
  if (error) throw error;
  let created = 0;
  for (const customer of customers ?? []) {
    const { error: insertError } = await supabaseAdmin.from("customer_notifications").insert({ customer_id: customer.id, kind, title, body, target_url: targetUrl });
    if (!insertError) created++;
  }
  const { data: subscriptions, error: subError } = await supabaseAdmin.from("push_subscriptions" as never).select("id,endpoint,p256dh,auth").limit(5000) as never;
  if (subError) throw subError;
  let sent = 0;
  const stale: string[] = [];
  for (const sub of (subscriptions ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
    try {
      const response = await sendWebPush(sub, { title, body, url: targetUrl, tag: `${kind}-${Date.now()}`, icon: "/favicon.svg", badge: "/favicon.svg" });
      if (response.ok) sent++;
      else if (response.status === 404 || response.status === 410) stale.push(sub.id);
    } catch {
      // Um aparelho com assinatura quebrada não deve impedir os demais envios.
    }
  }
  if (stale.length) await supabaseAdmin.from("push_subscriptions" as never).delete().in("id", stale as never);
  return { sent, created };
}
