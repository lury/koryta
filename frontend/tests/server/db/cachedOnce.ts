/** `defineCachedFunction` keeping its first answer, as Nitro does for its
 * `maxAge`: imported after declarationsHarness.ts and before the handler
 * whose cache a test reads. */
(globalThis as Record<string, unknown>).defineCachedFunction = (
  fn: (...args: unknown[]) => Promise<unknown>,
) => {
  let cached: unknown;
  return async (...args: unknown[]) => (cached ??= await fn(...args));
};
