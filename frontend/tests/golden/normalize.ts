/** What a golden fixture stores of a response: the JSON with the values that
 * differ from run to run replaced by stable placeholders.
 *
 * - Ids the server makes up (20 mixed-case characters like Firestore's,
 *   UUIDs) become `<id>`. Not numbered: the order they are made in is not
 *   the same from run to run.
 * - Instants of the run's own time (seeded with `new Date()`, written by it,
 *   or "a week before now") become `<now>`, also inside strings; the seed's
 *   own dates (midnight UTC) stay.
 * - Epoch milliseconds near the run become `<now-ms>`.
 * - Object keys are sorted. */
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;

export class Masker {
  constructor(private readonly started = Date.now()) {}

  private recent(ms: number): boolean {
    return ms > this.started - 40 * 86_400_000 && ms < Date.now() + 86_400_000;
  }

  private id(_token: string): string {
    return "<id>";
  }

  string(value: string): string {
    return value
      .replace(ISO, (m) => {
        const ms = Date.parse(m);
        return !Number.isNaN(ms) && this.recent(ms) && ms % 86_400_000 !== 0
          ? "<now>"
          : m;
      })
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        (m) => this.id(m),
      )
      .replace(/(?<![A-Za-z0-9])[A-Za-z0-9]{20}(?![A-Za-z0-9])/g, (m) =>
        /[a-z]/.test(m) && /[A-Z]/.test(m) ? this.id(m) : m,
      );
  }

  value(value: unknown): unknown {
    if (typeof value === "string") return this.string(value);
    if (typeof value === "number") {
      if (Number.isInteger(value) && value > 1e12 && this.recent(value)) {
        return "<now-ms>";
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => this.value(v));
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (
        typeof obj._seconds === "number" &&
        typeof obj._nanoseconds === "number"
      ) {
        return this.value(new Date(obj._seconds * 1000).toISOString());
      }
      // Keys that are made-up ids mask to the same key: their values are
      // kept together, in a stable order, under `<id>*`.
      const grouped = new Map<string, unknown[]>();
      for (const k of Object.keys(obj)) {
        const key = this.string(k);
        grouped.set(key, [...(grouped.get(key) ?? []), this.value(obj[k])]);
      }
      return Object.fromEntries(
        [...grouped.entries()]
          .map(([k, values]): [string, unknown] =>
            values.length === 1
              ? [k, values[0]]
              : [
                  `${k}*`,
                  values.sort((x, y) =>
                    JSON.stringify(x) < JSON.stringify(y) ? -1 : 1,
                  ),
                ],
          )
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
      );
    }
    return value;
  }
}

/** Paths where `a` and `b` differ, at most `limit`. Numbers within half a
 * percent (or 0.05) are equal: tenure and other "years since" values grow
 * with the clock between a recording and its replay. */
export function differences(
  a: unknown,
  b: unknown,
  path = "$",
  out: string[] = [],
  limit = 20,
  order: string[] = [],
): string[] {
  if (out.length >= limit) return out;
  if (typeof a === "number" && typeof b === "number") {
    const tolerance = Math.max(
      0.05,
      0.005 * Math.max(Math.abs(a), Math.abs(b)),
    );
    if (Math.abs(a - b) > tolerance) out.push(`${path}: ${a} → ${b}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: length ${a.length} → ${b.length}`);
    }
    const inner: string[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      differences(a[i], b[i], `${path}[${i}]`, inner, limit, order);
    }
    if (inner.length && a.length === b.length && sameItems(a, b)) {
      order.push(path);
    } else out.push(...inner.slice(0, limit - out.length));
    return out;
  }
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!(key in y)) out.push(`${path}.${key}: removed`);
      else if (!(key in x)) out.push(`${path}.${key}: added`);
      else differences(x[key], y[key], `${path}.${key}`, out, limit, order);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (a !== b) {
    out.push(
      `${path}: ${String(JSON.stringify(a)).slice(0, 80)} → ${String(JSON.stringify(b)).slice(0, 80)}`,
    );
  }
  return out;
}

/** The same items in another order: ties a sort may break either way. */
function sameItems(a: unknown[], b: unknown[]): boolean {
  const key = (v: unknown) =>
    JSON.stringify(v, (_k, x) =>
      typeof x === "number" ? Math.round(x * 10) / 10 : x,
    );
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.every((v, i) => v === y[i]);
}
