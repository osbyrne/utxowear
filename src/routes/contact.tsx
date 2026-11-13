import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import { contact } from "../styles/contact.stylex";
import { pageMetadata } from "../lib/page-metadata";

export const Route = createFileRoute("/contact")({
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/contact", title: "Contact — utxowear" }),
  component: ContactPage,
});

const decodeContactResponse = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }));

function ContactPage() {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result: unknown = await response.json();
      setMessage(decodeContactResponse(result).message);
      if (response.ok) form.reset();
    } catch {
      setMessage("Your message could not be sent. Please try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div {...stylex.props(contact.content)}>
      <article {...stylex.props(contact.article)} aria-labelledby="contact-title">
        <h1 id="contact-title" {...stylex.props(contact.heading)}>
          Contact
        </h1>
        <p {...stylex.props(contact.intro)}>
          Have a question about a product or your order? Send us a message using the form below.
        </p>
        <form id="contact-form" {...stylex.props(contact.form)} onSubmit={submit}>
          <div {...stylex.props(contact.row)}>
            <label {...stylex.props(styles.field)}>
              <span>Name</span>
              <input
                {...stylex.props(styles.input)}
                name="name"
                autoComplete="name"
                required
                maxLength={100}
              />
            </label>
            <label {...stylex.props(styles.field)}>
              <span>Email</span>
              <input
                {...stylex.props(styles.input)}
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          </div>
          <label {...stylex.props(styles.field)}>
            <span>Phone number (optional)</span>
            <input
              {...stylex.props(styles.input)}
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={50}
            />
          </label>
          <label {...stylex.props(styles.field)}>
            <span>Message</span>
            <textarea
              {...stylex.props(styles.input, contact.message)}
              name="message"
              rows={10}
              required
              maxLength={5000}
            />
          </label>
          <label {...stylex.props(contact.trap)} aria-hidden="true">
            Leave this field empty
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <p id="contact-status" role="status" aria-live="polite">
            {message}
          </p>
          <button
            {...stylex.props(styles.primaryButton, contact.submit)}
            type="submit"
            disabled={!ready || pending}
          >
            {pending ? "Sending…" : "Send message"}
          </button>
          <noscript>Please enable JavaScript to send a message.</noscript>
        </form>
      </article>
    </div>
  );
}
