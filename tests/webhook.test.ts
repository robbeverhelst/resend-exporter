import { describe, expect, test } from "bun:test";
import { Webhook } from "svix";
import { createLogger } from "../src/logger.ts";
import { createMetrics } from "../src/metrics.ts";
import { createWebhookHandler } from "../src/webhook.ts";
import { bouncedEvent, signPayload, TEST_SECRET, testConfig } from "./helpers.ts";

function setup(configOverrides = {}) {
  const config = testConfig(configOverrides);
  const metrics = createMetrics();
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

    const webhookEvents = await metrics.webhookEvents.get();
    expect(webhookEvents.values).toEqual([
      expect.objectContaining({ value: 1, labels: { event_type: "email.bounced", domain: "acme.example" } }),
    ]);

    const emailEvents = await metrics.emailEvents.get();
    expect(emailEvents.values).toEqual([
      expect.objectContaining({
        value: 1,
        labels: { event_type: "email.bounced", from_domain: "acme.example", to_domain: "outlook.com" },
      }),
    ]);

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

    const errors = await metrics.handlerErrors.get();
    expect(errors.values).toEqual([
      expect.objectContaining({ value: 1, labels: { reason: "invalid_json" } }),
    ]);
  });

  test("counts a payload without type as invalid_payload", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify({ data: {} });

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(400);

    const errors = await metrics.handlerErrors.get();
    expect(errors.values[0]?.labels["reason"]).toBe("invalid_payload");
  });

  test("accepts non-email event types without email metrics", async () => {
    const { metrics, post } = setup();
    const payload = JSON.stringify({ type: "domain.updated", data: {} });

    const res = await post(payload, signPayload(payload));
    expect(res.status).toBe(200);

    expect((await metrics.webhookEvents.get()).values[0]?.labels["event_type"]).toBe("domain.updated");
    expect((await metrics.emailEvents.get()).values).toHaveLength(0);
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
