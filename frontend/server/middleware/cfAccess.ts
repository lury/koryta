import { createPublicKey, verify, type webcrypto } from "node:crypto";

/** Behind Cloudflare Access (the private demo, docs/postgres/README.md),
 * with CF_ACCESS_TEAM_DOMAIN (`<team>.cloudflareaccess.com`) and
 * CF_ACCESS_AUD (the application's audience tag) set: a request without a
 * valid `Cf-Access-Jwt-Assertion` is refused, so one that reaches the server
 * around Cloudflare is refused too, whatever the firewall lets through.
 * People and service tokens get the header from Cloudflare alike. Requests
 * from the container itself - its healthcheck - are let through. */
type Jwk = webcrypto.JsonWebKey & { kid?: string };

let keys: { at: number; byKid: Map<string, Jwk> } | undefined;
const KEYS_TTL_MS = 60 * 60 * 1000;

async function signingKeys(team: string): Promise<Map<string, Jwk>> {
  if (keys && Date.now() - keys.at < KEYS_TTL_MS) return keys.byKid;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  keys = {
    at: Date.now(),
    byKid: new Map(body.keys.map((key) => [key.kid ?? "", key])),
  };
  return keys.byKid;
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** The token's claims if Cloudflare signed it for this application and it
 * has not expired, otherwise null. */
export async function verifyAccessJwt(
  token: string,
  team: string,
  audience: string,
  now = Date.now() / 1000,
): Promise<Record<string, unknown> | null> {
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return null;
  const header = decode(head);
  if (header.alg !== "RS256") return null;
  let key = (await signingKeys(team)).get(String(header.kid));
  if (!key) {
    // Cloudflare rotates its keys; one not seen yet means fetch again.
    keys = undefined;
    key = (await signingKeys(team)).get(String(header.kid));
  }
  if (!key) return null;
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    createPublicKey({ key, format: "jwk" }),
    Buffer.from(signature, "base64url"),
  );
  if (!valid) return null;
  const claims = decode(body);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) return null;
  if (typeof claims.exp !== "number" || claims.exp < now) return null;
  if (claims.iss !== `https://${team}`) return null;
  return claims;
}

function fromLoopback(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export default defineEventHandler(async (event) => {
  const team = process.env.CF_ACCESS_TEAM_DOMAIN;
  const audience = process.env.CF_ACCESS_AUD;
  if (!team || !audience) return;
  if (fromLoopback(event.node.req.socket.remoteAddress)) return;
  const token = getRequestHeader(event, "cf-access-jwt-assertion");
  const claims = token
    ? await verifyAccessJwt(token, team, audience).catch(() => null)
    : null;
  if (!claims) {
    throw createError({
      statusCode: 403,
      message: "Cloudflare Access required",
    });
  }
});
