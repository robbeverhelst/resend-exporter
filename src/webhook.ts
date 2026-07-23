import { createHash } from "node:crypto";
import type { Webhook } from "svix";
import { z } from "zod";
import type { Config } from "./config.ts";
import { bucketToDomain, domainOf, UNKNOWN_DOMAIN } from "./domains.ts";
import type { LogFields, Logger } from "./logger.ts";
import type { Metrics } from "./metrics.ts";

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

const STANDARD_EMAIL_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.failed",
  "email.complained",
] as const;

/**
 * Pre-creates every standard event-type series for a label set at 0, so the
 * first bounce/failure/delay for a known domain is a visible 0→1 increment.
 * Without this, a series born mid-window at a nonzero value is invisible to
 * increase()/rate() — low-volume senders would see "0 bounced" on dashboards
 * and alerts would miss the first-ever bounce per domain.
 */
function ensureSeriesExist(metrics: Metrics, fromDomain: string, toDomain: string | undefined): void {
  for (const type of STANDARD_EMAIL_EVENTS) {
    metrics.webhookEvents.inc({ event_type: type, domain: fromDomain }, 0);
    if (toDomain !== undefined) {
      metrics.emailEvents.inc({ event_type: type, from_domain: fromDomain, to_domain: toDomain }, 0);
    }
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex")}`;
}

function eventLogFields(event: ResendEvent, config: Config): LogFields {
  const data = event.data;
  const recipients = typeof data?.to === "string" ? [data.to] : (data?.to ?? []);
  const firstRecipient = recipients[0];
  const fields: LogFields = {
    event_type: event.type,
    resend_email_id: data?.email_id,
    from_domain: domainOf(data?.from) ?? UNKNOWN_DOMAIN,
    to_domain: domainOf(firstRecipient) ?? UNKNOWN_DOMAIN,
    recipient_count: recipients.length,
    reason: data?.failed?.reason ?? data?.bounce?.message,
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
        metrics.handlerErrors.inc({ reason: "invalid_json" });
        logger.warn("webhook payload is not valid JSON");
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      metrics.signatureFailures.inc();
      logger.warn("webhook signature verification failed");
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }

    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) {
      metrics.handlerErrors.inc({ reason: "invalid_payload" });
      logger.warn("webhook payload has unexpected shape", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return Response.json({ error: "invalid payload" }, { status: 400 });
    }

    const event = parsed.data;
    const fromDomain = domainOf(event.data?.from) ?? UNKNOWN_DOMAIN;
    const recipients = typeof event.data?.to === "string" ? [event.data.to] : (event.data?.to ?? []);

    const isEmailEvent = event.type.startsWith("email.");
    const toDomain = isEmailEvent
      ? bucketToDomain(domainOf(recipients[0]), config.extraToDomains)
      : undefined;
    ensureSeriesExist(metrics, fromDomain, toDomain);

    metrics.webhookEvents.inc({ event_type: event.type, domain: fromDomain });
    metrics.lastEventTimestamp.set({ event_type: event.type }, Date.now() / 1000);

    if (isEmailEvent) {
      metrics.emailEvents.inc({ event_type: event.type, from_domain: fromDomain, to_domain: toDomain! });
    }

    const level = WARN_EVENTS.has(event.type) ? "warn" : "info";
    logger[level]("resend event received", eventLogFields(event, config));

    return Response.json({ ok: true });
  };
}
