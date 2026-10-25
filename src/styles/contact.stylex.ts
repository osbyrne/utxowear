import * as stylex from "@stylexjs/stylex";

export const contact = stylex.create({
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
  },
  heading: {
    textAlign: "center",
    fontSize: "2rem",
    lineHeight: 1.2,
    marginBottom: { default: 35, "@media (min-width: 750px)": 55 },
  },
  intro: { textAlign: "center", lineHeight: 1.6, marginBottom: 35 },
  form: { display: "grid", gap: "1.25rem" },
  row: {
    display: "grid",
    gap: "1.25rem",
    gridTemplateColumns: { default: "1fr", "@media (min-width: 750px)": "1fr 1fr" },
  },
  message: { resize: "vertical", minHeight: 200 },
  submit: { justifySelf: "start" },
  trap: { position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" },
});
