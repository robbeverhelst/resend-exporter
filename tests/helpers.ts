import { createHmac, randomUUID } from "node:crypto";
import type { Config } from "../src/config.ts";
import { loadConfig } from "../src/config.ts";
import type { Metrics } from "../src/metrics.ts";

/** Simulates one Prometheus scrape: renders /metrics and applies deferred increments. */
export async function scrape(metrics: Metrics): Promise<string> {
  const flush = metrics.prepareScrapeFlush();
  const body = await metrics.registry.metrics();
  flush();
  return body;
}

export const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ RESEND_WEBHOOK_SECRET: TEST_SECRET }),
    ...overrides,
  };
}

export function signPayload(payload: string, secret: string = TEST_SECRET): Record<string, string> {
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

export function bouncedEvent(): Record<string, unknown> {
  return {
    type: "email.bounced",
    created_at: "2026-07-21T00:24:00.000Z",
    data: {
      email_id: "3ebe19b6-1dcc-4534-8442-9dc689ee439b",
      from: "Acme <no-reply@acme.example>",
      to: ["customer@outlook.com"],
      subject: "Your appointment confirmation",
      bounce: { type: "hard", message: "Recipient mail server not found" },
    },
  };
}
