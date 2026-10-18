export const SESSION_COOKIE = "lan_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function getSecret(): string | null {
  const secret = process.env.LAN_AUTH_SECRET || process.env.LAN_AUTH_PASSWORD;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

export function lanAuthEnabled(): boolean {
  const password = process.env.LAN_AUTH_PASSWORD;
  return typeof password === "string" && password.length > 0;
}

/** Loopback on the local-only Docker port — no sign-in required. */
export function isTrustedLocalHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return normalized === "localhost:3000" || normalized === "127.0.0.1:3000";
}

export function requiresLanAuth(host: string | null): boolean {
  return lanAuthEnabled() && !isTrustedLocalHost(host);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.LAN_AUTH_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(password, expected);
}

async function getSigningKey(): Promise<CryptoKey | null> {
  const secret = getSecret();
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function createSessionToken(): Promise<string | null> {
  const key = await getSigningKey();
  if (!key) return null;

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ exp })),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const key = await getSigningKey();
  if (!key) return false;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const payloadB64 = token.slice(0, dot);
  const signatureB64 = token.slice(dot + 1);

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signatureB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!valid) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    ) as { exp?: number };
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
