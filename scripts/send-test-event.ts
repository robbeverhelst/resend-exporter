/**
 * Sends a correctly Svix-signed test event to a running exporter, so you can
 * exercise the webhook path without real Resend traffic.
 *
 *   RESEND_WEBHOOK_SECRET=whsec_... bun scripts/send-test-event.ts [type] [url]
 *
 * Defaults: type email.delivered, url http://localhost:8080/webhooks/resend.
 * Example: bun scripts/send-test-event.ts email.bounced
 */
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env["RESEND_WEBHOOK_SECRET"];
if (!secret) {
  console.error("RESEND_WEBHOOK_SECRET is required");
  process.exit(1);
}

const type = process.argv[2] ?? "email.delivered";
const url = process.argv[3] ?? "http://localhost:8080/webhooks/resend";

const payload = JSON.stringify({
  type,
  created_at: new Date().toISOString(),
  data: {
    email_id: randomUUID(),
    from: "Acme <no-reply@acme.dev>",
    to: ["customer@outlook.com"],
    subject: "Order confirmation #1042",
    ...(type === "email.bounced" ? { bounce: { type: "hard", message: "mailbox unavailable" } } : {}),
    ...(type === "email.failed" ? { failed: { reason: "rate_limit_exceeded" } } : {}),
  },
});

const id = `msg_${randomUUID()}`;
const timestamp = Math.floor(Date.now() / 1000).toString();
const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");

const res = await fetch(url, {
  method: "POST",
  body: payload,
  headers: {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  },
});
console.log(`${type} -> ${res.status} ${await res.text()}`);
