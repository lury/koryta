/** A deployment that must stay out of search engines - the private demo on a
 * server of our own (docs/postgres/README.md) - sets `KORYTA_NOINDEX=true` (or 1):
 * every response says `noindex`, and robots.txt disallows everything. Read
 * at runtime, so the same image serves either way. */
export default defineEventHandler((event) => {
  if (!["true", "1"].includes(process.env.KORYTA_NOINDEX ?? "")) return;
  setResponseHeader(event, "X-Robots-Tag", "noindex, nofollow");
  if (event.path === "/robots.txt") {
    setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return "User-agent: *\nDisallow: /\n";
  }
});
