// Token de sessão (JWT HS256) feito só com o módulo crypto do Node.
// Não precisa de biblioteca externa.
import crypto from "node:crypto";

const b64url = buffer => Buffer.from(buffer).toString("base64url");
const fromB64url = text => Buffer.from(text, "base64url");

export function parseDuration(value, fallbackSeconds = 12 * 3600) {
  if (value === undefined || value === null || value === "") return fallbackSeconds;
  if (/^\d+$/.test(String(value))) return Number(value);
  const match = String(value).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return fallbackSeconds;
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()];
  return Number(match[1]) * unit;
}

export function signToken(payload, secret, { expiresIn = 12 * 3600, issuer } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: now, exp: now + expiresIn, ...(issuer ? { iss: issuer } : {}) };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function verifyToken(token, secret, { issuer } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Token malformado.");
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const received = fromB64url(signature);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error("Assinatura inválida.");
  }
  const parsedHeader = JSON.parse(fromB64url(header).toString("utf8"));
  if (parsedHeader.alg !== "HS256") throw new Error("Algoritmo inválido.");
  const payload = JSON.parse(fromB64url(body).toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expirado.");
  if (issuer && payload.iss !== issuer) throw new Error("Emissor inválido.");
  return payload;
}

export function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const right = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(left, right);
}
