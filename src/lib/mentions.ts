export type MentionCandidate = { id: string; name: string };

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; userId: string };

/**
 * Names are matched whole rather than by a `@\w+` pattern: people here are
 * called "Stanley Huang" and "青雲_PM_ALEX", so a word-character rule would
 * catch half a name and miss the rest. Longest first, so "@Alex Chen" is not
 * swallowed by an "@Alex" who also exists.
 */
function byLongestName(candidates: MentionCandidate[]): MentionCandidate[] {
  return [...candidates].sort((a, b) => b.name.length - a.name.length);
}

/** The ids named in a comment body. Each person is returned once, however
 *  many times they are mentioned. */
export function findMentionedUserIds(body: string, candidates: MentionCandidate[]): string[] {
  const found = new Set<string>();
  for (const segment of splitMentions(body, candidates)) {
    if (segment.kind === "mention") found.add(segment.userId);
  }
  return [...found];
}

/**
 * Splits a comment into plain text and mention runs, so the renderer can style
 * the mentions without dangerously setting HTML from user input.
 *
 * Scans left to right and takes the longest name that matches at each "@", so
 * overlapping names cannot produce interleaved segments.
 */
export function splitMentions(body: string, candidates: MentionCandidate[]): MentionSegment[] {
  const ordered = byLongestName(candidates.filter((c) => c.name.trim().length > 0));
  const segments: MentionSegment[] = [];
  let buffer = "";

  for (let i = 0; i < body.length; ) {
    if (body[i] !== "@") {
      buffer += body[i];
      i++;
      continue;
    }
    const match = ordered.find((c) => body.startsWith(c.name, i + 1));
    if (!match) {
      buffer += body[i];
      i++;
      continue;
    }
    if (buffer) {
      segments.push({ kind: "text", text: buffer });
      buffer = "";
    }
    segments.push({ kind: "mention", text: `@${match.name}`, userId: match.id });
    i += 1 + match.name.length;
  }
  if (buffer) segments.push({ kind: "text", text: buffer });
  return segments;
}

/**
 * The partial name being typed after an "@", or null when the caret is not in
 * a mention — what the picker filters on.
 *
 * A name can contain spaces, so the search does not stop at one; it gives up
 * after a newline or a long run, which is the point at which the "@" was
 * almost certainly not the start of a mention at all.
 */
export function activeMentionQuery(body: string, caret: number): { query: string; at: number } | null {
  const upToCaret = body.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at < 0) return null;
  const query = upToCaret.slice(at + 1);
  if (query.includes("\n") || query.length > 30) return null;
  // An "@" mid-word (an email address, say) is not the start of a mention.
  const before = at > 0 ? upToCaret[at - 1] : " ";
  if (before.trim() !== "") return null;
  return { query, at };
}
