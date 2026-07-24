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
  RESEND_EXPORTER_SERIES_HOLD_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
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
  seriesHoldSeconds: number;
}

export function parseAddr(addr: string): { hostname: string; port: number } {
  // Bracketed IPv6: "[::]:8080", "[2001:db8::1]:8080".
  const v6 = addr.match(/^\[(.+)\]:(\d+)$/);
  const [host, portStr] = v6
    ? [v6[1]!, v6[2]!]
    : (() => {
        const idx = addr.lastIndexOf(":");
        if (idx === -1 || addr.slice(0, idx).includes(":")) {
          throw new Error(
            `invalid listen address ${JSON.stringify(addr)}, expected "host:port", ":port", or "[ipv6]:port"`,
          );
        }
        return [addr.slice(0, idx), addr.slice(idx + 1)];
      })();
  const port = Number(portStr);
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
  const reserved = new Set(["/healthz", "/readyz"]);
  if (
    e.RESEND_EXPORTER_WEBHOOK_PATH === e.RESEND_EXPORTER_METRICS_PATH ||
    reserved.has(e.RESEND_EXPORTER_WEBHOOK_PATH) ||
    reserved.has(e.RESEND_EXPORTER_METRICS_PATH)
  ) {
    throw new Error(
      "invalid configuration: webhook path, metrics path, /healthz, and /readyz must all be distinct",
    );
  }
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
    seriesHoldSeconds: e.RESEND_EXPORTER_SERIES_HOLD_SECONDS,
  };
}
