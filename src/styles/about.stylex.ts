import * as stylex from "@stylexjs/stylex";

export const about = stylex.create({
  content: {
    width: "100%",
    maxWidth: 1200,
    marginInline: "auto",
    paddingTop: { default: 35, "@media (min-width: 750px)": 55 },
    paddingBottom: 55,
    paddingInline: { default: 22, "@media (min-width: 750px)": 55 },
  },
  article: {
    width: { default: "100%", "@media (min-width: 750px)": "83.333333%" },
    marginInline: "auto",
    textAlign: "center",
  },
  heading: {
    fontSize: "2rem",
    lineHeight: 1.2,
    marginBottom: { default: 35, "@media (min-width: 750px)": 55 },
  },
  copy: { lineHeight: 1.6, marginTop: "1.5rem" },
});
