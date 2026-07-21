/**
 * Recipient domains are unbounded (any customer domain can appear), so the
 * `to_domain` metric label is bucketed: well-known consumer providers keep
 * their own label value, everything else collapses into "other". Operators can
 * extend the allowlist via RESEND_EXPORTER_TO_DOMAIN_ALLOWLIST.
 */
export const DEFAULT_TO_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "daum.net",
  "t-online.de",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "cox.net",
  "telenet.be",
  "skynet.be",
  "proximus.be",
  "ziggo.nl",
  "kpnmail.nl",
  "libero.it",
  "seznam.cz",
]);

export const OTHER_DOMAIN = "other";
export const UNKNOWN_DOMAIN = "unknown";

/**
 * Extract the domain from an address like "a@b.com" or "Name <a@b.com>".
 */
export function domainOf(address: string | undefined): string | undefined {
  if (!address) {
    return undefined;
  }
  const angled = address.match(/<([^<>]+)>/);
  const email = (angled?.[1] ?? address).trim();
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) {
    return undefined;
  }
  return email.slice(at + 1).toLowerCase();
}

export function bucketToDomain(domain: string | undefined, extra: ReadonlySet<string>): string {
  if (!domain) {
    return UNKNOWN_DOMAIN;
  }
  const normalized = domain.toLowerCase();
  if (DEFAULT_TO_DOMAINS.has(normalized) || extra.has(normalized)) {
    return normalized;
  }
  return OTHER_DOMAIN;
}
