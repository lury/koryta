/** What the golden runner (run.ts) and the API benchmark
 * (scripts/pg/bench-api.ts) share: signing in the two test accounts on the
 * Auth emulator and sending a step of tests/golden/scenario.ts. */
import type { As, Ctx, Step } from "../../tests/golden/scenario";

export const ACCOUNTS: Record<Exclude<As, "anon">, string> = {
  user: "user@koryta.pl",
  admin: "admin@koryta.pl",
};

export async function token(auth: string, email: string): Promise<string> {
  const res = await fetch(
    `${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=golden`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok)
    throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

/** A token for each signed-in role. */
export async function tokens(
  auth: string,
): Promise<Partial<Record<As, string>>> {
  const out: Partial<Record<As, string>> = {};
  for (const [as, email] of Object.entries(ACCOUNTS)) {
    out[as as As] = await token(auth, email);
  }
  return out;
}

/** The step's path and query, `extra` appended. */
export function url(
  step: Step,
  ctx: Ctx,
  extra: Record<string, string> = {},
): string {
  const path = typeof step.path === "function" ? step.path(ctx) : step.path;
  const query = typeof step.query === "function" ? step.query(ctx) : step.query;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...extra })) {
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export type Sent = {
  method: string;
  path: string;
  body: unknown;
  status: number;
  ms: number;
  bytes: number;
  /** The parsed JSON, or the text when it is not JSON. */
  answer: unknown;
};

/** Sends `step` as its role, and hands its answer to `step.save`. */
export async function send(
  base: string,
  step: Step,
  ctx: Ctx,
  auth: Partial<Record<As, string>>,
  extra: Record<string, string> = {},
): Promise<Sent> {
  const as = step.as ?? "anon";
  const method = step.method ?? "GET";
  const path = url(step, ctx, extra);
  const body = typeof step.body === "function" ? step.body(ctx) : step.body;
  const headers: Record<string, string> = {};
  if (auth[as]) headers.authorization = `Bearer ${auth[as]}`;
  if (step.reader) headers["x-reader-id"] = step.reader;
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let answer: unknown = text;
  if ((res.headers.get("content-type") ?? "").includes("json")) {
    try {
      answer = JSON.parse(text);
    } catch {
      answer = text;
    }
  }
  step.save?.(answer, ctx);
  return {
    method,
    path,
    body,
    status: res.status,
    ms,
    bytes: Buffer.byteLength(text),
    answer,
  };
}
