import { createHash } from "node:crypto";
import type { Webhook } from "svix";
import { z } from "zod";
import type { Config } from "./config.ts";
import { bucketToDomain, domainOf, UNKNOWN_DOMAIN } from "./domains.ts";
import type { LogFields, Logger } from "./logger.ts";
import { type Metrics, STANDARD_EMAIL_EVENTS } from "./metrics.ts";

const eventSchema = z.object({
  type: z.string().min(1),
  created_at: z.string().optional(),
  data: z
    .looseObject({
      email_id: z.string().optional(),
      from: z.string().optional(),
      to: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string().optional(),
      bounce: z.looseObject({ type: z.string().optional(), message: z.string().optional() }).optional(),
      failed: z.looseObject({ reason: z.string().optional() }).optional(),
    })
    .optional(),
});

export type ResendEvent = z.infer<typeof eventSchema>;

const WARN_EVENTS = new Set(["email.bounced", "email.failed", "email.complained"]);

const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Pre-creates every standard email event-type series for a label set at 0, so
 * the first bounce/failure/delay for a known domain is a visible 0→1
 * increment. Without this, a series born mid-window at a nonzero value is
 * invisible to increase()/rate() — low-volume senders would see "0 bounced"
 * on dashboards and alerts would miss the first-ever bounce per domain.
 */
function ensureSeriesExist(metrics: Metrics, fromDomain: string, toDomain: string): void {
  for (const type of STANDARD_EMAIL_EVENTS) {
    metrics.ensureZero(metrics.webhookEvents, "webhook_events", { event_type: type, domain: fromDomain });
    metrics.ensureZero(metrics.emailEvents, "email_events", {
      event_type: type,
      from_domain: fromDomain,
      to_domain: toDomain,
    });
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex")}`;
}

interface DerivedFields {
  fromDomain: string;
  recipients: string[];
}

function eventLogFields(event: ResendEvent, config: Config, derived: DerivedFields): LogFields {
  const data = event.data;
  const { fromDomain, recipients } = derived;
  const firstRecipient = recipients[0];
  const rawReason = data?.failed?.reason ?? data?.bounce?.message;
  const fields: LogFields = {
    event_type: event.type,
    resend_email_id: data?.email_id,
    from_domain: fromDomain,
    to_domain: domainOf(firstRecipient) ?? UNKNOWN_DOMAIN,
    recipient_count: recipients.length,
    // Upstream bounce/failure text routinely embeds the full recipient
    // address; scrub it unless the operator opted out of redaction.
    reason:
      rawReason === undefined || config.redactionMode === "none"
        ? rawReason
        : rawReason.replace(EMAIL_ADDRESS, "[email redacted]"),
    bounce_type: data?.bounce?.type,
    event_created_at: event.created_at,
  };
  if (config.redactionMode === "hash") {
    fields["to_hash"] = firstRecipient === undefined ? undefined : sha256(firstRecipient);
    fields["subject_hash"] = data?.subject === undefined ? undefined : sha256(data.subject);
  } else if (config.redactionMode === "none") {
    fields["from"] = data?.from;
    fields["to"] = recipients;
    fields["subject"] = data?.subject;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      delete fields[key];
    }
  }
  return fields;
}

export interface WebhookDeps {
  config: Config;
  metrics: Metrics;
  logger: Logger;
  verifier: Webhook;
}

export function createWebhookHandler({ config, metrics, logger, verifier }: WebhookDeps) {
  return async (req: Request): Promise<Response> => {
    const payload = await req.text();

    // svix verifies the signature and then JSON-parses the payload, so a
    // SyntaxError here means "authentic but malformed", not "forged".
    let json: unknown;
    try {
      json = verifier.verify(payload, {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        metrics.inc(metrics.handlerErrors, "handler_errors", { reason: "invalid_json" });
        logger.warn("webhook payload is not valid JSON");
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      metrics.inc(metrics.signatureFailures, "signature_failures", {});
      logger.warn("webhook signature verification failed");
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }

    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) {
      metrics.inc(metrics.handlerErrors, "handler_errors", { reason: "invalid_payload" });
      logger.warn("webhook payload has unexpected shape", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return Response.json({ error: "invalid payload" }, { status: 400 });
    }

    const event = parsed.data;
    const fromDomain = domainOf(event.data?.from) ?? UNKNOWN_DOMAIN;
    const recipients = typeof event.data?.to === "string" ? [event.data.to] : (event.data?.to ?? []);
    const isEmailEvent = event.type.startsWith("email.");

    if (isEmailEvent) {
      const toDomain = bucketToDomain(domainOf(recipients[0]), config.extraToDomains);
      ensureSeriesExist(metrics, fromDomain, toDomain);
      metrics.inc(metrics.emailEvents, "email_events", {
        event_type: event.type,
        from_domain: fromDomain,
        to_domain: toDomain,
      });
    }

    metrics.inc(metrics.webhookEvents, "webhook_events", { event_type: event.type, domain: fromDomain });
    metrics.lastEventTimestamp.set({ event_type: event.type }, Date.now() / 1000);

    const level = WARN_EVENTS.has(event.type) ? "warn" : "info";
    logger[level]("resend event received", eventLogFields(event, config, { fromDomain, recipients }));

    return Response.json({ ok: true });
  };
}
