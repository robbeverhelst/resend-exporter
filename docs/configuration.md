# Configuration

All configuration is via environment variables. The exporter fails fast at startup with a descriptive error when configuration is invalid.

## Reference

| Variable                              | Required | Default            | Description                                                                                                                                                                                     |
| ------------------------------------- | -------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_WEBHOOK_SECRET`               | yes      | —                  | Svix signing secret from the Resend webhook settings (`whsec_...`). Requests that fail signature verification are rejected with `401` and counted in `resend_webhook_signature_failures_total`. |
| `RESEND_API_KEY`                      | no       | —                  | Reserved for the upcoming API reconciliation features. Not used yet.                                                                                                                            |
| `RESEND_EXPORTER_ADDR`                | no       | `:8080`            | Listen address. `:8080` binds all interfaces; `127.0.0.1:8080` binds one.                                                                                                                       |
| `RESEND_EXPORTER_WEBHOOK_PATH`        | no       | `/webhooks/resend` | Path that receives Resend webhook POSTs. Must start with `/`.                                                                                                                                   |
| `RESEND_EXPORTER_METRICS_PATH`        | no       | `/metrics`         | Path serving Prometheus metrics. Must start with `/`.                                                                                                                                           |
| `RESEND_EXPORTER_LOG_LEVEL`           | no       | `info`             | Minimum log level: `debug`, `info`, `warn`, `error`.                                                                                                                                            |
| `RESEND_EXPORTER_REDACTION_MODE`      | no       | `strict`           | How much personal data reaches the logs. See below.                                                                                                                                             |
| `RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST` | no       | —                  | Comma-separated extra recipient domains that keep their own `to_domain` metric label value instead of being bucketed into `other`.                                                              |

## Redaction modes

Every accepted event produces one JSON log line. What that line contains depends on `RESEND_EXPORTER_REDACTION_MODE`:

| Mode               | `from_domain` / `to_domain` | `to_hash` / `subject_hash`                 | Full `to`, `from`, `subject` |
| ------------------ | --------------------------- | ------------------------------------------ | ---------------------------- |
| `strict` (default) | ✔                           | —                                          | —                            |
| `hash`             | ✔                           | ✔ (`sha256:<hex>` of the lowercased value) | —                            |
| `none`             | ✔                           | —                                          | ✔                            |

`strict` is safe for logs that end up in shared or public pipelines. `hash` lets you correlate repeated failures for the same recipient without storing the address. `none` is for private deployments where full addresses in logs are acceptable.

Example log line (mode `hash`):

```json
{
  "level": "warn",
  "message": "resend event received",
  "timestamp": "2026-07-21T00:24:00.000Z",
  "event_type": "email.bounced",
  "resend_email_id": "3ebe19b6-1dcc-4534-8442-9dc689ee439b",
  "from_domain": "example.com",
  "to_domain": "outlook.com",
  "recipient_count": 1,
  "reason": "Recipient mail server not found",
  "bounce_type": "hard",
  "to_hash": "sha256:…",
  "subject_hash": "sha256:…"
}
```

`email.bounced`, `email.failed`, and `email.complained` log at `warn`; other events log at `info`.

## Recipient-domain allowlist

The `to_domain` label on `resend_email_events_total` is bucketed to keep cardinality bounded (see [metrics.md](metrics.md)). If you routinely send to a partner domain you want to alert on separately:

```sh
RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST=partner.example,other-corp.example
```

Values are case-insensitive; whitespace around commas is ignored.
