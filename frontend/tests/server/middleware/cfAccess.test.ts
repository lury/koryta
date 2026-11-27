import { describe, expect, it, vi, beforeAll } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyAccessJwt } from "../../../server/middleware/cfAccess";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).defineEventHandler = (fn: unknown) => fn;
});

const team = "koryta.cloudflareaccess.com";
const aud = "aud-tag";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function token(claims: Record<string, unknown>, kid = "k1"): string {
  const part = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const signed = `${part({ alg: "RS256", kid })}.${part(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signed), privateKey);
  return `${signed}.${signature.toString("base64url")}`;
}

describe("verifyAccessJwt", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }],
        }),
      ),
    );
  });
  const now = 1_800_000_000;
  const good = { aud: [aud], iss: `https://${team}`, exp: now + 60 };

  it("accepts a token Cloudflare signed for this application", async () => {
    expect(await verifyAccessJwt(token(good), team, aud, now)).toMatchObject({
      aud: [aud],
    });
  });

  it.each([
    ["another application", { ...good, aud: ["other"] }],
    ["an expired token", { ...good, exp: now - 1 }],
    ["another team", { ...good, iss: "https://evil.cloudflareaccess.com" }],
  ])("refuses %s", async (_, claims) => {
    expect(await verifyAccessJwt(token(claims), team, aud, now)).toBeNull();
  });

  it("refuses a signature by a key Cloudflare does not publish", async () => {
    expect(
      await verifyAccessJwt(token(good, "unknown"), team, aud, now),
    ).toBeNull();
    const [head, body] = token(good).split(".");
    expect(
      await verifyAccessJwt(`${head}.${body}.AAAA`, team, aud, now),
    ).toBeNull();
  });
});
