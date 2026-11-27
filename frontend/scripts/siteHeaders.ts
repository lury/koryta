/** Headers for a script's requests to the site: the Cloudflare Access
 * service token, when CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are
 * set, for a deployment behind Access (docs/postgres/README.md). Only for
 * the site; the token goes to no other host. The pipelines' copy is
 * data/pipelines/src/util/cf_access.py. */
export function accessHeaders(): Record<string, string> {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) return {};
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

/** Where the site is: KORYTA_URL, or the dev server. */
export function siteUrl(): string {
  return (process.env.KORYTA_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
}
