/** `values` as a Postgres array literal, for `${textArray(xs)}::text[]`.
 *
 * `sql.array` sent `a,b` rather than `{a,b}` from inside a fragment and with
 * some casts ("malformed array literal"), so lists go as one text parameter. */
export function textArray(values: readonly string[]): string {
  const quoted = values.map(
    (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${quoted.join(",")}}`;
}
