import { describe, expect, it } from "vitest";
import { buildDependencyArrows, type BarBox } from "./ganttArrows";

const box = (left: number, right: number, centerY: number): BarBox => ({ left, right, centerY });

const link = (relationship: "FS" | "FF" | "SS" | "SF") => [
  { predId: "a", succId: "b", relationship, critical: false, title: "a → b" },
];

describe("buildDependencyArrows", () => {
  it("runs FS from the predecessor's finish to the successor's start", () => {
    const boxes = new Map([
      ["a", box(0, 100, 10)],
      ["b", box(140, 240, 44)],
    ]);
    const [arrow] = buildDependencyArrows(link("FS"), boxes);
    // Out of the right edge, across to the next row, into the left edge.
    expect(arrow.path).toBe("M 100 10 H 108 V 44 H 140");
  });

  it("drops straight down for a back-to-back FS, the commonest link of all", () => {
    // No lag, so the next task starts the day this one ends and the two edges
    // meet. Anything more than a vertical line here is a squiggle.
    const boxes = new Map([
      ["a", box(0, 100, 10)],
      ["b", box(100, 200, 44)],
    ]);
    const [arrow] = buildDependencyArrows(link("FS"), boxes);
    expect(arrow.path).toBe("M 100 10 H 100 V 44");
  });

  it("steps between the rows when the arrow would have to double back", () => {
    // FF arrives at the successor's finish travelling leftwards, so a
    // successor finishing to the RIGHT of the predecessor is behind it.
    const boxes = new Map([
      ["a", box(0, 100, 10)],
      ["b", box(200, 300, 44)],
    ]);
    const [arrow] = buildDependencyArrows(link("FF"), boxes);
    expect(arrow.path).toBe("M 100 10 H 92 V 27 H 308 V 44 H 300");
  });

  it("treats a successor further left as room ahead for a leftward arrow", () => {
    const boxes = new Map([
      ["a", box(300, 400, 10)],
      ["b", box(0, 100, 44)],
    ]);
    const [arrow] = buildDependencyArrows(link("FF"), boxes);
    expect(arrow.path).toBe("M 400 10 H 392 V 44 H 100");
  });

  it("ties the ends each relationship names", () => {
    const boxes = new Map([
      ["a", box(0, 100, 10)],
      ["b", box(300, 400, 44)],
    ]);
    const at = (relationship: "FS" | "FF" | "SS" | "SF") =>
      buildDependencyArrows(link(relationship), boxes)[0].path.match(/^M (\d+) .* H (\d+)$/)!;

    expect(at("FS").slice(1)).toEqual(["100", "300"]); // finish → start
    expect(at("SS").slice(1)).toEqual(["0", "300"]); //   start  → start
    expect(at("FF").slice(1)).toEqual(["100", "400"]); // finish → finish
    expect(at("SF").slice(1)).toEqual(["0", "400"]); //   start  → finish
  });

  it("skips a link whose other end is off screen — a collapsed or filtered row", () => {
    const boxes = new Map([["a", box(0, 100, 10)]]);
    expect(buildDependencyArrows(link("FS"), boxes)).toEqual([]);
  });

  it("marks an arrow critical only when the caller says both ends are", () => {
    const boxes = new Map([
      ["a", box(0, 100, 10)],
      ["b", box(140, 240, 44)],
    ]);
    const [arrow] = buildDependencyArrows(
      [{ predId: "a", succId: "b", relationship: "FS", critical: true, title: "" }],
      boxes
    );
    expect(arrow.critical).toBe(true);
  });
});
