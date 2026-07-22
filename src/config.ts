import { z } from "zod";

const envSchema = z.object({
  RESEND_WEBHOOK_SECRET: z.string().min(1, "RESEND_WEBHOOK_SECRET is required"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_EXPORTER_ADDR: z.string().default(":8080"),
  RESEND_EXPORTER_WEBHOOK_PATH: z.string().startsWith("/").default("/webhooks/resend"),
  RESEND_EXPORTER_METRICS_PATH: z.string().startsWith("/").default("/metrics"),
  RESEND_EXPORTER_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RESEND_EXPORTER_REDACTION_MODE: z.enum(["strict", "hash", "none"]).default("strict"),
  RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST: z.string().default(""),
});

export type LogLevel = z.infer<typeof envSchema>["RESEND_EXPORTER_LOG_LEVEL"];
export type RedactionMode = z.infer<typeof envSchema>["RESEND_EXPORTER_REDACTION_MODE"];

export interface Config {
  webhookSecret: string;
  apiKey: string | undefined;
  hostname: string;
  port: number;
  webhookPath: string;
  metricsPath: string;
  logLevel: LogLevel;
  redactionMode: RedactionMode;
  extraToDomains: Set<string>;
}

export function parseAddr(addr: string): { hostname: string; port: number } {
  const idx = addr.lastIndexOf(":");
  if (idx === -1) {
    throw new Error(`invalid listen address ${JSON.stringify(addr)}, expected "host:port" or ":port"`);
  }
  const host = addr.slice(0, idx);
  const port = Number(addr.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port in listen address ${JSON.stringify(addr)}`);
  }
  return { hostname: host === "" ? "0.0.0.0" : host, port };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid configuration: ${details}`);
  }
  const e = parsed.data;
  const { hostname, port } = parseAddr(e.RESEND_EXPORTER_ADDR);
  const extraToDomains = new Set(
    e.RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST.split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0),
  );
  return {
    webhookSecret: e.RESEND_WEBHOOK_SECRET,
    apiKey: e.RESEND_API_KEY,
    hostname,
    port,
    webhookPath: e.RESEND_EXPORTER_WEBHOOK_PATH,
    metricsPath: e.RESEND_EXPORTER_METRICS_PATH,
    logLevel: e.RESEND_EXPORTER_LOG_LEVEL,
    redactionMode: e.RESEND_EXPORTER_REDACTION_MODE,
    extraToDomains,
  };
}
