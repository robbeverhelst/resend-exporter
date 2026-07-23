import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createServer } from "./server.ts";
import { VERSION } from "./version.ts";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: (error as Error).message }));
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  const { server } = createServer(config, logger);

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    void server.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("resend-exporter listening", {
    version: VERSION,
    addr: `${config.hostname}:${config.port}`,
    webhook_path: config.webhookPath,
    metrics_path: config.metricsPath,
    redaction_mode: config.redactionMode,
  });
}

main();
