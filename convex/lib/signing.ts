/**
 * Signed messages between Convex and n8n.
 *
 * Each request carries `Authorization: Bearer <JWT>` signed with HMAC-SHA256 (HS256).
 * The JWT binds the exact request body through a `bodySha256` claim, so the
 * signature covers the payload, and `exp` limits replay to a few minutes.
 * Each direction has its own secret (Convex->n8n, n8n->Convex), so a leak of one
 * cannot be used to forge traffic the other way.
 *
 * JWT was chosen over a bare HMAC header because n8n can sign and verify it with
 * its built-in JWT node and an encrypted credential: no secret in workflow JSON.
 */

const enc = new TextEncoder();
const MAX_AGE_SECONDS = 300;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error("Signing secret missing or too short");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signRequest(
  body: string,
  secret: string,
  opts: { issuer: string; audience: string; jti: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        iss: opts.issuer,
        aud: opts.audience,
        jti: opts.jti,
        iat: now,
        exp: now + MAX_AGE_SECONDS,
        bodySha256: await sha256Hex(body),
      }),
    ),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(sig))}`;
}

/** Returns the claims when the token is valid for this exact body, otherwise null. */
export async function verifyRequest(
  authorization: string | null,
  body: string,
  secret: string,
  opts: { issuer: string; audience: string },
): Promise<{ jti?: string } | null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/)?.[1];
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (header.alg !== "HS256") return null; // never accept "none" or other algorithms
    // crypto.subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      b64urlToBytes(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== opts.issuer || !aud.includes(opts.audience)) return null;
    if (typeof claims.exp !== "number" || claims.exp < now - 30) return null;
    if (typeof claims.iat !== "number" || claims.iat > now + 30 || claims.exp - claims.iat > 3600) return null;
    if (claims.bodySha256 !== (await sha256Hex(body))) return null;
    return claims;
  } catch {
    return null;
  }
}
