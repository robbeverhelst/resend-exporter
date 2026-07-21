import { describe, expect, test } from "bun:test";
import { bucketToDomain, domainOf } from "../src/domains.ts";

describe("domainOf", () => {
  test("extracts the domain from a plain address", () => {
    expect(domainOf("user@example.com")).toBe("example.com");
  });

  test("extracts the domain from a display-name address", () => {
    expect(domainOf("Acme Support <no-reply@Acme.Example>")).toBe("acme.example");
  });

  test("returns undefined for missing or malformed input", () => {
    expect(domainOf(undefined)).toBeUndefined();
    expect(domainOf("")).toBeUndefined();
    expect(domainOf("not-an-email")).toBeUndefined();
    expect(domainOf("trailing@")).toBeUndefined();
  });
});

describe("bucketToDomain", () => {
  const extra = new Set(["partner.example"]);

  test("keeps well-known provider domains", () => {
    expect(bucketToDomain("gmail.com", extra)).toBe("gmail.com");
    expect(bucketToDomain("Outlook.com", extra)).toBe("outlook.com");
  });

  test("keeps operator-allowlisted domains", () => {
    expect(bucketToDomain("partner.example", extra)).toBe("partner.example");
  });

  test("collapses everything else into other", () => {
    expect(bucketToDomain("random-customer-domain.io", extra)).toBe("other");
  });

  test("maps missing domains to unknown", () => {
    expect(bucketToDomain(undefined, extra)).toBe("unknown");
  });
});
