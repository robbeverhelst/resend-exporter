# Metrics

All metrics are served on `RESEND_EXPORTER_METRICS_PATH` (default `/metrics`) in the Prometheus text format. Counters are in-memory and reset on restart — that is normal for Prometheus exporters; use `increase()`/`rate()` in queries.

To keep `increase()`/`rate()` honest for low-volume senders, the exporter guarantees Prometheus always observes a series' 0 before any increment:

1. When any event arrives for a domain, all six standard event-type series are created at 0 for that label set (a series that appears mid-window at a nonzero value contributes nothing to `increase()`).
2. A brand-new series' first increments are deferred until its 0 has been scraped once — the first scrape sees 0, the next sees the real count. Every event is therefore countable by `increase()`; the trade-off is that a new series' first events appear one scrape interval (~15–30s) late.

The bundled dashboard's count tiles additionally use exact sample deltas (`max_over_time(...) - min_over_time(...)`) instead of `increase()`, so they display true integers rather than rate-extrapolated estimates like `2.5`. (`increase()` remains the right choice for alert rules — it tolerates counter resets across pod restarts, where the sample-delta form can overcount within the restart window.)

## Reference

| Metric                                        | Type    | Labels                                   | Description                                                                                                           |
| --------------------------------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `resend_webhook_events_total`                 | counter | `event_type`, `domain`                   | Every accepted webhook event. `domain` is the sending domain.                                                         |
| `resend_email_events_total`                   | counter | `event_type`, `from_domain`, `to_domain` | Accepted `email.*` events. `to_domain` is bucketed (see below).                                                       |
| `resend_webhook_signature_failures_total`     | counter | —                                        | Requests rejected because Svix signature verification failed. A steady rate means a wrong secret or unsigned traffic. |
| `resend_webhook_handler_errors_total`         | counter | `reason`                                 | Authentic requests the handler could not process: `invalid_json`, `invalid_payload`.                                  |
| `resend_webhook_last_event_timestamp_seconds` | gauge   | `event_type`                             | Unix timestamp of the most recently accepted event per type. Useful for "no events received lately" alerts.           |
| `resend_exporter_build_info`                  | gauge   | `version`                                | Always 1; the label carries the exporter version (release builds inject it, source runs report `dev`).                |

## Event types

The exporter accepts any event type Resend sends and labels metrics with it verbatim. The delivery-health events are:

`email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.failed`, `email.complained`

Engagement events (`email.opened`, `email.clicked`), domain events, and contact events are counted in `resend_webhook_events_total` too; only `email.*` types additionally appear in `resend_email_events_total`.

## Cardinality design

Prometheus labels must stay low-cardinality. Two rules keep them that way:

1. **No per-email labels.** Email IDs, recipients, and subjects never become labels — that detail lives in the structured logs.
2. **Bucketed recipient domains.** `from_domain` is your own verified sending domains (bounded). `to_domain` is not — any customer domain can appear — so it is bucketed: a built-in allowlist of well-known consumer providers (gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, proton.me, aol.com, gmx.*, web.de, zoho.com, fastmail.com, qq.com, 163.com, naver.com, t-online.de, orange.fr, free.fr, comcast.net, telenet.be, and friends) keeps its own value, everything else becomes `other`, and missing recipients become `unknown`.

That still answers the operational question — "is outlook.com bouncing our mail?" — without letting label cardinality grow with your customer base. Extend the allowlist with `RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST` for partner domains you alert on separately.

## Planned

- `resend_email_delivery_delay_seconds` histogram
- `resend_email_bounces_total{bounce_type,bounce_subtype}` breakdown
- Reconciliation metrics (`resend_reconcile_*`) once optional Resend API support lands
