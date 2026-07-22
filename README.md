# resend-exporter

[![CI](https://github.com/robbeverhelst/resend-exporter/actions/workflows/ci.yaml/badge.svg)](https://github.com/robbeverhelst/resend-exporter/actions/workflows/ci.yaml)
[![Release](https://github.com/robbeverhelst/resend-exporter/actions/workflows/release.yaml/badge.svg)](https://github.com/robbeverhelst/resend-exporter/actions/workflows/release.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Prometheus exporter and webhook receiver for [Resend](https://resend.com) email events.

`resend-exporter` receives Resend webhook events, verifies their [Svix](https://docs.svix.com) signatures, exposes Prometheus metrics on `/metrics`, and emits structured JSON logs that can be shipped to Loki or any other log pipeline.

The main use case is alerting on transactional email delivery problems in Grafana/Prometheus:

- bounced appointment confirmations
- failed transactional emails
- delivery delays that persist long enough to matter
- spam complaints or suppression-related events

Metrics answer "how many, and is it bad enough to alert". Logs answer "which email broke and why". Prometheus never becomes a database of email subjects and recipients: labels stay low-cardinality by construction, and sensitive values are redacted or hashed in logs by default.

## How it works

```
Resend ──POST /webhooks/resend──▶ resend-exporter ──▶ /metrics ──▶ Prometheus ──▶ Grafana alerts
         (Svix-signed events)          │
                                       └──▶ structured JSON logs ──▶ Loki (optional)
```

| Method | Path               | Purpose                       |
| ------ | ------------------ | ----------------------------- |
| `POST` | `/webhooks/resend` | Receive Resend webhook events |
| `GET`  | `/metrics`         | Prometheus metrics            |
| `GET`  | `/healthz`         | Liveness probe                |
| `GET`  | `/readyz`          | Readiness probe               |

## Quickstart

### Docker

```sh
docker run -p 8080:8080 \
  -e RESEND_WEBHOOK_SECRET=whsec_... \
  ghcr.io/robbeverhelst/resend-exporter:latest
```

Point a Resend webhook at `https://your-host/webhooks/resend`, then scrape `http://your-host:8080/metrics`.

### Helm

```sh
helm install resend-exporter oci://ghcr.io/robbeverhelst/charts/resend-exporter \
  --set resend.webhookSecret=whsec_... \
  --set serviceMonitor.enabled=true
```

The webhook path must be reachable by Resend from the internet — enable `ingress` in the chart values or bring your own route. See [docs/deployment.md](docs/deployment.md).

### Local playground

```sh
RESEND_WEBHOOK_SECRET=whsec_... docker compose up --build
```

Brings up the exporter, Prometheus (with [example alert rules](examples/prometheus/alerts.yml)), and Grafana on `localhost:3000` with the [bundled dashboard](examples/grafana/dashboards/resend-exporter.json) preloaded.

## Configuration

| Variable                              | Required | Default            | Description                                                        |
| ------------------------------------- | -------- | ------------------ | ------------------------------------------------------------------ |
| `RESEND_WEBHOOK_SECRET`               | yes      | —                  | Svix signing secret (`whsec_...`) from the Resend webhook settings |
| `RESEND_EXPORTER_ADDR`                | no       | `:8080`            | Listen address (`host:port` or `:port`)                            |
| `RESEND_EXPORTER_WEBHOOK_PATH`        | no       | `/webhooks/resend` | Webhook path                                                       |
| `RESEND_EXPORTER_METRICS_PATH`        | no       | `/metrics`         | Metrics path                                                       |
| `RESEND_EXPORTER_LOG_LEVEL`           | no       | `info`             | `debug`, `info`, `warn`, `error`                                   |
| `RESEND_EXPORTER_REDACTION_MODE`      | no       | `strict`           | `strict`, `hash`, or `none`                                        |
| `RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST` | no       | —                  | Extra recipient domains kept as their own `to_domain` label value  |

Full reference: [docs/configuration.md](docs/configuration.md).

## Metrics

```text
resend_webhook_events_total{event_type="email.bounced",domain="example.com"}
resend_email_events_total{event_type="email.bounced",from_domain="example.com",to_domain="outlook.com"}
resend_webhook_signature_failures_total
resend_webhook_handler_errors_total{reason="invalid_json"}
resend_webhook_last_event_timestamp_seconds{event_type="email.delivered"}
```

Recipient domains are bucketed: well-known consumer providers (gmail.com, outlook.com, …) keep their own `to_domain` value, everything else becomes `other`, so one busy adopter can't blow up label cardinality. Details: [docs/metrics.md](docs/metrics.md).

Ready-made PromQL alert rules for failed, bounced, and delayed email: [docs/alerting.md](docs/alerting.md).

## Documentation

- [Configuration](docs/configuration.md) — every environment variable, redaction modes
- [Metrics](docs/metrics.md) — metric reference and cardinality design
- [Alerting](docs/alerting.md) — PromQL alert examples for Grafana/Alertmanager
- [Deployment](docs/deployment.md) — Docker, Helm, docker-compose, exposing the webhook
- [Development](docs/development.md) — building, testing, and the release process

## Roadmap

- Optional Resend API reconciliation: backfill missed events after downtime, verify webhook configuration, and enrich sparse events (`RESEND_API_KEY` is already reserved for this)
- Delivery-delay histogram and bounce-type breakdown metrics
- PrometheusRule manifests

Non-goals: replacing the Resend dashboard, storing email content, and sending alert notifications directly — routing belongs in Grafana Alerting, Alertmanager, ntfy, Slack, or PagerDuty.

## License

[MIT](LICENSE)
