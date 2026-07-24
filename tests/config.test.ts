import { describe, expect, test } from "bun:test";
import { loadConfig, parseAddr } from "../src/config.ts";

const base = { RESEND_WEBHOOK_SECRET: "whsec_test" };

describe("loadConfig", () => {
  test("applies defaults", () => {
    const config = loadConfig(base);
    expect(config.hostname).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.webhookPath).toBe("/webhooks/resend");
    expect(config.metricsPath).toBe("/metrics");
    expect(config.logLevel).toBe("info");
    expect(config.redactionMode).toBe("strict");
    expect(config.extraToDomains.size).toBe(0);
  });

  test("requires the webhook secret", () => {
    expect(() => loadConfig({})).toThrow(/RESEND_WEBHOOK_SECRET/);
  });

  test("rejects an invalid redaction mode", () => {
    expect(() => loadConfig({ ...base, RESEND_EXPORTER_REDACTION_MODE: "loose" })).toThrow(
      /invalid configuration/,
    );
  });

  test("rejects a webhook path without leading slash", () => {
    expect(() => loadConfig({ ...base, RESEND_EXPORTER_WEBHOOK_PATH: "hooks" })).toThrow(
      /invalid configuration/,
    );
  });

  test("rejects colliding or reserved paths", () => {
    expect(() => loadConfig({ ...base, RESEND_EXPORTER_WEBHOOK_PATH: "/metrics" })).toThrow(/distinct/);
    expect(() => loadConfig({ ...base, RESEND_EXPORTER_METRICS_PATH: "/healthz" })).toThrow(/distinct/);
  });

  test("parses the series hold window", () => {
    expect(loadConfig(base).seriesHoldSeconds).toBe(60);
    expect(loadConfig({ ...base, RESEND_EXPORTER_SERIES_HOLD_SECONDS: "120" }).seriesHoldSeconds).toBe(120);
    expect(() => loadConfig({ ...base, RESEND_EXPORTER_SERIES_HOLD_SECONDS: "-5" })).toThrow(
      /invalid configuration/,
    );
  });

  test("parses the extra to-domain allowlist", () => {
    const config = loadConfig({
      ...base,
      RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST: "Acme.example, partner.example ,",
    });
    expect(config.extraToDomains).toEqual(new Set(["acme.example", "partner.example"]));
  });
});

describe("parseAddr", () => {
  test("parses :port as all interfaces", () => {
    expect(parseAddr(":9090")).toEqual({ hostname: "0.0.0.0", port: 9090 });
  });

  test("parses host:port", () => {
    expect(parseAddr("127.0.0.1:8081")).toEqual({ hostname: "127.0.0.1", port: 8081 });
  });

  test("parses bracketed IPv6 addresses", () => {
    expect(parseAddr("[::]:9090")).toEqual({ hostname: "::", port: 9090 });
    expect(parseAddr("[2001:db8::1]:8080")).toEqual({ hostname: "2001:db8::1", port: 8080 });
  });

  test("rejects a missing or invalid port", () => {
    expect(() => parseAddr("8080")).toThrow();
    expect(() => parseAddr(":http")).toThrow();
    expect(() => parseAddr(":70000")).toThrow();
    expect(() => parseAddr("::1:8080")).toThrow(/ipv6/);
  });
});
