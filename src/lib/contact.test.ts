import { expect, test } from "bun:test";
import { handleContact, type ContactSender } from "./contact";

const config = { RESEND_API_KEY: "test-key", CONTACT_FROM_EMAIL: "Store <contact@example.com>" };
const fields = {
  name: "Visitor",
  email: "visitor@example.com",
  phone: "",
  message: "Order question",
};
function request(data: unknown = fields, origin = "https://store.example") {
  return new Request("https://store.example/api/contact", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

test("contact delivery fixes the recipient server-side and hides provider details", async () => {
  let payload: Record<string, unknown> = {};
  const send = (async (_url, options) => {
    payload = JSON.parse(options!.body as string);
    return Response.json({ id: "email-test" });
  }) as ContactSender;
  const response = await handleContact(
    request({ ...fields, to: "attacker@example.com" }),
    config,
    send,
  );
  expect(response.status).toBe(200);
  expect(payload.to).toEqual(["osbyrne1@gmail.com"]);
  expect(payload.reply_to).toBe(fields.email);
  expect(payload.from).toBe(config.CONTACT_FROM_EMAIL);
  expect(await response.text()).not.toContain("gmail.com");

  const failure = await handleContact(
    request(),
    config,
    (async () =>
      new Response("private provider details: osbyrne1@gmail.com", {
        status: 422,
      })) as ContactSender,
  );
  expect(failure.status).toBe(502);
  expect(await failure.text()).not.toContain("gmail.com");
});

test("invalid, cross-origin, oversized and honeypot submissions never send email", async () => {
  let calls = 0;
  const send = (async () => {
    calls++;
    return Response.json({ id: "unexpected" });
  }) as ContactSender;
  expect((await handleContact(request({ ...fields, email: "invalid" }), config, send)).status).toBe(
    400,
  );
  expect(
    (await handleContact(request(fields, "https://elsewhere.example"), config, send)).status,
  ).toBe(403);
  expect(
    (await handleContact(request({ ...fields, message: "x".repeat(17000) }), config, send)).status,
  ).toBe(413);
  expect((await handleContact(request({ ...fields, website: "spam" }), config, send)).status).toBe(
    200,
  );
  expect((await handleContact(request(), {}, send)).status).toBe(503);
  expect(calls).toBe(0);
});
