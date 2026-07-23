import { Counter, Gauge, Registry } from "prom-client";

export interface Metrics {
  registry: Registry;
  webhookEvents: Counter<"event_type" | "domain">;
  emailEvents: Counter<"event_type" | "from_domain" | "to_domain">;
  signatureFailures: Counter<string>;
  handlerErrors: Counter<"reason">;
  lastEventTimestamp: Gauge<"event_type">;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  const metrics: Metrics = {
    registry,
    webhookEvents: new Counter({
      name: "resend_webhook_events_total",
      help: "Total Resend webhook events received, by event type and sending domain.",
      labelNames: ["event_type", "domain"],
      registers: [registry],
    }),
    emailEvents: new Counter({
      name: "resend_email_events_total",
      help: "Total Resend email events, by event type, sending domain, and bucketed recipient domain.",
      labelNames: ["event_type", "from_domain", "to_domain"],
      registers: [registry],
    }),
    signatureFailures: new Counter({
      name: "resend_webhook_signature_failures_total",
      help: "Total webhook requests rejected because signature verification failed.",
      registers: [registry],
    }),
    handlerErrors: new Counter({
      name: "resend_webhook_handler_errors_total",
      help: "Total webhook requests rejected by the handler, by reason.",
      labelNames: ["reason"],
      registers: [registry],
    }),
    lastEventTimestamp: new Gauge({
      name: "resend_webhook_last_event_timestamp_seconds",
      help: "Unix timestamp of the most recently accepted webhook event, by event type.",
      labelNames: ["event_type"],
      registers: [registry],
    }),
  };
  // Expose fixed-label series from the first scrape so increase()/rate()
  // see the first-ever failure as a 0→1 increment, not an invisible birth.
  metrics.signatureFailures.inc(0);
  metrics.handlerErrors.inc({ reason: "invalid_json" }, 0);
  metrics.handlerErrors.inc({ reason: "invalid_payload" }, 0);
  return metrics;
}
