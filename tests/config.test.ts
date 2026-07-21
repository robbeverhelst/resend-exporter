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

  test("rejects a missing or invalid port", () => {
    expect(() => parseAddr("8080")).toThrow();
    expect(() => parseAddr(":http")).toThrow();
    expect(() => parseAddr(":70000")).toThrow();
  });
});
