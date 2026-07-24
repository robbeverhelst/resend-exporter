import { Counter, Gauge, Registry } from "prom-client";
import { VERSION } from "./version.ts";

export const STANDARD_EMAIL_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.failed",
  "email.complained",
] as const;

export interface MetricsOptions {
  /**
   * How long a brand-new series stays at its scrapeable 0 before deferred
   * increments apply. Must be >= the longest scrape interval pointed at this
   * exporter so every scraper observes the 0; see docs/metrics.md.
   */
  holdMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

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
   * Increment a counter. Increments on a series younger than the hold window
   * are buffered (bounded by series cardinality, not event volume) and apply
   * once the series has been at 0 long enough for every scraper to have
   * observed it — a series born at a nonzero value is invisible to
   * increase()/rate(). Renders never consume the observation, so manual
   * curls, uptime checkers, and HA scraper pairs are all safe.
   */
  inc(counter: Counter<string>, name: string, labels: Record<string, string>): void;
  /** Apply buffered increments for series older than the hold window. Called before each render. */
  applyMature(): void;
}

interface Newborn {
  counter: Counter<string>;
  labels: Record<string, string>;
  count: number;
  bornAt: number;
}

const key = (name: string, labels: Record<string, string>) =>
  `${name}|${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const holdMs = options.holdMs ?? 60_000;
  const now = options.now ?? Date.now;
  const registry = new Registry();
  const seen = new Set<string>();
  const newborn = new Map<string, Newborn>();

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
      help: "Unix timestamp of the most recently accepted webhook event (or process start), by event type.",
      labelNames: ["event_type"],
      registers: [registry],
    }),
    ensureZero(counter, name, labels) {
      const k = key(name, labels);
      if (!seen.has(k)) {
        counter.inc(labels, 0);
        seen.add(k);
        newborn.set(k, { counter, labels, count: 0, bornAt: now() });
      }
    },
    inc(counter, name, labels) {
      metrics.ensureZero(counter, name, labels);
      const k = key(name, labels);
      const nb = newborn.get(k);
      if (nb === undefined) {
        counter.inc(labels);
        return;
      }
      if (now() - nb.bornAt >= holdMs) {
        counter.inc(labels, nb.count + 1);
        newborn.delete(k);
      } else {
        nb.count += 1;
      }
    },
    applyMature() {
      const at = now();
      for (const [k, nb] of newborn) {
        if (at - nb.bornAt >= holdMs) {
          if (nb.count > 0) {
            nb.counter.inc(nb.labels, nb.count);
          }
          newborn.delete(k);
        }
      }
    },
  };

  new Gauge({
    name: "resend_exporter_build_info",
    help: "Build information about the exporter; always 1.",
    labelNames: ["version"],
    registers: [registry],
  }).set({ version: VERSION }, 1);

  // Fixed-label series exist from process start; the first scrape observes
  // their 0 so later increments are always visible to increase().
  metrics.ensureZero(metrics.signatureFailures, "signature_failures", {});
  metrics.ensureZero(metrics.handlerErrors, "handler_errors", { reason: "invalid_json" });
  metrics.ensureZero(metrics.handlerErrors, "handler_errors", { reason: "invalid_payload" });

  // Initialize per-type last-event timestamps to process start so staleness
  // alerts (time() - metric > threshold) have a series to evaluate even
  // before the first event after a restart.
  for (const type of STANDARD_EMAIL_EVENTS) {
    metrics.lastEventTimestamp.set({ event_type: type }, now() / 1000);
  }

  return metrics;
}
