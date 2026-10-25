// Server-only: never import this module from a hydrated component or browser script.
type ContactBindings = {
  RESEND_API_KEY?: string;
  CONTACT_FROM_EMAIL?: string;
};

export type ContactSender = (url: string, options: RequestInit) => Promise<Response>;

const recipient = "osbyrne1@gmail.com";
const unavailable = "Your message could not be sent. Please try again later.";

export async function handleContact(
  request: Request,
  bindings: ContactBindings,
  send: ContactSender = fetch,
): Promise<Response> {
  const reply = (message: string, status = 200) =>
    Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return reply("Please submit the form from this website.", 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return reply("Invalid message format.", 415);

  // Bound the body even when Content-Length is absent or untrusted.
  const reader = request.body?.getReader();
  if (!reader) return reply("Please complete the contact form.", 400);
  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_000) {
        await reader.cancel();
        return reply("Your message is too long.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const data = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return reply("Please complete the contact form.", 400);
    const field = (key: string) => (typeof data[key] === "string" ? data[key].trim() : "");
    if (field("website")) return reply("Thank you. Your message has been submitted.");
    const name = field("name");
    const email = field("email");
    const phone = field("phone");
    const message = field("message");
    if (
      !name ||
      name.length > 100 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
      email.length > 254 ||
      /[\r\n]/.test(email) ||
      phone.length > 50 ||
      !message ||
      message.length > 5000
    )
      return reply("Enter a name, valid email, and message (up to 5,000 characters).", 400);
    if (!bindings.RESEND_API_KEY || !bindings.CONTACT_FROM_EMAIL) return reply(unavailable, 503);

    try {
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bindings.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: bindings.CONTACT_FROM_EMAIL,
          to: [recipient],
          reply_to: email,
          subject: "utxowear contact form",
          text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\n\n${message}`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // Provider responses may contain recipient/configuration details; never return them.
      if (!response.ok) return reply(unavailable, 502);
      return reply("Thank you. Your message has been submitted.");
    } catch {
      return reply(unavailable, 502);
    }
  } catch {
    return reply("Please complete the contact form.", 400);
  }
}
