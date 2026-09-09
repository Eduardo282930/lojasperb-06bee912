import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const b64 = (value) => Buffer.from(value, "base64url").toString("base64url");
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(b64(jwk.x), "base64url"), Buffer.from(b64(jwk.y), "base64url")]).toString("base64url");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${b64(jwk.d)}`);
console.log("VAPID_SUBJECT=mailto:admin@seudominio.com.br");
