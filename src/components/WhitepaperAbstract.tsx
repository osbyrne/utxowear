import * as stylex from "@stylexjs/stylex";
import {
  layoutWithLines,
  measureNaturalWidth,
  prepare,
  prepareWithSegments,
} from "@chenglou/pretext";
import { useEffect, useState } from "react";

// Preserve the reference's line endings while scaling the paragraph as one unit.
const ABSTRACT_LINES = [
  "Abstract. A purely peer-to-peer version of electronic cash would allow online",
  "payments to be sent directly from one party to another without going through a",
  "financial institution. Digital signatures provide part of the solution, but the main",
  "benefits are lost if a trusted third party is still required to prevent double-spending.",
  "We propose a solution to the double-spending problem using a peer-to-peer network.",
  "The network timestamps transactions by hashing them into an ongoing chain of",
  "hash-based proof-of-work, forming a record that cannot be changed without redoing",
  "the proof-of-work. The longest chain not only serves as proof of the sequence of",
  "events witnessed, but proof that it came from the largest pool of CPU power. As",
  "long as a majority of CPU power is controlled by nodes that are not cooperating to",
  "attack the network, they'll generate the longest chain and outpace attackers. The",
  "network itself requires minimal structure. Messages are broadcast on a best effort",
  "basis, and nodes can leave and rejoin the network at will, accepting the longest",
  "proof-of-work chain as proof of what happened while they were gone.",
];
const FONT_FAMILY = '"Times New Roman", Times, serif';
const FONT_SIZE = 28;
const LINE_HEIGHT = 36;
const ABSTRACT_TEXT = ABSTRACT_LINES.join(" ");

function calculateAbstractLayout() {
  const font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  const prepared = prepareWithSegments(ABSTRACT_LINES.join("\n"), font, {
    whiteSpace: "pre-wrap",
  });
  const { lines } = layoutWithLines(prepared, 10000, LINE_HEIGHT);
  const labelWidthAdjustment =
    measureNaturalWidth(prepare("Abstract.", `bold ${font}`)) -
    measureNaturalWidth(prepare("Abstract.", font));

  const measuredLines = lines.map((line, index) => ({
    ...line,
    width: line.width + (index === 0 ? labelWidthAdjustment : 0),
  }));

  return {
    lines: measuredLines,
    width: Math.max(...measuredLines.map((line) => line.width)),
    height: lines.length * LINE_HEIGHT,
  };
}

export default function WhitepaperAbstract() {
  const [layout, setLayout] = useState<ReturnType<typeof calculateAbstractLayout> | null>(null);

  useEffect(() => {
    let disposed = false;
    void document.fonts.ready.then(() => {
      if (!disposed) setLayout(calculateAbstractLayout());
    });
    return () => {
      disposed = true;
    };
  }, []);

  if (!layout) return null;

  return (
    <div {...stylex.props(styles.background)}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ABSTRACT_TEXT}
        {...stylex.props(styles.paragraph)}
      >
        <title>Bitcoin whitepaper abstract</title>
        {layout.lines.map((line, index) => (
          <text
            key={index}
            x={0}
            y={FONT_SIZE + index * LINE_HEIGHT}
            fontFamily={FONT_FAMILY}
            fontSize={FONT_SIZE}
            fill="black"
            style={{
              wordSpacing:
                index < layout.lines.length - 1
                  ? (layout.width - line.width) / (line.text.split(" ").length - 1)
                  : 0,
            }}
          >
            {index === 0 ? (
              <>
                <tspan fontWeight="bold">Abstract.</tspan>
                {line.text.slice("Abstract.".length)}
              </>
            ) : (
              line.text
            )}
          </text>
        ))}
      </svg>
    </div>
  );
}

const styles = stylex.create({
  background: {
    position: "absolute",
    inset: "1rem",
    userSelect: "text",
    cursor: "text",
  },
  paragraph: {
    display: "block",
    width: "100%",
    height: "100%",
  },
});
