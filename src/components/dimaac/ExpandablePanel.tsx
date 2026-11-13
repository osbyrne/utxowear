// Source: https://ui.dimaac.com/r/expandable-panel.json
// Licence: https://ui.dimaac.com/docs#licence (free for personal and client projects).
// Modified: Tailwind classes are replaced with StyleX; "auto" orientation follows the
// viewport width instead of the container width, and the class name props are removed.
"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import * as stylex from "@stylexjs/stylex";
import { expandablePanel as styles } from "../../styles/expandable-panel.stylex";

// An accordion of photos. One strip is wide open, the rest are slim; hover, focus or tap another
// and the room moves over to it. Each strip is a real button, so the keyboard works too.
// GSAP tweens flex-grow (not width), so the browser shares the space for us and every strip
// stays exactly as tall as the box. On narrow boxes the strips stack and open downwards.

export type ExpandablePanelItem = {
  /** The photo's address. */
  image: string;
  /** Describes the photo for screen readers. */
  alt: string;
  /** The label shown on the open strip, and the accessible name of the button. */
  title: string;
  /** A small line under the title, optional. */
  caption?: string;
};

export type ExpandablePanelProps = {
  /** The strips, in order. Four to eight look best. */
  panels: ExpandablePanelItem[];
  /** What opens a strip: "hover" (mouse), or "click". Tap and keyboard focus always open one. */
  trigger?: "hover" | "click";
  /** Which strip starts open. -1 starts with all of them closed. */
  defaultActive?: number;
  /** Go back to the first choice when the pointer leaves the whole row. */
  resetOnLeave?: boolean;
  /** How much wider the open strip is than a closed one (1 is the same width). */
  expandedRatio?: number;
  /** Space between the strips, in pixels. */
  gap?: number;
  /** Corner radius of each strip, in pixels. */
  radius?: number;
  /** How long the strips take to change size, in seconds. */
  duration?: number;
  /** The GSAP ease of the change, e.g. "power3.inOut" or "expo.out". */
  ease?: string;
  /** "auto" stacks the strips when the viewport is narrower than 42rem. */
  orientation?: "auto" | "horizontal" | "vertical";
  /** Called with the new strip's index whenever the open one changes. */
  onChange?: (index: number) => void;
};

export function ExpandablePanel({
  panels,
  trigger = "hover",
  defaultActive = 0,
  resetOnLeave = false,
  expandedRatio = 6,
  gap = 12,
  radius = 24,
  duration = 0.9,
  ease = "expo.out",
  orientation = "auto",
  onChange,
}: ExpandablePanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(defaultActive);
  // The strips are drawn at their starting size by React; after that only GSAP changes them
  const startActive = useRef(defaultActive);
  const started = useRef(false);

  // When the defaultActive prop changes on a live strip (the playground does this), follow it
  const [seenDefault, setSeenDefault] = useState(defaultActive);
  if (seenDefault !== defaultActive) {
    setSeenDefault(defaultActive);
    setActive(defaultActive);
  }

  const open = (index: number) => {
    if (index === active) return;
    setActive(index);
    onChange?.(index);
  };

  useGSAP(
    () => {
      const buttons = buttonRefs.current
        .slice(0, panels.length)
        .filter((button): button is HTMLButtonElement => button !== null);
      if (buttons.length === 0) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // The first run only places things, so the page doesn't open with an animation nobody asked for
      const time = started.current && !reduced ? duration : 0;
      started.current = true;

      const isOpen = (i: number) => i === active;
      gsap.to(buttons, {
        flexGrow: (i: number) => (isOpen(i) ? expandedRatio : 1),
        duration: time,
        ease,
        overwrite: "auto",
      });
      // The photo eases from a slight zoom to rest, and closed strips are dimmed
      gsap.to(
        buttons.map((b) => b.querySelector("[data-photo]")),
        {
          scale: (i: number) => (isOpen(i) ? 1 : 1.12),
          duration: time * 1.1,
          ease,
          overwrite: "auto",
        },
      );
      gsap.to(
        buttons.map((b) => b.querySelector("[data-shade]")),
        {
          opacity: (i: number) => (isOpen(i) ? 0 : 0.45),
          duration: time,
          ease: "power2.out",
          overwrite: "auto",
        },
      );
      // The title slides up into view only on the open strip; on the others it fades out quickly
      const titles = buttons.map((b) => b.querySelector("[data-title]"));
      gsap.to(titles, {
        opacity: (i: number) => (isOpen(i) ? 1 : 0),
        y: (i: number) => (isOpen(i) || reduced ? 0 : 18),
        duration: time * 0.6,
        delay: (i: number) => (isOpen(i) && time > 0 ? 0.12 : 0),
        ease: "power3.out",
        overwrite: "auto",
      });
    },
    { scope: listRef, dependencies: [active, panels.length, expandedRatio, duration, ease] },
  );

  // Arrow keys walk along the strips, and landing on one opens it (focus opens)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const current = buttonRefs.current.findIndex((button) => button === document.activeElement);
    if (current === -1) return;
    event.preventDefault();
    const last = panels.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? Math.min(last, current + 1)
            : Math.max(0, current - 1);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div {...stylex.props(styles.root)}>
      <div
        ref={listRef}
        role="group"
        aria-label="Expandable panels"
        onKeyDown={onKeyDown}
        onPointerLeave={() => resetOnLeave && open(defaultActive)}
        {...stylex.props(
          styles.list,
          orientation === "vertical"
            ? styles.vertical
            : orientation === "horizontal"
              ? styles.horizontal
              : styles.automatic,
        )}
        style={{ gap }}
      >
        {panels.map((panel, index) => (
          <button
            key={`${index}-${panel.image}`}
            ref={(button) => {
              buttonRefs.current[index] = button;
            }}
            type="button"
            aria-expanded={index === active}
            aria-label={panel.title}
            onPointerEnter={(event) => {
              // Touch fires an enter just before the tap, so only a real pointer counts as a hover
              if (trigger === "hover" && event.pointerType !== "touch") open(index);
            }}
            onClick={() => open(index)}
            onFocus={() => open(index)}
            {...stylex.props(styles.strip)}
            style={{
              flexGrow: index === startActive.current ? expandedRatio : 1,
              borderRadius: radius,
            }}
          >
            <img
              data-photo
              src={panel.image}
              alt={panel.alt}
              draggable={false}
              loading="lazy"
              decoding="async"
              {...stylex.props(styles.photo)}
              style={{ transform: index === startActive.current ? "scale(1)" : "scale(1.12)" }}
            />
            {/* Darkens closed strips, and the bottom of every strip so the white text reads */}
            <span
              aria-hidden
              data-shade
              {...stylex.props(styles.shade)}
              style={{ opacity: index === startActive.current ? 0 : 0.45 }}
            />
            <span aria-hidden {...stylex.props(styles.gradient)} />
            <span aria-hidden {...stylex.props(styles.index)}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              data-title
              {...stylex.props(styles.label)}
              style={{ opacity: index === startActive.current ? 1 : 0 }}
            >
              <span {...stylex.props(styles.title)}>{panel.title}</span>
              {panel.caption ? (
                <span {...stylex.props(styles.caption)}>{panel.caption}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
