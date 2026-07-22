# Deployment

The exporter ships three ways per release: a multi-arch Docker image, a Helm chart (OCI), and standalone binaries attached to the [GitHub release](https://github.com/robbeverhelst/resend-exporter/releases).

Whatever you choose, two things must be true:

1. **Resend can reach the webhook path** (`/webhooks/resend`) over HTTPS from the internet.
2. **Prometheus can reach `/metrics`** — which should _not_ be internet-exposed. If you route the webhook path through an ingress, route only that path.

## Docker

```sh
docker run -p 8080:8080 \
  -e RESEND_WEBHOOK_SECRET=whsec_... \
  ghcr.io/robbeverhelst/resend-exporter:latest
```

Images are published to `ghcr.io/robbeverhelst/resend-exporter` for `linux/amd64` and `linux/arm64`, built from a distroless base (no shell, runs as nonroot). Pin a version tag in production.

## Helm

```sh
helm install resend-exporter oci://ghcr.io/robbeverhelst/charts/resend-exporter \
  --set resend.webhookSecret=whsec_...
```

In production, keep the secret out of Helm values:

```sh
kubectl create secret generic resend-webhook \
  --from-literal=webhook-secret=whsec_...

helm install resend-exporter oci://ghcr.io/robbeverhelst/charts/resend-exporter \
  --set resend.existingSecret=resend-webhook
```

Useful values (see [`charts/resend-exporter/values.yaml`](../charts/resend-exporter/values.yaml) for everything):

| Value                                                | Default              | Purpose                                                         |
| ---------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `resend.existingSecret` / `resend.existingSecretKey` | — / `webhook-secret` | Use a pre-created Secret                                        |
| `serviceMonitor.enabled`                             | `false`              | Create a Prometheus Operator ServiceMonitor                     |
| `ingress.enabled`                                    | `false`              | Expose the webhook path; defaults route only `/webhooks/resend` |
| `config.redactionMode`                               | `strict`             | Log redaction mode                                              |
| `config.toDomainAllowlist`                           | `[]`                 | Extra `to_domain` label values                                  |

The chart applies a restrictive security context by default (nonroot, read-only root filesystem, all capabilities dropped).

## docker-compose playground

```sh
RESEND_WEBHOOK_SECRET=whsec_... docker compose up --build
```

- exporter on [localhost:8080](http://localhost:8080/metrics)
- Prometheus on [localhost:9090](http://localhost:9090) with the [example alert rules](../examples/prometheus/alerts.yml) loaded
- Grafana on [localhost:3000](http://localhost:3000) (anonymous admin) with the Prometheus datasource provisioned

To exercise it end-to-end, expose port 8080 with a tunnel (e.g. `cloudflared tunnel` or `ngrok http 8080`) and point a Resend webhook at the tunnel URL + `/webhooks/resend`.

## Grafana dashboard

A ready-made dashboard ships at [`examples/grafana/dashboards/resend-exporter.json`](../examples/grafana/dashboards/resend-exporter.json): headline stats (delivered / bounced / failed / complaints / delayed / time since last event), event rates by type, delivery problems over time, bounces by recipient provider, per-domain volume, and webhook pipeline health (signature failures, handler errors).

The compose playground provisions it automatically. In your own Grafana: **Dashboards → New → Import**, upload the JSON, and pick your Prometheus datasource (the dashboard asks — it's templated, not hardcoded). It also works with a dashboard sidecar (e.g. kube-prometheus-stack's `grafana.sidecar.dashboards`) by mounting the JSON in a ConfigMap labeled `grafana_dashboard: "1"`.

## Standalone binary

Each release attaches self-contained binaries (no Bun installation needed) for Linux and macOS, x64 and arm64:

```sh
curl -fsSLo resend-exporter \
  https://github.com/robbeverhelst/resend-exporter/releases/latest/download/resend-exporter-linux-x64
chmod +x resend-exporter
RESEND_WEBHOOK_SECRET=whsec_... ./resend-exporter
```

## Configuring the Resend webhook

In the Resend dashboard: **Webhooks → Add webhook**, endpoint `https://your-host/webhooks/resend`, and enable at least the delivery-health events (`email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.failed`, `email.complained`). Copy the signing secret into `RESEND_WEBHOOK_SECRET`.
