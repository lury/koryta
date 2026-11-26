import * as h3 from "h3";
import { withQuery } from "ufo";

type Validate = (data: unknown) => unknown;

/** h3's own `getValidatedQuery` on a query a test hands in. A parser that
 * throws comes back as the 400 a request would get, not as a bare ZodError,
 * and the query goes through the url the way a request's does - every value a
 * string, a repeated key an array. */
export function validatedQuery(
  query: Record<string, unknown>,
  validate: Validate,
) {
  return h3.getValidatedQuery(
    { path: withQuery("/", query) } as unknown as h3.H3Event,
    validate,
  );
}

/** h3's own `readValidatedBody` on a body a test hands in, as JSON. */
export function validatedBody(body: unknown, validate: Validate) {
  const req = { method: "POST", headers: {}, body };
  return h3.readValidatedBody(
    { method: "POST", node: { req } } as unknown as h3.H3Event,
    validate,
  );
}
