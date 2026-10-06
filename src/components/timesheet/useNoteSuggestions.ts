"use client";

import { useEffect, useMemo, useState } from "react";
import { getMyNoteHistory } from "@/lib/actions/noteHistory";
import { suggestNotes, type NoteHistoryEntry } from "@/lib/noteHistory";

/** 工時備註欄的建議:這位成員以前登記過的備註,這次登記的對象(scope)用過的排前面。 */
export function useNoteSuggestions(scope: string | null, query: string): string[] {
  const [history, setHistory] = useState<NoteHistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getMyNoteHistory()
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        // 建議只是方便,讀不到就當沒有。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => suggestNotes(history, { scope, query }), [history, scope, query]);
}
