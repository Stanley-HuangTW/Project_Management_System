/**
 * 「這一頁是舊版本」的偵測。
 *
 * Next.js gives every Server Action an id derived from the build. Deploy a new
 * version while somebody has a page open and every button on that page calls
 * an id the server no longer knows, which surfaces as an English stack-trace
 * message about a missing Server Action — technically accurate and useless to
 * the person holding the mouse.
 *
 * The only fix is to reload, so that is what we say.
 */
const MARKERS = [
  "Failed to find Server Action",
  "was not found on the server",
  "Connection closed",
];

export function isStaleBuildError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return MARKERS.some((marker) => message.includes(marker));
}

export const STALE_BUILD_MESSAGE =
  "系統剛更新過,這個分頁還是舊版本,所以剛才那個動作沒有送出去。重新整理之後再試一次即可——你已經輸入的資料不受影響。";
