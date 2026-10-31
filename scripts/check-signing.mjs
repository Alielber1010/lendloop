// Checks that the Convex automation endpoints accept only correctly signed requests.
// Usage: N8N_TO_CONVEX_SECRET=... node scripts/check-signing.mjs https://<deployment>.convex.site
import crypto from "crypto";
const [secret, site] = [process.env.N8N_TO_CONVEX_SECRET, process.argv[2]];
const b64 = (b) => Buffer.from(b).toString("base64url");
function sign(body, sec, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const c = b64(JSON.stringify({ iss: "lendloop-n8n", aud: "lendloop-convex", iat: now, exp: now + 300, jti: "t",
    bodySha256: crypto.createHash("sha256").update(body).digest("hex"), ...extra }));
  return `${h}.${c}.${b64(crypto.createHmac("sha256", sec).update(`${h}.${c}`).digest())}`;
}
async function call(name, body, token) {
  const r = await fetch(`${site}/automation/overdue-loans`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body });
  console.log(name.padEnd(22), r.status, (await r.text()).slice(0, 80));
}
const body = "{}";
await call("valid signature", body, sign(body, secret));
await call("no signature", body);
await call("wrong secret", body, sign(body, "x".repeat(64)));
await call("tampered body", '{"a":1}', sign(body, secret));
await call("expired", body, sign(body, secret, { iat: 1, exp: 2 }));
await call("wrong audience", body, sign(body, secret, { aud: "lendloop-n8n" }));
