import { afterAll, describe, expect, test } from "bun:test";
import { createLogger } from "../src/logger.ts";
import { createServer } from "../src/server.ts";
import { bouncedEvent, signPayload, testConfig } from "./helpers.ts";

const config = testConfig();
const { server } = createServer(
  config,
  createLogger("error", () => {}),
  0,
);
const base = `http://127.0.0.1:${server.port}`;

afterAll(async () => {
  await server.stop();
});

describe("server", () => {
  test("healthz and readyz respond", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });

  test("unknown routes return 404", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  test("metrics endpoint exposes accepted events in Prometheus format", async () => {
    const payload = JSON.stringify(bouncedEvent());
    const res = await fetch(`${base}/webhooks/resend`, {
      method: "POST",
      body: payload,
      headers: signPayload(payload),
    });
    expect(res.status).toBe(200);

    const metricsRes = await fetch(`${base}/metrics`);
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.headers.get("content-type")).toContain("text/plain");
    const body = await metricsRes.text();
    expect(body).toContain('resend_webhook_events_total{event_type="email.bounced",domain="acme.example"} 1');
    expect(body).toContain(
      'resend_email_events_total{event_type="email.bounced",from_domain="acme.example",to_domain="outlook.com"} 1',
    );
    expect(body).toContain("resend_webhook_last_event_timestamp_seconds");
  });

  test("webhook route only accepts POST", async () => {
    expect((await fetch(`${base}/webhooks/resend`)).status).toBe(404);
  });
});
