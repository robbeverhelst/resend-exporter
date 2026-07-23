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
  const metrics = createMetrics();
  const verifier = new Webhook(config.webhookSecret);
  const handleWebhook = createWebhookHandler({ config, metrics, logger, verifier });

  const server = Bun.serve({
    hostname: config.hostname,
    port,
    routes: {
      [config.webhookPath]: { POST: handleWebhook },
      [config.metricsPath]: {
        GET: async () => {
          const flush = metrics.prepareScrapeFlush();
          const body = await metrics.registry.metrics();
          flush();
          return new Response(body, {
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
