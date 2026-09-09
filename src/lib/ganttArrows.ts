import type { RelationshipType } from "@/lib/predecessorLink";

/** Where a bar sits in the chart, in the content box's own pixel space. */
export type BarBox = { left: number; right: number; centerY: number };

export type DependencyArrow = {
  key: string;
  /** The elbow itself. */
  path: string;
  /** Arrowhead triangle at the successor end. */
  head: string;
  critical: boolean;
  title: string;
};

const STUB = 8;
const HEAD = 4;

/**
 * Which edge each end of a link attaches to. FS runs finish→start, SS
 * start→start, FF finish→finish, SF start→finish — the letters are literally
 * the two ends being tied together.
 */
function endpoints(
  relationship: RelationshipType,
  pred: BarBox,
  succ: BarBox
): { fromX: number; toX: number; pointsRight: boolean } {
  switch (relationship) {
    case "FS":
      return { fromX: pred.right, toX: succ.left, pointsRight: true };
    case "SS":
      return { fromX: pred.left, toX: succ.left, pointsRight: true };
    case "FF":
      return { fromX: pred.right, toX: succ.right, pointsRight: false };
    case "SF":
      return { fromX: pred.left, toX: succ.right, pointsRight: false };
  }
}

/**
 * The elbow from one bar to another. Three shapes, by how much room lies
 * between the two ends:
 *
 *  - a clear gap: out of the predecessor, across to the successor's row, in
 *  - none, but not backwards: a straight drop. This is the ordinary FS link
 *    with no lag — the next task starts the day this one ends, so the two
 *    edges meet, and anything more than a vertical line is a squiggle
 *  - backwards (the successor is behind the predecessor, which SS and FF do
 *    routinely): step into the lane between the rows and come back, rather
 *    than doubling back over the bar
 */
function elbowPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  pointsRight: boolean
): string {
  const forward = pointsRight ? toX - fromX : fromX - toX;
  if (forward >= STUB * 2) {
    const out = fromX + (pointsRight ? STUB : -STUB);
    return `M ${fromX} ${fromY} H ${out} V ${toY} H ${toX}`;
  }
  if (forward >= 0) {
    return `M ${fromX} ${fromY} H ${toX} V ${toY}`;
  }
  const out = fromX + (pointsRight ? STUB : -STUB);
  const approach = toX + (pointsRight ? -STUB : STUB);
  // Half a row down (or up) from the predecessor is the gap between the two
  // rows — the only horizontal lane that crosses neither bar.
  const lane = fromY + (toY >= fromY ? 17 : -17);
  return `M ${fromX} ${fromY} H ${out} V ${lane} H ${approach} V ${toY} H ${toX}`;
}

function arrowHead(toX: number, toY: number, pointsRight: boolean): string {
  const back = pointsRight ? toX - HEAD * 1.6 : toX + HEAD * 1.6;
  return `M ${toX} ${toY} L ${back} ${toY - HEAD} L ${back} ${toY + HEAD} Z`;
}

/**
 * One arrow per dependency, ready to render. Links whose two ends are not both
 * on screen (a collapsed subtree, a filtered-out row, an item with no dates)
 * are skipped — there is nothing to draw between.
 */
export function buildDependencyArrows(
  links: {
    predId: string;
    succId: string;
    relationship: RelationshipType;
    critical: boolean;
    title: string;
  }[],
  boxes: Map<string, BarBox>
): DependencyArrow[] {
  const arrows: DependencyArrow[] = [];
  for (const link of links) {
    const pred = boxes.get(link.predId);
    const succ = boxes.get(link.succId);
    if (!pred || !succ) continue;
    const { fromX, toX, pointsRight } = endpoints(link.relationship, pred, succ);
    arrows.push({
      key: `${link.predId}->${link.succId}`,
      path: elbowPath(fromX, pred.centerY, toX, succ.centerY, pointsRight),
      head: arrowHead(toX, succ.centerY, pointsRight),
      critical: link.critical,
      title: link.title,
    });
  }
  return arrows;
}
