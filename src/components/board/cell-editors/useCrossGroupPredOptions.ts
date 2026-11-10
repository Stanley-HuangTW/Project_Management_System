"use client";

import { useEffect, useState } from "react";
import { listOtherGroupPredOptions } from "@/lib/actions/predOptions";
import type { PredOption } from "@/types/board";

/**
 * 前置可以跨分組。看板頁會把其他分組的選項傳下來(provided),儀表板、專案甘特圖、
 * 更新動態這些入口沒有整個看板的資料,就在視窗開著時自己向伺服器拿一次。
 */
export function useCrossGroupPredOptions(
  boardId: string,
  groupId: string | undefined,
  provided: PredOption[] | undefined,
  enabled: boolean
): PredOption[] | undefined {
  const [fetched, setFetched] = useState<{ key: string; options: PredOption[] } | null>(null);
  const key = `${boardId}:${groupId ?? ""}`;
  const needFetch = enabled && !provided && !!groupId;
  useEffect(() => {
    if (!needFetch || !groupId) return;
    let cancelled = false;
    listOtherGroupPredOptions(boardId, groupId)
      .then((options) => {
        if (!cancelled) setFetched({ key, options });
      })
      .catch(() => {
        // 拿不到就只有本分組的選項,不要讓視窗壞掉。
      });
    return () => {
      cancelled = true;
    };
  }, [needFetch, boardId, groupId, key]);
  if (provided) return provided;
  return fetched?.key === key ? fetched.options : undefined;
}
