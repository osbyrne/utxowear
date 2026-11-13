import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { about } from "../styles/about.stylex";
import { pageMetadata } from "../lib/page-metadata";

export const Route = createFileRoute("/about")({
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/about", title: "About — utxowear" }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div {...stylex.props(about.content)}>
      <article {...stylex.props(about.article)} aria-labelledby="about-title">
        <h1 id="about-title" {...stylex.props(about.heading)}>
          About
        </h1>
        <p {...stylex.props(about.copy)}>
          UTxO stands for Unspent Transaction (Tx) Outputs. It is the accounting model behind
          Bitcoin. I started reading whitepapers to understand the technology, and quickly wanted to
          wear their colors.
        </p>
      </article>
    </div>
  );
}
