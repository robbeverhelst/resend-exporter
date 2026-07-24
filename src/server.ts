import { Webhook } from "svix";
import type { Config } from "./config.ts";
import type { Logger } from "./logger.ts";
import { createMetrics, type Metrics } from "./metrics.ts";
import { createWebhookHandler } from "./webhook.ts";

export interface ExporterServer {
  server: Bun.Server<undefined>;
  metrics: Metrics;
}

export function createServer(config: Config, logger: Logger, port: number = config.port): ExporterServer {
  const metrics = createMetrics({ holdMs: config.seriesHoldSeconds * 1000 });
  const verifier = new Webhook(config.webhookSecret);
  const handleWebhook = createWebhookHandler({ config, metrics, logger, verifier });

  const server = Bun.serve({
    hostname: config.hostname,
    port,
    // Resend webhook payloads are a few KB; cap far below Bun's 128 MB
    // default so the internet-facing endpoint can't be fed huge bodies.
    maxRequestBodySize: 1024 * 1024,
    routes: {
      [config.webhookPath]: { POST: handleWebhook },
      [config.metricsPath]: {
        GET: async () => {
          metrics.applyMature();
          return new Response(await metrics.registry.metrics(), {
            headers: { "content-type": metrics.registry.contentType },
          });
        },
      },
      "/healthz": { GET: () => new Response("ok") },
      "/readyz": { GET: () => new Response("ok") },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });

  return { server, metrics };
}
