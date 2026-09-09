"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type BoardAdminAction = "import" | "export" | "resources" | "automation" | "trash";

type Registration = {
  boardId: string;
  actions: BoardAdminAction[];
  open: (action: BoardAdminAction) => void;
};

const Ctx = createContext<{
  registration: Registration | null;
  setRegistration: (registration: Registration | null) => void;
} | null>(null);

/** 匯入/匯出/Resource 對應/自動化 are opened from the board's "…" menu in the
 *  sidebar, but their modals live in BoardView, which is where the board's
 *  columns/groups/items already are. This carries the open() call from the
 *  one to the other — both are children of the dashboard layout. */
export function BoardAdminActionsProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<Registration | null>(null);
  return <Ctx.Provider value={{ registration, setRegistration }}>{children}</Ctx.Provider>;
}

/** Called by the open board view. `open` must be stable (useCallback). */
export function useRegisterBoardAdminActions(
  boardId: string,
  actions: BoardAdminAction[],
  open: (action: BoardAdminAction) => void
) {
  const setRegistration = useContext(Ctx)?.setRegistration;
  const actionsKey = actions.join(",");
  useEffect(() => {
    if (!setRegistration) return;
    setRegistration({
      boardId,
      actions: actionsKey ? (actionsKey.split(",") as BoardAdminAction[]) : [],
      open,
    });
    return () => setRegistration(null);
  }, [setRegistration, boardId, actionsKey, open]);
}

/** Null until a board view has registered — the sidebar shows these items
 *  only on the board that is actually open. */
export function useBoardAdminActions() {
  return useContext(Ctx)?.registration ?? null;
}
