import type postgres from "postgres";

/** A query as the code under test sent it: its text with `$n` for each
 * value, and the values. */
export type LoggedQuery = { text: string; args: unknown[] };

/** `sql` with each tagged-template query it runs pushed to `log`, so that a
 * test can say which queries a call made and EXPLAIN them. */
export function logQueries(
  sql: postgres.Sql,
  log: LoggedQuery[],
): postgres.Sql {
  return new Proxy(sql, {
    apply(target, self, args: unknown[]) {
      const [strings, ...values] = args;
      if (Array.isArray(strings) && "raw" in strings) {
        log.push({
          text: (strings as string[]).reduce((t, s, i) => `${t}$${i}${s}`),
          args: values,
        });
      }
      return Reflect.apply(target, self, args);
    },
  });
}

/** The plan of `query` with sequential scans priced out, so that it names
 * the index the query can use, if there is one. */
export async function planOf(
  sql: postgres.Sql,
  query: LoggedQuery,
): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    const rows = await tx.unsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN ${query.text}`,
      query.args as never[],
    );
    return rows.map((row) => row["QUERY PLAN"]).join("\n");
  });
}
