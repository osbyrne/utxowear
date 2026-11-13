import * as stylex from "@stylexjs/stylex";

export const theme = stylex.defineVars({
  surface: {
    default: "oklch(100% 0 0)",
    "@media (prefers-color-scheme: dark)": "oklch(18% 0 0)",
  },
  background: {
    default: "oklch(93% 0 0)",
    "@media (prefers-color-scheme: dark)": "oklch(13% 0 0)",
  },
  backgroundMuted: {
    default: "oklch(93% 0 0 / 60%)",
    "@media (prefers-color-scheme: dark)": "oklch(13% 0 0 / 60%)",
  },
  border: {
    default: "oklch(86% 0 0)",
    "@media (prefers-color-scheme: dark)": "oklch(33% 0 0)",
  },
  content: {
    default: "oklch(22.389% 0.031 278.072)",
    "@media (prefers-color-scheme: dark)": "oklch(93% 0 0)",
  },
  muted: {
    default: "oklch(22.389% 0.031 278.072 / 60%)",
    "@media (prefers-color-scheme: dark)": "oklch(93% 0 0 / 65%)",
  },
  primaryHover: {
    default: "#3f3f46",
    "@media (prefers-color-scheme: dark)": "oklch(82% 0 0)",
  },
  noticeBackground: {
    default: "oklch(95% 0.04 145)",
    "@media (prefers-color-scheme: dark)": "oklch(27% 0.04 145)",
  },
  noticeContent: {
    default: "oklch(32% 0.08 145)",
    "@media (prefers-color-scheme: dark)": "oklch(85% 0.08 145)",
  },
  errorBackground: {
    default: "oklch(96% 0.04 25)",
    "@media (prefers-color-scheme: dark)": "oklch(27% 0.04 25)",
  },
  errorContent: {
    default: "oklch(40% 0.12 25)",
    "@media (prefers-color-scheme: dark)": "oklch(85% 0.08 25)",
  },
  serif: '"Computer Modern Serif", serif',
  brandFont: '"Instrument Serif", Georgia, serif',
});
