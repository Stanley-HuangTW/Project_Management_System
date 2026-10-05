"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { BoardWithData } from "@/types/board";
import {
  EMPTY_HISTORY,
  pushEntry,
  redoneState,
  undoneState,
  type HistoryEntry,
  type HistoryState,
} from "@/lib/editHistory";

export type EditHistoryApi = {
  /** 一次修改成功之後登記:怎麼還原、怎麼重做。 */
  record: (entry: Omit<HistoryEntry, "id">) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
  /** 最新的看板資料。登記當下的 closure 會過期,衝突檢查(目前的值是不是當初改完的值)
   *  要在還原的那一刻讀這個。 */
  getBoard: () => BoardWithData;
};

const EditHistoryContext = createContext<EditHistoryApi | null>(null);

/** 不在看板裡(例如別的頁面打開同一張項目卡片)時回傳 null——呼叫端把登記當成 no-op。 */
export function useEditHistory(): EditHistoryApi | null {
  return useContext(EditHistoryContext);
}

/**
 * 看板的「上一步 / 下一步」。堆疊只存在這個元件的記憶體裡:重新整理、換看板(BoardView 用
 * board.id 當 key 重新掛載)就清空,三個視圖(表格/看板/甘特圖)共用同一份。
 */
export function EditHistoryProvider({ board, children }: { board: BoardWithData; children: ReactNode }) {
  const router = useRouter();
  const { notify } = useDialogs();

  const [state, setState] = useState<HistoryState>(EMPTY_HISTORY);
  const [busy, setBusy] = useState(false);
  // 畫面用 state 畫,事件處理一律讀 ref——async 的還原在等 server 的時候,state 的 closure 已經過期。
  const stateRef = useRef<HistoryState>(EMPTY_HISTORY);
  const busyRef = useRef(false);
  const nextId = useRef(0);
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  });

  const commit = useCallback((next: HistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const record = useCallback(
    (entry: Omit<HistoryEntry, "id">) => {
      nextId.current += 1;
      commit(pushEntry(stateRef.current, { ...entry, id: String(nextId.current) }));
    },
    [commit]
  );

  const runStep = useCallback(
    async (kind: "undo" | "redo") => {
      if (busyRef.current) return;
      const current = stateRef.current;
      const entry = kind === "undo" ? current.past[current.past.length - 1] : current.future[current.future.length - 1];
      if (!entry) return;

      const failTitle = kind === "undo" ? "無法復原" : "無法重做";
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await (kind === "undo" ? entry.undo() : entry.redo());
        if (!result.ok) {
          await notify(result.reason, { title: failTitle });
          return;
        }
        // 等 server 的這段時間使用者可能又改了別的東西、堆疊變了——只有最近一筆還是
        // 同一筆才搬,不然會把剛登記的新修改搬走。
        const latest = stateRef.current;
        if (kind === "undo" && latest.past[latest.past.length - 1] === entry) commit(undoneState(latest));
        if (kind === "redo" && latest.future[latest.future.length - 1] === entry) commit(redoneState(latest));
        router.refresh();
      } catch (err) {
        await notify(err instanceof Error ? err.message : "操作失敗", { title: failTitle });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [commit, notify, router]
  );

  const undo = useCallback(() => runStep("undo"), [runStep]);
  const redo = useCallback(() => runStep("redo"), [runStep]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (!isUndo && !isRedo) return;
      // 游標在輸入框裡就讓輸入框自己處理文字的復原;有對話框開著也不攔。
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      void (isUndo ? undo() : redo());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const value = useMemo<EditHistoryApi>(
    () => ({
      record,
      undo,
      redo,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undoLabel: state.past[state.past.length - 1]?.label ?? null,
      redoLabel: state.future[state.future.length - 1]?.label ?? null,
      busy,
      getBoard: () => boardRef.current,
    }),
    [record, undo, redo, state, busy]
  );

  return <EditHistoryContext.Provider value={value}>{children}</EditHistoryContext.Provider>;
}
