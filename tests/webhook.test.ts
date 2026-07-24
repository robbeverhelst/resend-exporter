import { describe, expect, test } from "bun:test";
import { Webhook } from "svix";
import { createLogger } from "../src/logger.ts";
import { createMetrics, type MetricsOptions } from "../src/metrics.ts";
import { createWebhookHandler } from "../src/webhook.ts";
import { bouncedEvent, scrape, signPayload, TEST_SECRET, testConfig } from "./helpers.ts";

const bouncedLine = (n: number) =>
  `resend_email_events_total{event_type="email.bounced",from_domain="acme.example",to_domain="outlook.com"} ${n}`;

function setup(configOverrides = {}, metricsOptions: MetricsOptions = { holdMs: 0 }) {
  const config = testConfig(configOverrides);
  const metrics = createMetrics(metricsOptions);
  const lines: string[] = [];
  const logger = createLogger("debug", (line) => lines.push(line));
  const handler = createWebhookHandler({ config, metrics, logger, verifier: new Webhook(TEST_SECRET) });
  const post = (payload: string, headers: Record<string, string>) =>
    handler(new Request("http://localhost/webhooks/resend", { method: "POST", body: payload, headers }));
  return { config, metrics, lines, post };
}

describe("webhook handler", () => {
  test("accepts a signed event and updates metrics", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify(bouncedEvent());

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(200);
    await scrape(metrics);

    const webhookEvents = await metrics.webhookEvents.get();
    expect(webhookEvents.values).toContainEqual(
      expect.objectContaining({ value: 1, labels: { event_type: "email.bounced", domain: "acme.example" } }),
    );

    const emailEvents = await metrics.emailEvents.get();
    expect(emailEvents.values).toContainEqual(
      expect.objectContaining({
        value: 1,
        labels: { event_type: "email.bounced", from_domain: "acme.example", to_domain: "outlook.com" },
      }),
    );

    const lastEvent = await metrics.lastEventTimestamp.get();
    expect(lastEvent.values[0]?.value).toBeGreaterThan(Date.now() / 1000 - 60);
  });

  test("buckets unknown recipient domains into other", async () => {
    const { metrics, post } = setup();
    const event = bouncedEvent();
    (event["data"] as Record<string, unknown>)["to"] = ["someone@random-customer.io"];
    const payload = JSON.stringify(event);

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(200);

    const emailEvents = await metrics.emailEvents.get();
    expect(emailEvents.values[0]?.labels["to_domain"]).toBe("other");
  });

  test("keeps allowlisted recipient domains", async () => {
    const { metrics, post } = setup({ extraToDomains: new Set(["random-customer.io"]) });
    const event = bouncedEvent();
    (event["data"] as Record<string, unknown>)["to"] = ["someone@random-customer.io"];
    const payload = JSON.stringify(event);

    await post(payload, signPayload(payload));

    const emailEvents = await metrics.emailEvents.get();
    expect(emailEvents.values[0]?.labels["to_domain"]).toBe("random-customer.io");
  });

  test("rejects a bad signature and counts the failure", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify(bouncedEvent());

    const res = await post(payload, { ...signPayload(payload), "svix-signature": "v1,bm90LXZhbGlk" });
    expect(res.status).toBe(401);
    await scrape(metrics);

    const failures = await metrics.signatureFailures.get();
    expect(failures.values[0]?.value).toBe(1);
    expect((await metrics.webhookEvents.get()).values).toHaveLength(0);
  });

  test("rejects a missing signature", async () => {
    const { post } = setup();
    const payload = JSON.stringify(bouncedEvent());
    const res = await post(payload, {});
    expect(res.status).toBe(401);
  });

  test("counts signed but malformed JSON as invalid_json", async () => {
    const { metrics, post } = setup();
    const payload = "not json";

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(400);
    await scrape(metrics);

    const errors = await metrics.handlerErrors.get();
    expect(errors.values).toContainEqual(
      expect.objectContaining({ value: 1, labels: { reason: "invalid_json" } }),
    );
  });

  test("counts a payload without type as invalid_payload", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify({ data: {} });

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(400);
    await scrape(metrics);

    const errors = await metrics.handlerErrors.get();
    expect(errors.values).toContainEqual(
      expect.objectContaining({ value: 1, labels: { reason: "invalid_payload" } }),
    );
  });

  test("accepts non-email event types without email metrics", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify({ type: "domain.updated", data: {} });

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(200);
    await scrape(metrics);

    const webhookValues = (await metrics.webhookEvents.get()).values;
    const domainUpdated = webhookValues.find((v) => v.labels["event_type"] === "domain.updated");
    expect(domainUpdated?.value).toBe(1);
    expect((await metrics.emailEvents.get()).values).toHaveLength(0);
  });

  test("pre-creates all standard event series at 0 so increase() sees first events", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify(bouncedEvent());

    await post(payload, signPayload(payload));
    await scrape(metrics);

    const emailValues = (await metrics.emailEvents.get()).values;
    const byType = new Map(emailValues.map((v) => [v.labels["event_type"], v.value]));
    expect(byType.size).toBe(6);
    expect(byType.get("email.bounced")).toBe(1);
    for (const type of [
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.failed",
      "email.complained",
    ]) {
      expect(byType.get(type)).toBe(0);
    }
    for (const v of emailValues) {
      expect(v.labels["from_domain"]).toBe("acme.example");
      expect(v.labels["to_domain"]).toBe("outlook.com");
    }

    const webhookValues = (await metrics.webhookEvents.get()).values;
    expect(webhookValues).toHaveLength(6);
  });

  test("holds a new series at 0 for the hold window, for any number of readers", async () => {
    let clock = 0;
    const { metrics, post } = setup({}, { holdMs: 10_000, now: () => clock });
    const payload = JSON.stringify(bouncedEvent());

    await post(payload, signPayload(payload));

    // Every render inside the hold window sees 0 — a curl or a second
    // scraper cannot consume the observation.
    expect(await scrape(metrics)).toContain(bouncedLine(0));
    clock = 5_000;
    expect(await scrape(metrics)).toContain(bouncedLine(0));

    // After the hold window the buffered increment applies.
    clock = 10_001;
    expect(await scrape(metrics)).toContain(bouncedLine(1));

    // Events on a mature series count immediately.
    const payload2 = JSON.stringify(bouncedEvent());
    await post(payload2, signPayload(payload2));
    expect(await scrape(metrics)).toContain(bouncedLine(2));
  });

  test("multiple events inside the hold window all apply after it", async () => {
    let clock = 0;
    const { metrics, post } = setup({}, { holdMs: 10_000, now: () => clock });
    const payloads = Array.from({ length: 3 }, () => JSON.stringify(bouncedEvent()));
    await Promise.all(payloads.map((payload) => post(payload, signPayload(payload))));

    expect(await scrape(metrics)).toContain(
      'resend_email_events_total{event_type="email.bounced",from_domain="acme.example",to_domain="outlook.com"} 0',
    );
    clock = 10_001;
    expect(await scrape(metrics)).toContain(
      'resend_email_events_total{event_type="email.bounced",from_domain="acme.example",to_domain="outlook.com"} 3',
    );
  });

  test("non-email events do not create email.* series", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify({ type: "contact.created", data: {} });

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(200);
    await scrape(metrics);

    const webhookValues = (await metrics.webhookEvents.get()).values;
    expect(webhookValues).toHaveLength(1);
    expect(webhookValues[0]?.labels["event_type"]).toBe("contact.created");
    expect((await metrics.emailEvents.get()).values).toHaveLength(0);
  });

  test("initializes last-event timestamps at startup for staleness alerts", async () => {
    const { metrics } = setup();
    const body = await scrape(metrics);
    expect(body).toContain('resend_webhook_last_event_timestamp_seconds{event_type="email.delivered"}');
    expect(body).toContain('resend_webhook_last_event_timestamp_seconds{event_type="email.bounced"}');
  });
});

const parse = (lines: string[]) => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("redaction", () => {
  test("strict mode logs domains only", async () => {
    const { lines, post } = setup();
    const payload = JSON.stringify(bouncedEvent());
    await post(payload, signPayload(payload));

    const entry = parse(lines).find((l) => l["message"] === "resend event received");
    expect(entry).toBeDefined();
    expect(entry?.["level"]).toBe("warn");
    expect(entry?.["from_domain"]).toBe("acme.example");
    expect(entry?.["to_domain"]).toBe("outlook.com");
    expect(entry?.["reason"]).toBe("Recipient mail server not found");
    expect(entry?.["to"]).toBeUndefined();
    expect(entry?.["subject"]).toBeUndefined();
    expect(entry?.["to_hash"]).toBeUndefined();
    expect(entry?.["subject_hash"]).toBeUndefined();
  });

  test("hash mode logs stable hashes", async () => {
    const { lines, post } = setup({ redactionMode: "hash" });
    const payload = JSON.stringify(bouncedEvent());
    await post(payload, signPayload(payload));

    const entry = parse(lines).find((l) => l["message"] === "resend event received");
    expect(entry?.["to_hash"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry?.["subject_hash"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry?.["to"]).toBeUndefined();
    expect(entry?.["subject"]).toBeUndefined();
  });

  test("scrubs email addresses embedded in bounce reasons unless mode is none", async () => {
    const { lines, post } = setup();
    const event = bouncedEvent();
    (event["data"] as { bounce: { message: string } }).bounce.message =
      "550 5.1.1 <customer@outlook.com>: Recipient address rejected";
    const payload = JSON.stringify(event);
    await post(payload, signPayload(payload));

    const entry = parse(lines).find((l) => l["message"] === "resend event received");
    expect(entry?.["reason"]).toBe("550 5.1.1 <[email redacted]>: Recipient address rejected");
    expect(JSON.stringify(entry)).not.toContain("customer@outlook.com");
  });

  test("keeps raw bounce reasons in none mode", async () => {
    const { lines, post } = setup({ redactionMode: "none" });
    const event = bouncedEvent();
    (event["data"] as { bounce: { message: string } }).bounce.message =
      "550 5.1.1 <customer@outlook.com>: Recipient address rejected";
    const payload = JSON.stringify(event);
    await post(payload, signPayload(payload));

    const entry = parse(lines).find((l) => l["message"] === "resend event received");
    expect(entry?.["reason"]).toContain("customer@outlook.com");
  });

  test("none mode logs full addresses and subject", async () => {
    const { lines, post } = setup({ redactionMode: "none" });
    const payload = JSON.stringify(bouncedEvent());
    await post(payload, signPayload(payload));

    const entry = parse(lines).find((l) => l["message"] === "resend event received");
    expect(entry?.["to"]).toEqual(["customer@outlook.com"]);
    expect(entry?.["subject"]).toBe("Your appointment confirmation");
    expect(entry?.["from"]).toBe("Acme <no-reply@acme.example>");
  });
});
