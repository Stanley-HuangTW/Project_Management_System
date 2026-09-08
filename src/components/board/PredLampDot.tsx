"use client";

import type { PredLamp } from "@/lib/predLamp";

/** The lamp shown beside a Pred field: green once the predecessor is done,
 *  orange while it is still running, red once it is late. The colour alone
 *  says very little, so the reason is always on the hover title. */
export function PredLampDot({ lamp }: { lamp: PredLamp | null | undefined }) {
  if (!lamp) return null;
  return (
    <span
      title={lamp.label}
      aria-label={lamp.label}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: lamp.color }}
    />
  );
}
