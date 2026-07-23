import { Counter, Gauge, Registry } from "prom-client";

export interface Metrics {
  registry: Registry;
  webhookEvents: Counter<"event_type" | "domain">;
  emailEvents: Counter<"event_type" | "from_domain" | "to_domain">;
  signatureFailures: Counter<string>;
  handlerErrors: Counter<"reason">;
  lastEventTimestamp: Gauge<"event_type">;
  /** Create a series at 0 without incrementing it. */
  ensureZero(counter: Counter<string>, name: string, labels: Record<string, string>): void;
  /**
   * Increment a counter, deferring the very first increment of a brand-new
   * series until its 0 has been scraped once. A series born at a nonzero
   * value is invisible to increase()/rate(); deferring guarantees Prometheus
   * observes the 0→N transition, at the cost of the first event appearing
   * one scrape interval late.
   */
  inc(counter: Counter<string>, name: string, labels: Record<string, string>): void;
  /**
   * Call before rendering /metrics. Returns a closure to call after
   * rendering: it marks the rendered series as scraped and applies their
   * deferred increments so the next scrape sees them.
   */
  prepareScrapeFlush(): () => void;
}

const key = (name: string, labels: Record<string, string>) =>
  `${name}|${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;

export function createMetrics(): Metrics {
  const registry = new Registry();
  const seen = new Set<string>();
  const unscraped = new Set<string>();
  let pending: Array<() => void> = [];

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
    ensureZero(counter, name, labels) {
      const k = key(name, labels);
      if (!seen.has(k)) {
        counter.inc(labels, 0);
        seen.add(k);
        unscraped.add(k);
      }
    },
    inc(counter, name, labels) {
      metrics.ensureZero(counter, name, labels);
      const k = key(name, labels);
      if (unscraped.has(k)) {
        pending.push(() => counter.inc(labels));
      } else {
        counter.inc(labels);
      }
    },
    prepareScrapeFlush() {
      // Snapshot before rendering: series created or incremented while the
      // render is in flight belong to the next scrape, not this one.
      const flushPending = pending;
      pending = [];
      const flushKeys = [...unscraped];
      return () => {
        for (const k of flushKeys) {
          unscraped.delete(k);
        }
        for (const apply of flushPending) {
          apply();
        }
      };
    },
  };

  // Fixed-label series exist from process start; the first scrape observes
  // their 0 so later increments are always visible to increase().
  metrics.ensureZero(metrics.signatureFailures, "signature_failures", {});
  metrics.ensureZero(metrics.handlerErrors, "handler_errors", { reason: "invalid_json" });
  metrics.ensureZero(metrics.handlerErrors, "handler_errors", { reason: "invalid_payload" });
  return metrics;
}
