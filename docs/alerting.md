# Alerting

The exporter only exposes metrics — alert routing belongs in Grafana Alerting or Alertmanager, delivered to whatever you already use (Slack, ntfy, Telegram, PagerDuty, …).

Ready-to-use Prometheus rules live in [`examples/prometheus/alerts.yml`](../examples/prometheus/alerts.yml); the PromQL underneath:

## Any failed email

```promql
increase(resend_email_events_total{event_type="email.failed"}[5m]) > 0
```

For transactional email, a single failure is usually worth a page — the user did not get their confirmation.

## Any bounced email

```promql
increase(resend_email_events_total{event_type="email.bounced"}[5m]) > 0
```

Narrow it to a specific recipient provider:

```promql
increase(resend_email_events_total{event_type="email.bounced",to_domain="outlook.com"}[15m]) > 3
```

## Repeated delivery delays

```promql
increase(resend_email_events_total{event_type="email.delivery_delayed"}[30m]) >= 3
```

One delay is noise; several in half an hour means a provider is throttling or greylisting you.

## Webhook pipeline health

Signature failures (wrong secret, or someone probing the endpoint):

```promql
increase(resend_webhook_signature_failures_total[15m]) > 0
```

Exporter has stopped receiving events it used to receive (dead webhook config, broken ingress):

```promql
time() - resend_webhook_last_event_timestamp_seconds{event_type="email.delivered"} > 86400
```

Tune the threshold to your sending volume — a low-volume sender may legitimately be quiet for a day.

## Exporter uptime

Standard scrape-health alert:

```promql
up{job="resend-exporter"} == 0
```
