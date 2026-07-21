# resend-exporter

Prometheus exporter and webhook receiver for [Resend](https://resend.com) email events.

`resend-exporter` receives Resend webhook events, verifies their signatures, exposes Prometheus metrics, and emits structured logs that can be shipped to Loki or any other log pipeline.

The main use case is alerting on transactional email delivery problems in Grafana/Prometheus:

- bounced appointment confirmations
- failed transactional emails
- delivery delays that persist long enough to matter
- spam complaints or suppression-related events

## Status

Specification-only repository. Implementation not started yet.

## Goals

- Receive Resend webhook events over HTTP.
- Verify webhook signatures before accepting events.
- Expose Prometheus metrics on `/metrics`.
- Emit structured JSON logs for operational detail and debugging.
- Keep labels low-cardinality and safe for public dashboards.
- Support Grafana alerting examples for bounced, failed, and delayed emails.
- Optionally use the Resend API for reconciliation, enrichment, and webhook configuration checks.
- Be generic enough for any Resend user, not tied to one application.

## Non-Goals

- Replacing Resend's dashboard.
- Storing full email content.
- Sending alert notifications directly.
- Acting as a general webhook automation platform.
- Depending on Grafana, Loki, or Kubernetes at runtime.
- Requiring a Resend API key for basic webhook-only operation.

Alert routing belongs in Grafana Alerting, Alertmanager, ntfy, Slack, Telegram, PagerDuty, or whatever the operator already uses.

## Proposed HTTP Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/webhooks/resend` | Receive Resend webhook events |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/readyz` | Readiness probe |

## Supported Resend Events

Initial event support should focus on delivery health:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.failed`
- `email.complained`

Later support can include:

- `email.opened`
- `email.clicked`
- `email.received`
- domain events
- contact/audience events

## Optional Resend API Usage

The exporter should work without a Resend API key when used as a pure webhook receiver.

When `RESEND_API_KEY` is configured, the exporter can use the Resend API for stronger monitoring:

- backfill events after exporter downtime
- reconcile recent sent emails against received webhook events
- enrich sparse webhook events with sent-email or log details
- verify webhook configuration still includes critical events
- expose domain or configuration health metrics

Useful API surfaces:

- `GET /emails` - list sent emails
- `GET /emails/:id` - retrieve a sent email
- `GET /logs` - list delivery/log records
- `GET /webhooks` - list configured webhooks
- `POST /webhooks` / update / delete - manage webhook configuration

API usage should be optional because webhook-only deployments are simpler and need fewer permissions.

### Reconciliation Mode

Reconciliation mode should periodically look back over a small time window and compare Resend's API state with locally observed webhook events.

Example use cases:

- the exporter was down while Resend retried and eventually bounced an email
- a webhook delivery failed or expired before reaching the exporter
- a deployment lost in-memory counters and needs a recent baseline

Suggested configuration:

| Variable | Required | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | no | Enables Resend API features |
| `RESEND_EXPORTER_RECONCILE_ENABLED` | no | Enable periodic API reconciliation |
| `RESEND_EXPORTER_RECONCILE_INTERVAL` | no | Reconciliation interval, default `5m` |
| `RESEND_EXPORTER_RECONCILE_LOOKBACK` | no | API lookback window, default `1h` |

Suggested metrics:

```text
resend_reconcile_runs_total{status="success"}
resend_reconcile_errors_total{reason="api_error"}
resend_reconcile_last_success_timestamp_seconds
resend_webhook_configured{event_type="email.bounced"} 1
```

## Proposed Metrics

Metrics should avoid high-cardinality labels such as full recipient email, subject, or Resend email ID.

```text
resend_webhook_events_total{
  event_type="email.bounced",
  domain="example.com"
}

resend_email_events_total{
  event_type="email.failed",
  from_domain="example.com",
  to_domain="outlook.com"
}

resend_webhook_signature_failures_total

resend_webhook_handler_errors_total{
  reason="invalid_json"
}

resend_webhook_last_event_timestamp_seconds{
  event_type="email.delivered"
}
```

Optional future metrics:

```text
resend_email_delivery_delay_seconds_bucket
resend_email_bounces_total{bounce_type="hard", bounce_subtype="NoEmail"}
resend_email_failures_total{reason="quota_exceeded"}
resend_email_complaints_total
```

## Structured Logs

Metrics answer "how many" and "is this bad enough to alert".

Logs answer "which email broke and why".

Each accepted event should produce one JSON log line with fields similar to:

```json
{
  "level": "warn",
  "event_type": "email.bounced",
  "resend_email_id": "3ebe19b6-1dcc-4534-8442-9dc689ee439b",
  "from_domain": "example.com",
  "to_domain": "outlook.be",
  "to_hash": "sha256:...",
  "subject_hash": "sha256:...",
  "reason": "Recipient mail server not found",
  "timestamp": "2026-07-21T00:24:00Z"
}
```

By default, sensitive values should be redacted or hashed:

- full recipient email
- full sender email
- subject
- webhook payload body

Operators can opt into less redaction for private deployments.

## Configuration

Suggested environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `RESEND_WEBHOOK_SECRET` | yes | Secret used to verify Resend webhook signatures |
| `RESEND_API_KEY` | no | Enables API reconciliation, enrichment, and config checks |
| `RESEND_EXPORTER_ADDR` | no | Listen address, default `:8080` |
| `RESEND_EXPORTER_WEBHOOK_PATH` | no | Webhook path, default `/webhooks/resend` |
| `RESEND_EXPORTER_METRICS_PATH` | no | Metrics path, default `/metrics` |
| `RESEND_EXPORTER_LOG_LEVEL` | no | `debug`, `info`, `warn`, `error` |
| `RESEND_EXPORTER_REDACTION_MODE` | no | `strict`, `hash`, or `none`; default `strict` |

## Grafana Alert Examples

### Any Failed Email

Alert when any email fails to send:

```promql
increase(resend_email_events_total{event_type="email.failed"}[5m]) > 0
```

### Any Bounced Transactional Email

Alert when a transactional email bounces:

```promql
increase(resend_email_events_total{event_type="email.bounced"}[5m]) > 0
```

### Repeated Delivery Delays

Alert when delivery delays accumulate:

```promql
increase(resend_email_events_total{event_type="email.delivery_delayed"}[30m]) >= 3
```

## Deployment Ideas

The project should eventually ship:

- single static binary
- Docker image
- Helm chart
- Kubernetes manifests
- Grafana dashboard JSON
- PrometheusRule examples

## Design Notes

This project should act like a normal Prometheus exporter even though it receives webhook events instead of polling an API.

The webhook receiver updates in-memory counters and gauges. Prometheus scrapes `/metrics`. Detailed event data is emitted as logs, not labels.

That split keeps alerting reliable without turning Prometheus into a database of email subjects and recipients.

## License

TBD.
