import type { NodeOptions } from "@sentry/nuxt";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";

/** What turns the server's Sentry into a local tracer that reports to Jaeger,
 * or nothing.
 *
 * Only for a local run with OTEL_EXPORTER_OTLP_ENDPOINT set (by hand, or by
 * compose.tracing.yaml). A deployed backend gets nothing from here whatever
 * its environment holds, so it keeps exactly the setup in
 * sentry.server.config.ts.
 *
 * Sentry's tracing is OpenTelemetry underneath, so one more span processor on
 * its tracer provider gets every span it makes: the request span from its
 * http integration, and the outgoing fetches under it. The `postgres` client
 * reports no spans of its own, so a query shows as the time inside the
 * request span, not as a span.
 *
 * The client has to be enabled for its integrations to run at all, request
 * spans included. Its transport drops every envelope instead, so nothing - no
 * error, transaction or log - leaves for Sentry. */
export function localTracingOptions(
  deployed: boolean,
  env: NodeJS.ProcessEnv = process.env,
): NodeOptions {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (deployed || !endpoint) return {};
  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
  });
  return {
    enabled: true,
    tracesSampleRate: 1,
    openTelemetrySpanProcessors: [
      new BatchSpanProcessor({ exporter, scheduledDelayMillis: 500 }),
    ],
    transport: () => ({ send: async () => ({}), flush: async () => true }),
  };
}
